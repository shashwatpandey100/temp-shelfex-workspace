import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { db } from '../db';
import { users, authCodes, clientApps } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import {
  generateAuthCode,
  getAuthCodeExpiry,
  generateAccessToken,
  generateRefreshToken,
  generateIdToken,
  verifyAccessToken,
  comparePassword,
  hashToken,
  generateTokenId,
  getRefreshTokenExpiry,
} from '../utils/jwt';
import { refreshTokens } from '../db/schema';
import { checkActionRateLimit, recordAction } from '../utils/rateLimit';
import logger from '../utils/logger';

// ─── PKCE HELPERS ───────────────────────────────────────────────

function verifyCodeChallenge(codeVerifier: string, codeChallenge: string, method: string): boolean {
  if (method === 'S256') {
    const hash = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
    return hash === codeChallenge;
  }
  if (method === 'plain') {
    return codeVerifier === codeChallenge;
  }
  return false;
}

// GET /oauth/authorize
export const authorize = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { client_id, redirect_uri, response_type, state, code_challenge, code_challenge_method, nonce } = req.query;

    // Validation
    if (!client_id || !redirect_uri || response_type !== 'code') {
      res.status(400).json({
        success: false,
        message: 'Invalid OAuth request',
        error: 'Required params: client_id, redirect_uri, response_type=code',
      });
      return;
    }

    // PKCE is required — code_challenge must be present
    if (!code_challenge) {
      res.status(400).json({
        success: false,
        message: 'PKCE required',
        error: 'code_challenge is required. Use code_challenge_method=S256.',
      });
      return;
    }

    const method = (code_challenge_method as string) || 'S256';
    if (!['S256', 'plain'].includes(method)) {
      res.status(400).json({
        success: false,
        message: 'Invalid code_challenge_method',
        error: 'Supported methods: S256, plain',
      });
      return;
    }

    // Validate client_id exists and redirect_uri is allowed
    const [client] = await db
      .select()
      .from(clientApps)
      .where(eq(clientApps.clientId, client_id as string))
      .limit(1);

    if (!client) {
      res.status(400).json({
        success: false,
        message: 'Invalid client_id',
        error: `Client '${client_id}' not registered`,
      });
      return;
    }

    // Check if redirect_uri is in the allowed list
    const allowedUris = client.allowedRedirectUris as string[];
    if (!allowedUris.includes(redirect_uri as string)) {
      res.status(400).json({
        success: false,
        message: 'Invalid redirect_uri',
        error: 'Redirect URI not registered for this client',
      });
      return;
    }

    // Check for accounts_session cookie
    const accountsSession = req.cookies?.accounts_session;

    if (!accountsSession) {
      // User is NOT logged in - redirect to login page (preserve all OAuth params)
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      const loginParams = new URLSearchParams({
        client_id: client_id as string,
        redirect_uri: redirect_uri as string,
        ...(state && { state: state as string }),
        ...(code_challenge && { code_challenge: code_challenge as string }),
        ...(code_challenge_method && { code_challenge_method: code_challenge_method as string }),
        ...(nonce && { nonce: nonce as string }),
      });
      res.redirect(`${frontendUrl}/login?${loginParams.toString()}`);
      return;
    }

    // User has accounts_session cookie - verify it and proceed with SSO
    let userId: string;
    try {
      const decoded = verifyAccessToken(accountsSession);
      userId = decoded.userId;

      // Check email verification if required
      const emailVerificationRequired = process.env.EMAIL_VERIFICATION_REQUIRED === 'true';
      if (emailVerificationRequired && !decoded.emailVerified) {
        res.status(403).json({
          success: false,
          message: 'Email verification required',
          error: 'Please verify your email before accessing other apps',
        });
        return;
      }
    } catch (error) {
      // Session token is invalid/expired - redirect to login again (preserve all OAuth params)
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      const loginParams = new URLSearchParams({
        client_id: client_id as string,
        redirect_uri: redirect_uri as string,
        ...(state && { state: state as string }),
        ...(code_challenge && { code_challenge: code_challenge as string }),
        ...(code_challenge_method && { code_challenge_method: code_challenge_method as string }),
        ...(nonce && { nonce: nonce as string }),
      });
      res.redirect(`${frontendUrl}/login?${loginParams.toString()}`);
      return;
    }

    // Generate authorization code (store hash in DB, send plaintext to client)
    const code = generateAuthCode();
    const codeHash = hashToken(code);
    await db.insert(authCodes).values({
      code: codeHash,
      userId,
      clientId: client_id as string,
      redirectUri: redirect_uri as string,
      codeChallenge: code_challenge as string,
      codeChallengeMethod: (code_challenge_method as string) || 'S256',
      nonce: (nonce as string) || null,
      expiresAt: getAuthCodeExpiry(),
      isUsed: false,
    });

    // Redirect back to client app with the plaintext code
    const redirectUrl = new URL(redirect_uri as string);
    redirectUrl.searchParams.set('code', code);
    if (state) {
      redirectUrl.searchParams.set('state', state as string);
    }

    logger.info(`Authorization code generated for user ${userId}, client ${client_id}`);

    // Redirect user back to client app with authorization code
    res.redirect(redirectUrl.toString());
  } catch (error) {
    logger.error('OAuth authorize error:', error);
    next(error);
  }
};

