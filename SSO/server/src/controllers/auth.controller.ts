import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { db } from '../db';
import { users, refreshTokens, emailVerificationCodes, passwordResetTokens, clientApps, authCodes } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import {
  hashPassword,
  comparePassword,
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  hashToken,
  generateTokenId,
  getRefreshTokenExpiry,
  generateAuthCode,
  getAuthCodeExpiry,
} from '../utils/jwt';
import { validatePassword } from '../utils/password';
import { sendVerificationEmail, sendPasswordResetEmail, sendWelcomeEmail } from '../utils/email';
import { checkLoginRateLimit, checkLoginIpRateLimit, recordLoginIpAttempt, recordLoginAttempt, checkActionRateLimit, recordAction } from '../utils/rateLimit';
import { logAudit } from '../utils/audit';
import logger from '../utils/logger';

// ─── HELPERS ────────────────────────────────────────────────────

function generateOTP(): string {
  return crypto.randomInt(100000, 999999).toString();
}

function getOTPExpiry(): Date {
  return new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
}

function getPasswordResetExpiry(): Date {
  return new Date(Date.now() + 60 * 60 * 1000); // 1 hour
}

function setAuthCookies(res: Response, accessToken: string, refreshToken: string) {
  const isProduction = process.env.NODE_ENV === 'production';
  // vercel.app is on the Public Suffix List, so cross-subdomain requests are cross-site.
  // SameSite=None + Secure is required for cookies to be stored/sent cross-site.
  const sameSite: 'lax' | 'none' = isProduction ? 'none' : 'lax';

  res.cookie('access_token', accessToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite,
    maxAge: 60 * 60 * 1000, // 1 hour (matches JWT expiry)
    path: '/',
  });

  res.cookie('refresh_token', refreshToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite,
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    path: '/',
  });

  const sessionCookieOptions: any = {
    httpOnly: true,
    secure: isProduction,
    sameSite,
    maxAge: 60 * 60 * 1000, // 1 hour
    path: '/api/v1/oauth', // Only sent on OAuth routes
  };
  if (process.env.COOKIE_DOMAIN) {
    sessionCookieOptions.domain = process.env.COOKIE_DOMAIN;
  }
  res.cookie('accounts_session', accessToken, sessionCookieOptions);
}

function clearAuthCookies(res: Response) {
  const isProduction = process.env.NODE_ENV === 'production';
  const sameSite: 'lax' | 'none' = isProduction ? 'none' : 'lax';

  res.clearCookie('access_token', { path: '/', sameSite, secure: isProduction });
  res.clearCookie('refresh_token', { path: '/', sameSite, secure: isProduction });
  const sessionClearOptions: any = { path: '/api/v1/oauth', sameSite, secure: isProduction };
  if (process.env.COOKIE_DOMAIN) {
    sessionClearOptions.domain = process.env.COOKIE_DOMAIN;
  }
  res.clearCookie('accounts_session', sessionClearOptions);
}

// ─── REGISTER ───────────────────────────────────────────────────

