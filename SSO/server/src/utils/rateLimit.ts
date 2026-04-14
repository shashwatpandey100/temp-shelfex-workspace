import { Request } from 'express';
import { db } from '../db';
import { loginAttempts } from '../db/schema';
import { eq, and, gte } from 'drizzle-orm';
import { sql } from 'drizzle-orm';

// ─── LOGIN RATE LIMITING ────────────────────────────────────────

const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_WINDOW_MINUTES = 15;

export interface RateLimitResult {
  allowed: boolean;
  remainingAttempts: number;
  retryAfterMinutes?: number;
}

// IP-based login rate limit (prevents credential stuffing across many accounts from one IP)
export async function checkLoginIpRateLimit(ip: string): Promise<RateLimitResult> {
  const config = ACTION_LIMITS['login_ip'];
  const identifier = `login_ip:${ip}`;
  const windowStart = new Date(Date.now() - config.windowMinutes * 60 * 1000);

  const [result] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(loginAttempts)
    .where(
      and(
        eq(loginAttempts.identifier, identifier),
        gte(loginAttempts.createdAt, windowStart),
      ),
    );

  const count = result?.count || 0;
  const remaining = Math.max(0, config.maxAttempts - count);

  if (count >= config.maxAttempts) {
    return { allowed: false, remainingAttempts: 0, retryAfterMinutes: config.windowMinutes };
  }

  return { allowed: true, remainingAttempts: remaining };
}

export async function recordLoginIpAttempt(ip: string) {
  const identifier = `login_ip:${ip}`;
  await db.insert(loginAttempts).values({
    identifier,
    ipAddress: ip,
    success: true,
  });
}

export async function checkLoginRateLimit(identifier: string): Promise<RateLimitResult> {
  const windowStart = new Date(Date.now() - LOGIN_WINDOW_MINUTES * 60 * 1000);

  const [result] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(loginAttempts)
    .where(
      and(
        eq(loginAttempts.identifier, identifier.toLowerCase()),
        eq(loginAttempts.success, false),
        gte(loginAttempts.createdAt, windowStart),
      ),
    );

  const failedCount = result?.count || 0;
  const remaining = Math.max(0, LOGIN_MAX_ATTEMPTS - failedCount);

  if (failedCount >= LOGIN_MAX_ATTEMPTS) {
    return { allowed: false, remainingAttempts: 0, retryAfterMinutes: LOGIN_WINDOW_MINUTES };
  }

  return { allowed: true, remainingAttempts: remaining };
}

export async function recordLoginAttempt(identifier: string, success: boolean, req: Request) {
  await db.insert(loginAttempts).values({
    identifier: identifier.toLowerCase(),
    ipAddress: req.ip || null,
    success,
  });
}

// ─── GENERIC ACTION RATE LIMITING ───────────────────────────────
// Uses the same login_attempts table with action-prefixed identifiers
// e.g. "email:user@test.com", "verify:user@test.com", "reset:user@test.com"

interface ActionRateLimitConfig {
  maxAttempts: number;
  windowMinutes: number;
}

const ACTION_LIMITS: Record<string, ActionRateLimitConfig> = {
  'email_send': { maxAttempts: 3, windowMinutes: 15 },     // resend-verification, forgot-password
  'verify_attempt': { maxAttempts: 5, windowMinutes: 15 },  // OTP brute force protection
  'register': { maxAttempts: 5, windowMinutes: 60 },        // registration spam
  'oauth_token': { maxAttempts: 10, windowMinutes: 15 },    // token exchange spam
  'login_ip': { maxAttempts: 20, windowMinutes: 15 },       // credential stuffing protection per IP
};

export async function checkActionRateLimit(action: string, key: string): Promise<RateLimitResult> {
  const config = ACTION_LIMITS[action];
  if (!config) return { allowed: true, remainingAttempts: 999 };

  const identifier = `${action}:${key.toLowerCase()}`;
  const windowStart = new Date(Date.now() - config.windowMinutes * 60 * 1000);

  const [result] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(loginAttempts)
    .where(
      and(
        eq(loginAttempts.identifier, identifier),
        gte(loginAttempts.createdAt, windowStart),
      ),
    );

  const count = result?.count || 0;
  const remaining = Math.max(0, config.maxAttempts - count);

  if (count >= config.maxAttempts) {
    return { allowed: false, remainingAttempts: 0, retryAfterMinutes: config.windowMinutes };
  }

  return { allowed: true, remainingAttempts: remaining };
}

export async function recordAction(action: string, key: string, req: Request) {
  const identifier = `${action}:${key.toLowerCase()}`;
  await db.insert(loginAttempts).values({
    identifier,
    ipAddress: req.ip || null,
    success: true, // just counting occurrences
  });
}