// POST /oauth/token
export const token = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { code, client_id, client_secret, redirect_uri, grant_type, code_verifier } = req.body;

    // Rate limit token exchange
    const ip = req.ip || 'unknown';
    const tokenLimit = await checkActionRateLimit('oauth_token', ip);
    if (!tokenLimit.allowed) {
      res.status(429).json({ success: false, message: 'Too many requests. Try again later.' });
      return;
    }
    await recordAction('oauth_token', ip, req);

    // Validation
    if (
      !code ||
      !client_id ||
      !client_secret ||
      !redirect_uri ||
      grant_type !== 'authorization_code'
    ) {
      res.status(400).json({
        success: false,
        message: 'Invalid token request',
        error:
          'Required: code, client_id, client_secret, redirect_uri, grant_type=authorization_code',
      });
      return;
    }

    // Verify client credentials
    const [client] = await db
      .select()
      .from(clientApps)
      .where(eq(clientApps.clientId, client_id))
      .limit(1);

    if (!client) {
      res.status(401).json({
        success: false,
        message: 'Invalid client credentials',
        error: 'Client not found',
      });
      return;
    }

    // Verify client_secret
    const isSecretValid = await comparePassword(client_secret, client.clientSecret);
    if (!isSecretValid) {
      res.status(401).json({
        success: false,
        message: 'Invalid client credentials',
        error: 'Client secret is incorrect',
      });
      return;
    }

    // Find and validate authorization code (hash the submitted code for lookup)
    const codeHash = hashToken(code);
    const [authCode] = await db
      .select()
      .from(authCodes)
      .where(and(eq(authCodes.code, codeHash), eq(authCodes.clientId, client_id)))
      .limit(1);

    if (!authCode) {
      res.status(400).json({
        success: false,
        message: 'Invalid authorization code',
        error: 'Code not found or does not belong to this client',
      });
      return;
    }

    // Check if code is already used
    if (authCode.isUsed) {
      res.status(400).json({
        success: false,
        message: 'Authorization code already used',
        error: 'This code has been exchanged already',
      });
      return;
    }

    // Check if code is expired
    if (new Date() > authCode.expiresAt) {
      res.status(400).json({
        success: false,
        message: 'Authorization code expired',
        error: 'Code is no longer valid',
      });
      return;
    }

    // Verify redirect_uri matches
    if (authCode.redirectUri !== redirect_uri) {
      res.status(400).json({
        success: false,
        message: 'Invalid redirect_uri',
        error: 'Redirect URI does not match the one used in authorization',
      });
      return;
    }

    // PKCE: verify code_verifier if code_challenge was sent during authorization
    if (authCode.codeChallenge) {
      if (!code_verifier) {
        res.status(400).json({
          success: false,
          message: 'PKCE code_verifier required',
          error: 'This authorization was initiated with PKCE. code_verifier is required.',
        });
        return;
      }

      const isValid = verifyCodeChallenge(code_verifier, authCode.codeChallenge, authCode.codeChallengeMethod || 'S256');
      if (!isValid) {
        res.status(400).json({
          success: false,
          message: 'Invalid code_verifier',
          error: 'PKCE verification failed',
        });
        return;
      }
    }

    // Get user details
    const [user] = await db.select().from(users).where(eq(users.id, authCode.userId)).limit(1);

    if (!user) {
      res.status(400).json({
        success: false,
        message: 'User not found',
        error: 'Associated user no longer exists',
      });
      return;
    }

    // Mark code as used
    await db.update(authCodes).set({ isUsed: true }).where(eq(authCodes.code, codeHash));

    // Generate tokens for the client app
    const accessToken = generateAccessToken({
      userId: user.id,
      email: user.email,
      emailVerified: user.emailVerified,
    });

    const tokenId = generateTokenId();
    const refreshToken = generateRefreshToken({
      userId: user.id,
      tokenId,
    });

    // Generate ID token with user information (OpenID Connect standard)
    const idToken = generateIdToken({
      userId: user.id,
      email: user.email,
      name: user.name,
      emailVerified: user.emailVerified,
      nonce: authCode.nonce || undefined,
    });

    // Store refresh token (hashed) in database
    const tokenHash = hashToken(refreshToken);
    await db.insert(refreshTokens).values({
      userId: user.id,
      tokenHash,
      expiresAt: getRefreshTokenExpiry(),
      isRevoked: false,
    });

    logger.info(`Tokens issued for user ${user.email}, client ${client_id}`);

    // Return tokens to client app backend
    res.status(200).json({
      success: true,
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: 'Bearer',
      expires_in: 3600, // 1 hour in seconds (matches actual JWT expiry)
      id_token: idToken,
    });
  } catch (error) {
    logger.error('OAuth token error:', error);
    next(error);
  }
};