export const register = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { email, username, password, name } = req.body;

    if (!email || !password) {
      res.status(400).json({ success: false, message: 'Email and password are required' });
      return;
    }

    // Rate limit registration by IP
    const ip = req.ip || 'unknown';
    const regLimit = await checkActionRateLimit('register', ip);
    if (!regLimit.allowed) {
      res.status(429).json({ success: false, message: `Too many registrations. Try again in ${regLimit.retryAfterMinutes} minutes.` });
      return;
    }
    await recordAction('register', ip, req);

    const passwordCheck = validatePassword(password);
    if (!passwordCheck.valid) {
      res.status(400).json({ success: false, message: 'Weak password', errors: passwordCheck.errors });
      return;
    }

    const existingEmail = await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);
    if (existingEmail.length > 0) {
      res.status(409).json({ success: false, message: 'An account with these details already exists' });
      return;
    }

    if (username) {
      const existingUsername = await db.select().from(users).where(eq(users.username, username.toLowerCase())).limit(1);
      if (existingUsername.length > 0) {
        res.status(409).json({ success: false, message: 'An account with these details already exists' });
        return;
      }
    }

    const hashedPassword = await hashPassword(password);

    const [newUser] = await db
      .insert(users)
      .values({
        email: email.toLowerCase(),
        username: username?.toLowerCase() || null,
        password: hashedPassword,
        name: name || null,
        emailVerified: false,
      })
      .returning();

    // Send verification OTP (store hash, send plaintext via email)
    const otp = generateOTP();
    const otpHash = hashToken(otp);
    await db.insert(emailVerificationCodes).values({
      userId: newUser.id,
      code: otpHash,
      expiresAt: getOTPExpiry(),
    });
    await sendVerificationEmail(newUser.email, otp, newUser.name);

    await logAudit('user.register', req, newUser.id, { email: newUser.email });
    logger.info(`New user registered: ${newUser.email}`);

    res.status(201).json({
      success: true,
      message: 'User registered. Check your email for a verification code.',
      data: {
        id: newUser.id,
        email: newUser.email,
        username: newUser.username,
        name: newUser.name,
        emailVerified: newUser.emailVerified,
      },
    });
  } catch (error) {
    logger.error('Register error:', error);
    next(error);
  }
};

// ─── VERIFY EMAIL ───────────────────────────────────────────────

export const verifyEmail = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { email, code } = req.body;

    if (!email || !code) {
      res.status(400).json({ success: false, message: 'Email and verification code are required' });
      return;
    }

    // Rate limit verification attempts (brute force protection)
    const verifyLimit = await checkActionRateLimit('verify_attempt', email);
    if (!verifyLimit.allowed) {
      res.status(429).json({ success: false, message: `Too many attempts. Try again in ${verifyLimit.retryAfterMinutes} minutes.` });
      return;
    }
    await recordAction('verify_attempt', email, req);

    const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);
    if (!user) {
      res.status(404).json({ success: false, message: 'User not found' });
      return;
    }

    if (user.emailVerified) {
      res.status(400).json({ success: false, message: 'Email already verified' });
      return;
    }

    const codeHash = hashToken(code);
    const [verification] = await db
      .select()
      .from(emailVerificationCodes)
      .where(
        and(
          eq(emailVerificationCodes.userId, user.id),
          eq(emailVerificationCodes.code, codeHash),
          eq(emailVerificationCodes.isUsed, false),
        ),
      )
      .limit(1);

    if (!verification) {
      res.status(400).json({ success: false, message: 'Invalid verification code' });
      return;
    }

    if (new Date() > verification.expiresAt) {
      res.status(400).json({ success: false, message: 'Verification code expired. Request a new one.' });
      return;
    }

    await db.update(emailVerificationCodes).set({ isUsed: true }).where(eq(emailVerificationCodes.id, verification.id));
    await db.update(users).set({ emailVerified: true, updatedAt: new Date() }).where(eq(users.id, user.id));

    await sendWelcomeEmail(user.email, user.name);
    await logAudit('user.email_verified', req, user.id);
    logger.info(`Email verified: ${user.email}`);

    res.status(200).json({ success: true, message: 'Email verified successfully' });
  } catch (error) {
    logger.error('Verify email error:', error);
    next(error);
  }
};

// ─── RESEND VERIFICATION ────────────────────────────────────────

