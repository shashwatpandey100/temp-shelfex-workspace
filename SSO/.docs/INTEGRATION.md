# Shelfex SSO Integration Guide

Complete guide for integrating Shelfex OAuth 2.0 authentication into your application.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Architecture Overview](#architecture-overview)
3. [Environment Configuration](#environment-configuration)
4. [Register Your Client App](#register-your-client-app)
5. [Implementation Guide](#implementation-guide)
6. [Security Features](#security-features)
7. [Testing Your Integration](#testing-your-integration)
8. [Production Deployment](#production-deployment)
9. [Troubleshooting](#troubleshooting)
10. [SSO API Reference](#sso-api-reference)

---

## Prerequisites

- Node.js 18+
- Next.js 14+ (App Router) with a separate Express backend
- Access to Shelfex SSO (locally on port 8000, or deployed)
- Your app registered in the SSO `client_apps` table

---

## Architecture Overview

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│  Your App   │     │  Your App    │     │  Shelfex    │
│  (Next.js)  │◄───►│  (Express)   │◄───►│  SSO        │
│  Frontend   │     │  Backend     │     │  Backend    │
│  port 3001  │     │  port 4000   │     │  port 8000  │
└─────────────┘     └──────────────┘     └─────────────┘
```

**OAuth 2.0 Authorization Code Flow with PKCE:**

1. User visits your app → middleware redirects to SSO `/oauth/authorize` with PKCE challenge
2. SSO checks `accounts_session` cookie:
   - **Same-site (already logged in):** SSO generates auth code directly → redirects back to your callback URL
   - **Cross-site / not logged in:** SSO redirects to login page (preserving all OAuth params)
3. User logs in → SSO validates credentials → generates auth code directly in login response → SSO frontend redirects user to your callback URL with code
4. Your frontend sends code + PKCE verifier to your backend
5. Your backend exchanges code + verifier + client_secret for tokens via SSO `/oauth/token`
6. Tokens stored in httpOnly cookies on your backend's domain (for API requests)
7. Backend returns access_token in response body → **callback page sets `session_token` cookie on the Next.js domain** (so middleware can detect auth)
8. Middleware validates JWT on subsequent requests

> **Cross-Domain Note:** The login-initiated flow (step 3) generates the auth code directly after password verification, avoiding the need for an `accounts_session` cookie. This ensures SSO works across any domains — not just subdomains of the same site.

> **Cookie Architecture Note:** When the Next.js frontend (e.g. port 3001) and Express backend (e.g. port 4000) run on different ports, they are different origins. httpOnly cookies set by the backend are only sent to the backend — the Next.js middleware cannot read them. To solve this, the backend returns the `access_token` in the callback response body, and the callback page sets a `session_token` cookie on the Next.js domain for middleware to check.

---

## Environment Configuration

### Your Next.js Client (`.env.local`)

```bash
# SSO OAuth endpoint
NEXT_PUBLIC_SSO_URL=http://localhost:8000/api/v1

# Your API backend
NEXT_PUBLIC_API_URL=http://localhost:4000/api/v1

# Your registered client ID
NEXT_PUBLIC_CLIENT_ID=your-client-id

# Your callback URL (must match what's registered in SSO)
NEXT_PUBLIC_CALLBACK_URL=http://localhost:3001/auth/callback
```

### Your Express Backend (`.env`)

```bash
NODE_ENV=development
PORT=4000

# SSO API URL (server-to-server)
SSO_API_URL=http://localhost:8000/api/v1

# Your registered client credentials
SSO_CLIENT_ID=your-client-id
SSO_CLIENT_SECRET=your-client-secret

# Your callback URL (must match what's registered in SSO)
SSO_CALLBACK_URL=http://localhost:3001/auth/callback

# Must match the SSO server's ACCESS_TOKEN_SECRET to verify JWTs locally
ACCESS_TOKEN_SECRET=same-as-sso-server

# CORS — your frontend origin
CORS_ORIGIN=http://localhost:3001
```

---

## Register Your Client App

Your app must be registered in the SSO `client_apps` table.

### Option 1: Add to Seed Script

Add your app to `SSO/server/src/seed.ts`:

```typescript
{
  clientId: 'your-app-id',
  clientSecret: 'your-app-dev-secret-2025', // CHANGE IN PRODUCTION!
  name: 'Your App Name',
  allowedRedirectUris: [
    'http://localhost:3001/auth/callback',
    'https://yourapp.shelfexecution.com/auth/callback',
  ],
}
```

Then run: `npm run db:seed`

### Option 2: Direct SQL

```sql
-- Hash your secret first: await bcrypt.hash('your_secret', 12)
INSERT INTO client_apps (client_id, name, client_secret, allowed_redirect_uris)
VALUES (
  'your-app-id',
  'Your App Name',
  '$2b$12$hashed_secret_here',
  '["http://localhost:3001/auth/callback", "https://yourapp.example.com/auth/callback"]'
);
```

**Important:**
- `client_secret` is stored bcrypt-hashed (12 rounds)
- `allowed_redirect_uris` must include ALL callback URLs (dev + prod)
- Keep your plaintext secret in `.env` only, never commit it

---

## Implementation Guide

### Step 1: Next.js Middleware (`middleware.ts`)

Protects all routes, redirects unauthenticated users to SSO with PKCE + state + nonce.

```typescript
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Edge Runtime compatible JWT decode (no Node.js crypto dependency)
// Verification happens server-side in your Express auth middleware
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const decoded = atob(payload);
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Auth error page — always accessible
  if (pathname.startsWith('/auth/error')) {
    return NextResponse.next();
  }

  // OAuth callback — validate state (CSRF protection)
  if (pathname.startsWith('/auth/callback')) {
    const state = request.nextUrl.searchParams.get('state');
    const storedState = request.cookies.get('oauth_state')?.value;

    if (!state || !storedState || state !== storedState) {
      return NextResponse.redirect(new URL('/auth/error?reason=invalid_state', request.url));
    }

    const response = NextResponse.next();
    response.cookies.delete('oauth_state');
    return response;
  }

  // Check session_token (set by callback page on this domain) or access_token (if same-origin)
  // When frontend and backend are on different ports, the backend's httpOnly cookies
  // are NOT visible here — session_token bridges that gap.
  const sessionToken = request.cookies.get('session_token')?.value || request.cookies.get('access_token')?.value;

  if (!sessionToken) {
    return await redirectToSSO(request);
  }

  // Decode without verification — just check expiry (verification is server-side)
  const decoded = decodeJwtPayload(sessionToken);
  if (!decoded || typeof decoded.exp !== 'number' || decoded.exp * 1000 < Date.now()) {
    return await redirectToSSO(request);
  }

  return NextResponse.next();
}

// --- PKCE Helpers ---

function generateCodeVerifier(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// --- Redirect to SSO ---

async function redirectToSSO(request: NextRequest) {
  const ssoUrl = process.env.NEXT_PUBLIC_SSO_URL || 'http://localhost:8000/api/v1';
  const clientId = process.env.NEXT_PUBLIC_CLIENT_ID!;
  const callbackUrl = process.env.NEXT_PUBLIC_CALLBACK_URL!;

  // CSRF state
  const state = crypto.randomUUID();

  // PKCE: code_verifier (stored in cookie) + code_challenge (sent to SSO)
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);

  // OpenID Connect nonce (for ID token replay protection)
  const nonce = crypto.randomUUID();

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: callbackUrl,
    response_type: 'code',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    nonce,
  });

  const response = NextResponse.redirect(`${ssoUrl}/oauth/authorize?${params.toString()}`);

  // SameSite=None is required because the OAuth redirect chain goes cross-site
  // (your app → SSO → your app), and browsers won't send SameSite=Lax cookies
  // on the final redirect back. Secure=true works on localhost (secure context).
  const cookieOptions = {
    httpOnly: true,
    secure: true,
    sameSite: 'none' as const,
    maxAge: 60 * 10, // 10 minutes
    path: '/',
  };

  response.cookies.set('oauth_state', state, cookieOptions);
  // PKCE verifier must be readable by callback page JS to forward to backend
  response.cookies.set('pkce_verifier', codeVerifier, { ...cookieOptions, httpOnly: false });
  response.cookies.set('oauth_nonce', nonce, cookieOptions);

  return response;
}

export const config = {
  matcher: [
    // Only exclude auth/error — /auth/callback MUST go through middleware for state validation
    '/((?!_next/static|_next/image|favicon.ico|auth/error).*)',
  ],
};
```

> **Important:** The matcher must NOT exclude `/auth/callback`. The middleware validates the OAuth `state` parameter on callback to prevent CSRF. Only `/auth/error` should be excluded.

### Step 2: Callback Page (`app/auth/callback/page.tsx`)

Reads the auth code + PKCE verifier and sends them to your backend.

```typescript
'use client';

import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

function CallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleCallback = async () => {
      try {
        const code = searchParams.get('code');
        const state = searchParams.get('state');

        if (!code) {
          throw new Error('No authorization code received');
        }

        // Read PKCE verifier from cookie (set by middleware)
        const pkceVerifier = document.cookie
          .split('; ')
          .find((c) => c.startsWith('pkce_verifier='))
          ?.split('=')[1];

        // Clear the one-time PKCE verifier cookie (must match Secure + SameSite=None)
        document.cookie = 'pkce_verifier=; path=/; max-age=0; SameSite=None; Secure';

        // Send code + verifier to your backend for token exchange
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL}/auth/callback`,
          {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              code,
              state,
              ...(pkceVerifier && { code_verifier: pkceVerifier }),
            }),
          }
        );

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.message || 'Authentication failed');
        }

        const result = await response.json();

        // Set session cookie on the Next.js domain so middleware can detect auth.
        // The httpOnly cookies from the backend (different port) aren't visible to middleware.
        const token = result?.data?.access_token;
        if (token) {
          document.cookie = `session_token=${token}; path=/; max-age=3600; SameSite=Lax`;
        }

        // Full reload so auth context re-fetches with the new cookies
        window.location.href = '/dashboard';
      } catch (err: any) {
        setError(err.message || 'Authentication failed');
      }
    };

    handleCallback();
  }, [searchParams, router]);

  if (error) {
    return (
      <div style={{ textAlign: 'center', padding: '4rem' }}>
        <h2>Authentication Error</h2>
        <p>{error}</p>
        <button onClick={() => router.push('/')}>Try Again</button>
      </div>
    );
  }

  return (
    <div style={{ textAlign: 'center', padding: '4rem' }}>
      <p>Completing authentication...</p>
    </div>
  );
}

export default function CallbackPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <CallbackContent />
    </Suspense>
  );
}
```

### Step 3: Express Backend — Auth Controller

Your backend exchanges the code for tokens server-side (where `client_secret` is safe).

```typescript
import { Request, Response, NextFunction } from 'express';
import axios from 'axios';

const SSO_API_URL = process.env.SSO_API_URL!;
const SSO_CLIENT_ID = process.env.SSO_CLIENT_ID!;
const SSO_CLIENT_SECRET = process.env.SSO_CLIENT_SECRET!;
const SSO_CALLBACK_URL = process.env.SSO_CALLBACK_URL!;

// POST /auth/callback — Exchange auth code for tokens
export const callback = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { code, state, code_verifier } = req.body;

    if (!code) {
      res.status(400).json({ success: false, message: 'Authorization code is required' });
      return;
    }

    // Exchange code + PKCE verifier for tokens with SSO
    const tokenResponse = await axios.post(`${SSO_API_URL}/oauth/token`, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: SSO_CALLBACK_URL,
      client_id: SSO_CLIENT_ID,
      client_secret: SSO_CLIENT_SECRET,
      ...(code_verifier && { code_verifier }),
    });

    const { access_token, refresh_token } = tokenResponse.data;
    const isProduction = process.env.NODE_ENV === 'production';

    res.cookie('access_token', access_token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      maxAge: 60 * 60 * 1000, // 1 hour (matches JWT expiry)
      path: '/',
    });

    res.cookie('refresh_token', refresh_token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      path: '/',
    });

    // Return access_token in body so the Next.js callback page can set a
    // session cookie on its own domain (needed when frontend/backend are different origins)
    res.status(200).json({ success: true, message: 'Authentication successful', data: { access_token } });
  } catch (error: any) {
    const status = error.response?.status || 500;
    const message = error.response?.data?.message || 'Token exchange failed';
    res.status(status).json({ success: false, message });
  }
};

// POST /auth/refresh — Refresh access token via SSO
export const refresh = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const refreshToken = req.cookies?.refresh_token;
    if (!refreshToken) {
      res.status(401).json({ success: false, message: 'No refresh token' });
      return;
    }

    const tokenResponse = await axios.post(`${SSO_API_URL}/auth/refresh`, { refreshToken });
    const { accessToken, refreshToken: newRefreshToken } = tokenResponse.data.data;
    const isProduction = process.env.NODE_ENV === 'production';

    res.cookie('access_token', accessToken, {
      httpOnly: true, secure: isProduction, sameSite: 'lax',
      maxAge: 60 * 60 * 1000, path: '/',
    });

    // SSO rotates refresh tokens — always save the new one
    if (newRefreshToken) {
      res.cookie('refresh_token', newRefreshToken, {
        httpOnly: true, secure: isProduction, sameSite: 'lax',
        maxAge: 30 * 24 * 60 * 60 * 1000, path: '/',
      });
    }

    res.status(200).json({ success: true, message: 'Token refreshed' });
  } catch (error: any) {
    res.clearCookie('access_token', { path: '/' });
    res.clearCookie('refresh_token', { path: '/' });
    res.status(401).json({ success: false, message: 'Token refresh failed' });
  }
};

// GET /auth/me — Return user info from JWT
export const me = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ success: false, message: 'Not authenticated' });
    return;
  }
  res.status(200).json({
    success: true,
    data: { userId: req.user.userId, email: req.user.email, emailVerified: req.user.emailVerified },
  });
};

// POST /auth/logout — Clear cookies and revoke SSO refresh token
export const logout = async (req: Request, res: Response): Promise<void> => {
  const refreshToken = req.cookies?.refresh_token;

  // Revoke the refresh token at SSO server (best-effort, non-blocking)
  if (refreshToken) {
    try {
      await axios.post(`${SSO_API_URL}/auth/logout`, {}, {
        headers: { Cookie: `refresh_token=${refreshToken}` },
      });
    } catch {
      // Non-blocking — don't fail the user's logout
    }
  }

  res.clearCookie('access_token', { path: '/' });
  res.clearCookie('refresh_token', { path: '/' });
  res.status(200).json({ success: true, message: 'Logged out' });
};
```

### Step 4: Auth Middleware for Your Backend

Validates JWTs using the same `ACCESS_TOKEN_SECRET` as the SSO server.

```typescript
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET!;

export const authMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const token = req.cookies?.access_token || req.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    res.status(401).json({ success: false, message: 'No token provided' });
    return;
  }

  try {
    const decoded = jwt.verify(token, ACCESS_TOKEN_SECRET, {
      issuer: 'accounts.shelfex.com',
      audience: 'shelfex-services',
    });
    req.user = decoded as any;
    next();
  } catch {
    res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
};
```

### Step 5: Logout with SSO Session Clearing

Clearing cookies on your domain is not enough — the `accounts_session` cookie lives on the SSO domain. Without clearing it, the user is silently re-authenticated on their next visit.

```typescript
const handleLogout = async () => {
  // 1. Clear your app's cookies (API domain)
  await fetch(`${process.env.NEXT_PUBLIC_API_URL}/auth/logout`, {
    method: 'POST', credentials: 'include',
  });

  // 2. Clear the session_token cookie on the Next.js domain
  document.cookie = 'session_token=; path=/; max-age=0';

  // 3. Redirect to SSO logout to clear accounts_session
  const ssoUrl = process.env.NEXT_PUBLIC_SSO_URL;
  window.location.href = `${ssoUrl}/auth/logout?redirect_uri=${encodeURIComponent(window.location.origin)}`;
};
```

### Step 6: Auto Token Refresh (Axios Interceptor)

Add this interceptor to your frontend API client so expired tokens are automatically refreshed without interrupting the user.

```typescript
import axios from 'axios';

const apiClient = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1',
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

// Auto-refresh: intercept 401 "Token expired" and retry after refreshing
let isRefreshing = false;
let failedQueue: { resolve: (v: unknown) => void; reject: (e: unknown) => void }[] = [];

const processQueue = (error: unknown | null) => {
  failedQueue.forEach(({ resolve, reject }) => {
    if (error) reject(error);
    else resolve(undefined);
  });
  failedQueue = [];
};

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (
      error.response?.status === 401 &&
      error.response?.data?.message === 'Token expired' &&
      !originalRequest._retry &&
      !originalRequest.url?.includes('/auth/refresh') &&
      !originalRequest.url?.includes('/auth/callback')
    ) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        }).then(() => apiClient(originalRequest));
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        await apiClient.post('/auth/refresh');
        processQueue(null);
        return apiClient(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError);
        if (typeof window !== 'undefined') window.location.href = '/';
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  },
);

export default apiClient;
```

**How it works:**
- Intercepts any 401 with `"Token expired"` message
- Calls `/auth/refresh` to get a new token pair (via httpOnly cookies)
- Retries the original failed request
- Queues concurrent requests during refresh (avoids multiple refresh calls)
- Redirects to `/` (triggers SSO login) if refresh itself fails

---

## Security Features

These are handled automatically by the SSO and your integration:

| Feature | Description |
|---------|-------------|
| **PKCE (S256, enforced)** | Required on all OAuth flows. Middleware generates `code_verifier` → sends `code_challenge` to SSO → backend sends `code_verifier` during token exchange. SSO rejects requests without `code_challenge`. Default method: S256. |
| **OAuth State** | CSRF protection on the OAuth flow. Random state stored in httpOnly cookie, validated on callback. |
| **Nonce** | ID token replay protection. Random value embedded in ID token for verification. |
| **Refresh Token Rotation** | Each refresh invalidates the old token and issues a new one. Reuse of a revoked token revokes ALL sessions for that user. |
| **Hashed Secrets** | Auth codes, OTPs, and refresh tokens are SHA-256 hashed before DB storage. |
| **Rate Limiting** | Login: 5/15min per account + 20/15min per IP. Registration: 5/hour per IP. |
| **httpOnly Cookies** | Auth tokens (`access_token`, `refresh_token`) in httpOnly cookies — no JS access. `session_token` on the Next.js domain is non-httpOnly (JWT only, used for middleware routing). |
| **sameSite: none + secure** | OAuth flow cookies (`oauth_state`, `pkce_verifier`, `oauth_nonce`) use `SameSite=None; Secure` to survive cross-site redirect chains. API cookies use `SameSite=Lax`. |

### What you must do

- Set `ACCESS_TOKEN_SECRET` in your backend `.env` to **match the SSO server's value**
- Use **HTTPS** in production (`secure: true` on cookies)
- Never expose `client_secret` in frontend code
- Always save the **rotated refresh token** from `/auth/refresh` responses

---

## Testing Your Integration

### 1. Start all services

```bash
# SSO backend (port 8000)
cd SSO/server && npm run dev

# SSO frontend (port 3000)
cd SSO/client && npm run dev

# Your app backend (port 4000)
cd your-app/server && npm run dev

# Your app frontend (port 3001)
cd your-app/client && npm run dev
```

### 2. Test the flow

1. Visit `http://localhost:3001` → redirected to SSO login
2. Login with test credentials (`test@shelfex.com` / `12345`)
3. Redirected to `/auth/callback` → then to `/dashboard`
4. Check DevTools → Application → Cookies → see `access_token`, `refresh_token`

### 3. Test SSO across apps

1. Login to App A (port 3001)
2. Open App B (port 3002) → auto-authenticated, no login required

### 4. Test token refresh

1. Wait for access token to expire (1 hour) or delete `access_token` cookie
2. Call `/auth/refresh` → get new token pair
3. Verify `refresh_token` cookie also updated (rotation)

---

## Production Deployment

### Deploy order

1. **SSO server** — PKCE is enforced (`code_challenge` required)
2. **Your Express backend** — forwards `code_verifier` to SSO
3. **Your Next.js frontend** — generates PKCE challenge + nonce

### Checklist

- [ ] `allowed_redirect_uris` includes production callback URL
- [ ] `CORS_ORIGIN` on SSO includes your production frontend domain
- [ ] `ACCESS_TOKEN_SECRET` matches across SSO and your backend
- [ ] HTTPS enabled (cookies use `secure: true` in production)
- [ ] `client_secret` is not in any frontend env vars

---

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| "Invalid redirect_uri" | Callback URL not in `allowed_redirect_uris` | Add exact URL (with protocol + port) to DB |
| "Invalid client credentials" | Wrong `client_secret` | Verify plaintext secret matches what was bcrypt-hashed in DB |
| "PKCE code_verifier required" | Missing verifier in token exchange | Ensure `pkce_verifier` cookie is set and forwarded to backend |
| "Invalid code_verifier" | PKCE verification failed | Verify `code_challenge = BASE64URL(SHA256(code_verifier))` |
| "Invalid state parameter" | State cookie expired or mismatch | Complete OAuth flow within 10 minutes. Ensure OAuth cookies use `SameSite=None; Secure` (required for cross-site redirect chains). |
| Cookies not set | `secure: true` without HTTPS | `localhost` is a secure context so `Secure` cookies work. For non-localhost dev, use `NODE_ENV=development`. |
| Middleware always redirects to SSO | `access_token` cookie is on the API domain (different port), invisible to Next.js middleware | Use `session_token` cookie set by callback page on the Next.js domain (see Step 2). |
| Infinite redirect loop | Callback route is protected | Ensure middleware excludes `/auth/error` only (NOT all `/auth/*` — `/auth/callback` must go through middleware for state validation) |
| Infinite redirect loop (cross-domain) | `accounts_session` cookie rejected cross-site | SSO login-initiated flow handles this automatically — ensure SSO server is updated |
| `jsonwebtoken` crash in middleware | Next.js Edge Runtime doesn't support Node.js `crypto` | Use manual base64 JWT decode (see middleware example above). Do NOT use `jsonwebtoken` in middleware. |
| Token expired, no auto-refresh | Missing axios interceptor | Add the token refresh interceptor (Step 6) to your API client |
| All sessions revoked unexpectedly | Refresh token reuse detected | Intentional security — stolen token was reused. User must re-login. |
| `expires_in` mismatch | Cookie maxAge doesn't match JWT | Set access_token cookie `maxAge: 60 * 60 * 1000` (1 hour) |

---

## SSO API Reference

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/v1/oauth/authorize` | GET | Start OAuth flow. Params: `client_id`, `redirect_uri`, `response_type=code`, `state`, `code_challenge`, `code_challenge_method`, `nonce` |
| `/api/v1/oauth/token` | POST | Exchange code for tokens. Body: `grant_type`, `code`, `redirect_uri`, `client_id`, `client_secret`, `code_verifier` |
| `/api/v1/auth/login` | POST | Login. Body: `identifier`, `password`. OAuth params (when redirected from `/oauth/authorize`): `client_id`, `redirect_uri`, `state`, `code_challenge`, `code_challenge_method`, `nonce` |
| `/api/v1/auth/refresh` | POST | Refresh tokens. Body/cookie: `refreshToken`. Returns new `accessToken` + `refreshToken` (rotation). |
| `/api/v1/auth/logout` | POST | API logout. Revokes refresh token, clears cookies. |
| `/api/v1/auth/logout` | GET | Redirect logout. Param: `redirect_uri`. Clears SSO session + redirects. |
| `/api/v1/auth/me` | GET | Current user. Requires `access_token` cookie or Bearer header. |
| `/api/v1/auth/register` | POST | Register. Body: `email`, `password`, `username?`, `name?` |
| `/api/v1/auth/verify-email` | POST | Verify email OTP. Body: `email`, `code` |
| `/api/v1/auth/forgot-password` | POST | Request password reset. Body: `email` |
| `/api/v1/auth/reset-password` | POST | Reset password. Body: `email`, `token`, `newPassword` |
| `/api/v1/auth/resend-verification` | POST | Resend email verification OTP. Body: `email` |
| `/api/v1/health` | GET | Health check. Returns `{ status: "UP", services: { database: { status: "UP" } } }` |

### Token Response (`POST /oauth/token`)

```json
{
  "success": true,
  "access_token": "eyJ...",
  "refresh_token": "eyJ...",
  "id_token": "eyJ...",
  "token_type": "Bearer",
  "expires_in": 3600
}
```

- **access_token** — JWT, 1 hour, `audience: shelfex-services`
- **refresh_token** — JWT, 30 days, rotated on each use
- **id_token** — JWT, 1 hour, `audience: shelfex-id-token`, includes `nonce` if provided
- **expires_in** — seconds until access_token expires (3600 = 1 hour)
