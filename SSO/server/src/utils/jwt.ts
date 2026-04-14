import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import bcrypt from 'bcrypt';

const ACCESS_TOKEN_SECRET: string = process.env.ACCESS_TOKEN_SECRET!;
const REFRESH_TOKEN_SECRET: string = process.env.REFRESH_TOKEN_SECRET!;
const ID_TOKEN_SECRET: string = process.env.ID_TOKEN_SECRET || ACCESS_TOKEN_SECRET;

const ACCESS_TOKEN_EXPIRY = '1h';
const REFRESH_TOKEN_EXPIRY = '30d';

export interface AccessTokenPayload {
  userId: string;
  email: string;
  emailVerified: boolean;
}

export interface RefreshTokenPayload {
  userId: string;
  tokenId: string; // unique identifier for this refresh token
}

export interface IdTokenPayload {
  userId: string;
  email: string;
  name: string | null;
  emailVerified: boolean;
  nonce?: string; // OpenID Connect nonce — echoed back to prevent replay
}

// ACCESS TOKEN FUNCTIONS
// Generate a short-lived access token (1 hour)
export function generateAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, ACCESS_TOKEN_SECRET, {
    expiresIn: ACCESS_TOKEN_EXPIRY,
    issuer: 'accounts.shelfex.com',
    audience: 'shelfex-services',
  });
}

// Verify and decode an access token
export function verifyAccessToken(token: string): AccessTokenPayload {
  try {
    const decoded = jwt.verify(token, ACCESS_TOKEN_SECRET, {
      issuer: 'accounts.shelfex.com',
      audience: 'shelfex-services',
    }) as AccessTokenPayload;
    return decoded;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new Error('Access token expired');
    }
    if (error instanceof jwt.JsonWebTokenError) {
      throw new Error('Invalid access token');
    }
    throw error;
  }
}

// ID TOKEN FUNCTIONS (OAuth)
// Generate an ID token with user information for OAuth clients
// Uses separate secret and audience to prevent token confusion with access tokens
export function generateIdToken(payload: IdTokenPayload): string {
  return jwt.sign(payload, ID_TOKEN_SECRET, {
    expiresIn: ACCESS_TOKEN_EXPIRY,
    issuer: 'accounts.shelfex.com',
    audience: 'shelfex-id-token',
  });
}

// REFRESH TOKEN FUNCTIONS
// Generate a long-lived refresh token (30 days)
export function generateRefreshToken(payload: RefreshTokenPayload): string {
  return jwt.sign(payload, REFRESH_TOKEN_SECRET, {
    expiresIn: REFRESH_TOKEN_EXPIRY,
    issuer: 'accounts.shelfex.com',
  });
}

// Verify and decode a refresh token
export function verifyRefreshToken(token: string): RefreshTokenPayload {
  try {
    const decoded = jwt.verify(token, REFRESH_TOKEN_SECRET, {
      issuer: 'accounts.shelfex.com',
    }) as RefreshTokenPayload;
    return decoded;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new Error('Refresh token expired');
    }
    if (error instanceof jwt.JsonWebTokenError) {
      throw new Error('Invalid refresh token');
    }
    throw error;
  }
}

// PASSWORD HASHING
const SALT_ROUNDS = 12;

// Hash a plain text password using bcrypt
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

// Compare a plain text password with a hashed password
export async function comparePassword(password: string, hashedPassword: string): Promise<boolean> {
  return bcrypt.compare(password, hashedPassword);
}

// TOKEN HASHING (for storing refresh tokens)
// Hash a refresh token for storage in database (Uses SHA256 for fast lookups)
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// RANDOM CODE GENERATION
// enerate a cryptographically secure random authorization code
export function generateAuthCode(): string {
  return crypto.randomBytes(32).toString('base64url');
}

// Generate a unique token ID for refresh tokens
export function generateTokenId(): string {
  return crypto.randomUUID();
}

// TOKEN EXPIRY HELPERS
// Get expiry date for refresh token (30 days from now)
export function getRefreshTokenExpiry(): Date {
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + 30);
  return expiry;
}

// Get expiry date for auth code (10 minutes from now)
export function getAuthCodeExpiry(): Date {
  const expiry = new Date();
  expiry.setMinutes(expiry.getMinutes() + 10);
  return expiry;
}