export const resendVerification = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { email } = req.body;

    if (!email) {
      res.status(400).json({ success: false, message: 'Email is required' });
      return;
    }

    // Rate limit email sending (3 per 15 min per email)
    const emailLimit = await checkActionRateLimit('email_send', email);
    if (!emailLimit.allowed) {
      res.status(429).json({ success: false, message: `Too many requests. Try again in ${emailLimit.retryAfterMinutes} minutes.` });
      return;
    }

    const successMsg = 'If that email is registered, a verification code has been sent.';

    const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);
    if (!user || user.emailVerified) {
      res.status(200).json({ success: true, message: successMsg });
      return;
    }

    // Invalidate all previous unused codes for this user
    await db
      .update(emailVerificationCodes)
      .set({ isUsed: true })
      .where(and(eq(emailVerificationCodes.userId, user.id), eq(emailVerificationCodes.isUsed, false)));

    const otp = generateOTP();
    const otpHash = hashToken(otp);
    await db.insert(emailVerificationCodes).values({
      userId: user.id,
      code: otpHash,
      expiresAt: getOTPExpiry(),
    });
    await sendVerificationEmail(user.email, otp, user.name);

    await recordAction('email_send', email, req);

    res.status(200).json({ success: true, message: successMsg });
  } catch (error) {
    logger.error('Resend verification error:', error);
    next(error);
  }
};

// ─── LOGIN PAGE (GET) ───────────────────────────────────────────

export const getLoginPage = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { client_id, redirect_uri, state } = req.query;
    res.status(200).json({
      success: true,
      message: 'Login page',
      data: { client_id: client_id || null, redirect_uri: redirect_uri || null, state: state || null },
    });
  } catch (error) {
    logger.error('Get login page error:', error);
    next(error);
  }
};

// ─── LOGIN (POST) ───────────────────────────────────────────────

export const login = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { identifier, password, client_id, redirect_uri, state, code_challenge, code_challenge_method, nonce } = req.body;

    if (!identifier || !password) {
      res.status(400).json({ success: false, message: 'Email/username and password are required' });
      return;
    }

    const ip = req.ip || 'unknown';

    // Rate limiting — per identifier AND per IP (prevents credential stuffing)
    const [identifierLimit, ipLimit] = await Promise.all([
      checkLoginRateLimit(identifier),
      checkLoginIpRateLimit(ip),
    ]);

    if (!identifierLimit.allowed) {
      await logAudit('user.login_rate_limited', req, null, { identifier });
      res.status(429).json({
        success: false,
        message: `Too many failed attempts. Try again in ${identifierLimit.retryAfterMinutes} minutes.`,
      });
      return;
    }

    if (!ipLimit.allowed) {
      await logAudit('user.login_ip_rate_limited', req, null, { identifier, ip });
      res.status(429).json({
        success: false,
        message: `Too many login attempts. Try again in ${ipLimit.retryAfterMinutes} minutes.`,
      });
      return;
    }

    const userResults = await db.select().from(users).where(
      identifier.includes('@')
        ? eq(users.email, identifier.toLowerCase())
        : eq(users.username, identifier.toLowerCase()),
    ).limit(1);

    const user = userResults[0];
    if (!user) {
      await recordLoginAttempt(identifier, false, req);
      await recordLoginIpAttempt(ip);
      res.status(401).json({ success: false, message: 'Invalid credentials' });
      return;
    }

    const isPasswordValid = await comparePassword(password, user.password);
    if (!isPasswordValid) {
      await recordLoginAttempt(identifier, false, req);
      await recordLoginIpAttempt(ip);
      res.status(401).json({ success: false, message: 'Invalid credentials' });
      return;
    }

    await recordLoginAttempt(identifier, true, req);

    const accessToken = generateAccessToken({
      userId: user.id,
      email: user.email,
      emailVerified: user.emailVerified,
    });
    const tokenId = generateTokenId();
    const refreshToken = generateRefreshToken({ userId: user.id, tokenId });

    const tokenHash = hashToken(refreshToken);
    await db.insert(refreshTokens).values({
      userId: user.id,
      tokenHash,
      expiresAt: getRefreshTokenExpiry(),
      isRevoked: false,
    });

    setAuthCookies(res, accessToken, refreshToken);

    await logAudit('user.login', req, user.id);
    logger.info(`User logged in: ${user.email}`);

    // OAuth flow: generate auth code directly and return callback URL
    // (avoids relying on accounts_session cookie which fails cross-site on vercel.app PSL)
    if (client_id && redirect_uri) {
      // Check email verification if required
      const emailVerificationRequired = process.env.EMAIL_VERIFICATION_REQUIRED === 'true';
      if (emailVerificationRequired && !user.emailVerified) {
        res.status(403).json({
          success: false,
          message: 'Email verification required',
          error: 'Please verify your email before accessing other apps',
        });
        return;
      }

      // Validate client and redirect_uri
      const [client] = await db
        .select()
        .from(clientApps)
        .where(eq(clientApps.clientId, client_id))
        .limit(1);

      if (!client) {
        res.status(400).json({ success: false, message: 'Invalid client_id' });
        return;
      }

      const allowedUris = client.allowedRedirectUris as string[];
      if (!allowedUris.includes(redirect_uri)) {
        res.status(400).json({ success: false, message: 'Invalid redirect_uri' });
        return;
      }

      // PKCE is required
      if (!code_challenge) {
        res.status(400).json({ success: false, message: 'PKCE required. code_challenge is missing.' });
        return;
      }

      // Generate authorization code directly (same as /oauth/authorize would)
      const authCode = generateAuthCode();
      const codeHash = hashToken(authCode);
      await db.insert(authCodes).values({
        code: codeHash,
        userId: user.id,
        clientId: client_id,
        redirectUri: redirect_uri,
        codeChallenge: code_challenge,
        codeChallengeMethod: code_challenge_method || 'S256',
        nonce: nonce || null,
        expiresAt: getAuthCodeExpiry(),
        isUsed: false,
      });

      // Build callback URL with authorization code
      const callbackUrl = new URL(redirect_uri);
      callbackUrl.searchParams.set('code', authCode);
      if (state) {
        callbackUrl.searchParams.set('state', state);
      }

      logger.info(`Auth code generated via login for user ${user.id}, client ${client_id}`);

      res.status(200).json({
        success: true,
        message: 'Login successful. Redirecting...',
        data: {
          user: { id: user.id, email: user.email, name: user.name, emailVerified: user.emailVerified },
          redirectUrl: callbackUrl.toString(),
        },
      });
      return;
    }

    // Standard login (no OAuth) — tokens are in httpOnly cookies only, not in response body
    res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        user: { id: user.id, email: user.email, name: user.name, emailVerified: user.emailVerified },
      },
    });
  } catch (error) {
    logger.error('Login error:', error);
    next(error);
  }
};

// ─── FORGOT PASSWORD ────────────────────────────────────────────

export const forgotPassword = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { email } = req.body;

    if (!email) {
      res.status(400).json({ success: false, message: 'Email is required' });
      return;
    }

    // Rate limit email sending (3 per 15 min per email)
    const emailLimit = await checkActionRateLimit('email_send', email);
    if (!emailLimit.allowed) {
      res.status(429).json({ success: false, message: `Too many requests. Try again in ${emailLimit.retryAfterMinutes} minutes.` });
      return;
    }

    const successMsg = 'If that email is registered, a password reset link has been sent.';

    const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);
    if (!user) {
      res.status(200).json({ success: true, message: successMsg });
      return;
    }

    // Invalidate all previous unused reset tokens for this user
    await db
      .update(passwordResetTokens)
      .set({ isUsed: true })
      .where(and(eq(passwordResetTokens.userId, user.id), eq(passwordResetTokens.isUsed, false)));

    const resetToken = crypto.randomBytes(32).toString('base64url');
    const tokenHash = hashToken(resetToken);

    await db.insert(passwordResetTokens).values({
      userId: user.id,
      tokenHash,
      expiresAt: getPasswordResetExpiry(),
    });

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const resetUrl = `${frontendUrl}/reset-password?token=${resetToken}&email=${encodeURIComponent(user.email)}`;
    await sendPasswordResetEmail(user.email, resetUrl, user.name);

    await recordAction('email_send', email, req);
    await logAudit('user.forgot_password', req, user.id);

    res.status(200).json({ success: true, message: successMsg });
  } catch (error) {
    logger.error('Forgot password error:', error);
    next(error);
  }
};

// ─── RESET PASSWORD ─────────────────────────────────────────────

export const resetPassword = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { email, token, newPassword } = req.body;

    if (!email || !token || !newPassword) {
      res.status(400).json({ success: false, message: 'Email, token, and new password are required' });
      return;
    }

    const passwordCheck = validatePassword(newPassword);
    if (!passwordCheck.valid) {
      res.status(400).json({ success: false, message: 'Weak password', errors: passwordCheck.errors });
      return;
    }

    const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);
    if (!user) {
      res.status(400).json({ success: false, message: 'Invalid or expired reset token' });
      return;
    }

    const tokenHash = hashToken(token);
    const [resetRecord] = await db
      .select()
      .from(passwordResetTokens)
      .where(
        and(
          eq(passwordResetTokens.userId, user.id),
          eq(passwordResetTokens.tokenHash, tokenHash),
          eq(passwordResetTokens.isUsed, false),
        ),
      )
      .limit(1);

    if (!resetRecord) {
      res.status(400).json({ success: false, message: 'Invalid or expired reset token' });
      return;
    }

    if (new Date() > resetRecord.expiresAt) {
      res.status(400).json({ success: false, message: 'Reset token has expired. Please request a new one.' });
      return;
    }

    const hashedPassword = await hashPassword(newPassword);
    await db.update(users).set({ password: hashedPassword, updatedAt: new Date() }).where(eq(users.id, user.id));
    await db.update(passwordResetTokens).set({ isUsed: true }).where(eq(passwordResetTokens.id, resetRecord.id));

    // Revoke all refresh tokens for security
    await db.update(refreshTokens).set({ isRevoked: true }).where(eq(refreshTokens.userId, user.id));

    await logAudit('user.password_reset', req, user.id);
    logger.info(`Password reset for: ${user.email}`);

    res.status(200).json({ success: true, message: 'Password reset successfully. Please log in.' });
  } catch (error) {
    logger.error('Reset password error:', error);
    next(error);
  }
};

// ─── REFRESH TOKEN ──────────────────────────────────────────────

export const refresh = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const refreshTokenValue = req.cookies?.refresh_token || req.body.refreshToken;

    if (!refreshTokenValue) {
      res.status(401).json({ success: false, message: 'Refresh token required' });
      return;
    }

    let decoded;
    try {
      decoded = verifyRefreshToken(refreshTokenValue);
    } catch {
      res.status(401).json({ success: false, message: 'Invalid or expired refresh token' });
      return;
    }

    const tokenHash = hashToken(refreshTokenValue);
    const [storedToken] = await db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, tokenHash))
      .limit(1);

    if (!storedToken) {
      res.status(401).json({ success: false, message: 'Invalid refresh token' });
      return;
    }

    // Reuse detection: if a revoked token is used, the family is compromised
    if (storedToken.isRevoked) {
      logger.warn(`Refresh token reuse detected for user ${decoded.userId}. Revoking all sessions.`);
      await db.update(refreshTokens).set({ isRevoked: true }).where(eq(refreshTokens.userId, decoded.userId));
      await logAudit('security.token_reuse', req, decoded.userId);
      res.status(401).json({ success: false, message: 'Session invalidated for security. Please log in again.' });
      return;
    }

    if (new Date() > storedToken.expiresAt) {
      res.status(401).json({ success: false, message: 'Refresh token expired' });
      return;
    }

    const [user] = await db.select().from(users).where(eq(users.id, decoded.userId)).limit(1);
    if (!user) {
      res.status(401).json({ success: false, message: 'User not found' });
      return;
    }

    // Token rotation: revoke old token and issue new pair
    await db.update(refreshTokens).set({ isRevoked: true, lastUsedAt: new Date() }).where(eq(refreshTokens.tokenHash, tokenHash));

    const newAccessToken = generateAccessToken({
      userId: user.id,
      email: user.email,
      emailVerified: user.emailVerified,
    });
    const newTokenId = generateTokenId();
    const newRefreshTokenValue = generateRefreshToken({ userId: user.id, tokenId: newTokenId });

    const newTokenHash = hashToken(newRefreshTokenValue);
    await db.insert(refreshTokens).values({
      userId: user.id,
      tokenHash: newTokenHash,
      expiresAt: getRefreshTokenExpiry(),
      isRevoked: false,
    });

    // Set cookies for browser-based calls
    setAuthCookies(res, newAccessToken, newRefreshTokenValue);

    logger.info(`Token refreshed (rotated) for user: ${user.email}`);

    // Return tokens in body for server-to-server calls (e.g., 360 server)
    res.status(200).json({
      success: true,
      message: 'Token refreshed successfully',
      data: { accessToken: newAccessToken, refreshToken: newRefreshTokenValue },
    });
  } catch (error) {
    logger.error('Refresh token error:', error);
    next(error);
  }
};

// ─── LOGOUT (POST) ──────────────────────────────────────────────

export const logout = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const refreshTokenValue = req.cookies?.refresh_token;

    if (refreshTokenValue) {
      const tokenHash = hashToken(refreshTokenValue);
      await db.update(refreshTokens).set({ isRevoked: true }).where(eq(refreshTokens.tokenHash, tokenHash));
    }

    clearAuthCookies(res);

    logger.info('User logged out successfully');
    res.status(200).json({ success: true, message: 'Logged out successfully' });
  } catch (error) {
    logger.error('Logout error:', error);
    next(error);
  }
};

// ─── LOGOUT (GET - redirect, for client apps) ──────────────────

export const logoutRedirect = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { redirect_uri } = req.query;

    const refreshTokenValue = req.cookies?.refresh_token;
    if (refreshTokenValue) {
      const tokenHash = hashToken(refreshTokenValue);
      await db.update(refreshTokens).set({ isRevoked: true }).where(eq(refreshTokens.tokenHash, tokenHash));
    }

    clearAuthCookies(res);

    logger.info('User logged out via redirect');

    // Validate redirect_uri against registered client app URIs (exact origin match + safe protocol)
    if (redirect_uri && typeof redirect_uri === 'string') {
      try {
        const parsedUrl = new URL(redirect_uri);

        // Only allow http/https protocols
        if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
          logger.warn(`Blocked redirect with unsafe protocol: ${redirect_uri}`);
        } else {
          const allClients = await db.select({ allowedRedirectUris: clientApps.allowedRedirectUris }).from(clientApps);
          const allowedOrigins = new Set<string>();

          for (const client of allClients) {
            for (const uri of client.allowedRedirectUris as string[]) {
              try { allowedOrigins.add(new URL(uri).origin); } catch {}
            }
          }

          const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
          allowedOrigins.add(new URL(frontendUrl).origin);

          if (allowedOrigins.has(parsedUrl.origin)) {
            res.redirect(redirect_uri);
            return;
          }
        }
      } catch {}

      logger.warn(`Blocked redirect to unregistered URI: ${redirect_uri}`);
    }

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    res.redirect(`${frontendUrl}/login`);
  } catch (error) {
    logger.error('Logout redirect error:', error);
    next(error);
  }
};

// ─── GET CURRENT USER ───────────────────────────────────────────

export const getCurrentUser = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Not authenticated' });
      return;
    }

    const [user] = await db.select().from(users).where(eq(users.id, req.user.userId)).limit(1);
    if (!user) {
      res.status(404).json({ success: false, message: 'User not found' });
      return;
    }

    res.status(200).json({
      success: true,
      data: {
        id: user.id,
        email: user.email,
        username: user.username,
        name: user.name,
        emailVerified: user.emailVerified,
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    logger.error('Get current user error:', error);
    next(error);
  }
};
