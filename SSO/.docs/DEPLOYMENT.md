# Shelfex SSO — Deployment & Environment Guide

Complete guide for running Shelfex SSO locally and deploying to production.

---

## Table of Contents

1. [Architecture](#architecture)
2. [Local Development Setup](#local-development-setup)
3. [Environment Variables Reference](#environment-variables-reference)
4. [Production Deployment](#production-deployment)
5. [Domain Strategy](#domain-strategy)
6. [Generating Secrets](#generating-secrets)
7. [Database Setup](#database-setup)
8. [Deploying to Vercel](#deploying-to-vercel)
9. [Post-Deploy Verification](#post-deploy-verification)
10. [Cross-Domain SSO Architecture](#cross-domain-sso-architecture)
11. [Common Mistakes](#common-mistakes)

---

## Architecture

```
Production:

┌──────────────────┐   ┌───────────────────┐   ┌──────────────────┐
│  SSO Frontend    │   │   SSO Backend     │   │    PostgreSQL    │
│  (Next.js)       │──►│   (Express)       │──►│    (Neon)        │
│  accounts.       │   │   sso-api.        │   │                  │
│  shelfex.com     │   │   shelfex.com     │   │                  │
└──────────────────┘   └───────────────────┘   └──────────────────┘
                              │
            ┌─────────────────┼─────────────────┐
            ▼                 ▼                 ▼
      ┌───────────┐   ┌───────────┐     ┌───────────┐
      │ Shelf360  │   │ ShelfScan │     │ ShelfMuse │
      │           │   │           │     │           │
      │ Client ◄──┼──►│ Client ◄──┼────►│ Client    │
      │ Server    │   │ Server    │     │ Server    │
      └───────────┘   └───────────┘     └───────────┘

Local Development:

  SSO Frontend  →  localhost:3000
  SSO Backend   →  localhost:8000
  App Frontend  →  localhost:3001
  App Backend   →  localhost:4000
```

---

## Local Development Setup

### Prerequisites

- Node.js 18+
- PostgreSQL database (Neon recommended)
- npm

### 1. Clone and Install

```bash
git clone <repo-url>
cd 360-SSO

# Install all dependencies
cd SSO/server && npm install
cd ../client && npm install
cd ../../360/server && npm install
cd ../client && npm install
```

### 2. Configure Environment

**SSO Server** (`SSO/server/.env`):
```bash
NODE_ENV=development
PORT=8000
DATABASE_URL=postgresql://user:pass@host/dbname?sslmode=require
CORS_ORIGIN=http://localhost:3000,http://localhost:3001
FRONTEND_URL=http://localhost:3000
ACCESS_TOKEN_SECRET=<generate-a-secret>
REFRESH_TOKEN_SECRET=<generate-a-secret>
EMAIL_VERIFICATION_REQUIRED=true
RESEND_API_KEY=<your-resend-key>
RESEND_FROM_EMAIL=no-reply@yourdomain.com
```

**SSO Client** (`SSO/client/.env.local`):
```bash
NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1
```

**360 Server** (`360/server/.env`):
```bash
NODE_ENV=development
PORT=4000
CORS_ORIGIN=http://localhost:3001
SSO_API_URL=http://localhost:8000/api/v1
SSO_CLIENT_ID=shelf360
SSO_CLIENT_SECRET=shelf360-dev-secret-2025
SSO_CALLBACK_URL=http://localhost:3001/auth/callback
ACCESS_TOKEN_SECRET=<same-as-sso-server>
```

**360 Client** (`360/client/.env.local`):
```bash
NEXT_PUBLIC_API_URL=http://localhost:4000/api/v1
NEXT_PUBLIC_SSO_URL=http://localhost:8000/api/v1
NEXT_PUBLIC_CLIENT_ID=shelf360
NEXT_PUBLIC_CALLBACK_URL=http://localhost:3001/auth/callback
```

### 3. Setup Database

```bash
cd SSO/server

# Generate migration files
npm run db:generate

# Push schema to database
npm run db:push

# Seed test data (users + client apps)
npm run db:seed
```

### 4. Start All Services

```bash
# Terminal 1: SSO backend
cd SSO/server && npm run dev          # → localhost:8000

# Terminal 2: SSO frontend
cd SSO/client && npm run dev          # → localhost:3000

# Terminal 3: App backend
cd 360/server && npm run dev          # → localhost:4000

# Terminal 4: App frontend
cd 360/client && npm run dev          # → localhost:3001
```

### 5. Test Login

1. Visit `http://localhost:3001`
2. You'll be redirected to `http://localhost:3000/login?client_id=shelf360&...`
3. Login with `test@shelfex.com` / `12345` (as set in `seed.ts`)
4. You'll be redirected back to `http://localhost:3001/auth/callback?code=...`
5. Then to `http://localhost:3001/dashboard`

---

## Environment Variables Reference

### SSO Server

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `NODE_ENV` | Yes | `development` or `production` | `production` |
| `PORT` | Yes | Server port | `8000` |
| `DATABASE_URL` | Yes | PostgreSQL connection string | `postgresql://...` |
| `CORS_ORIGIN` | Yes | Comma-separated allowed origins (SSO frontend + all client app frontends) | `https://accounts.shelfex.com,https://360.shelfex.com` |
| `FRONTEND_URL` | Yes | SSO frontend URL (for redirects) | `https://accounts.shelfex.com` |
| `ACCESS_TOKEN_SECRET` | Yes | JWT signing secret for access tokens. **Must match on all app backends.** | 64+ random hex chars |
| `REFRESH_TOKEN_SECRET` | Yes | JWT signing secret for refresh tokens | 64+ random hex chars |
| `EMAIL_VERIFICATION_REQUIRED` | Yes | Enforce email verification | `true` |
| `RESEND_API_KEY` | Yes | Resend.com API key for transactional emails | `re_...` |
| `RESEND_FROM_EMAIL` | Yes | Sender email address (must be verified in Resend) | `no-reply@shelfex.com` |
| `COOKIE_DOMAIN` | No | Domain for `accounts_session` cookie. Set for same-domain SSO. | `.shelfex.com` |
| `ID_TOKEN_SECRET` | No | Separate signing key for ID tokens. Falls back to `ACCESS_TOKEN_SECRET` if not set. Set in production for key separation. | 64+ random hex chars |

### SSO Client

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `NEXT_PUBLIC_API_URL` | Yes | SSO backend URL | `https://sso-api.shelfex.com/api/v1` |

### Client App Server (e.g., 360 Server)

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `NODE_ENV` | Yes | `development` or `production` | `production` |
| `PORT` | Yes | Server port | `4000` |
| `CORS_ORIGIN` | Yes | Your frontend origin | `https://360.shelfex.com` |
| `SSO_API_URL` | Yes | SSO backend URL (server-to-server) | `https://sso-api.shelfex.com/api/v1` |
| `SSO_CLIENT_ID` | Yes | Your registered client ID | `shelf360` |
| `SSO_CLIENT_SECRET` | Yes | Your registered client secret (plaintext) | `<secret>` |
| `SSO_CALLBACK_URL` | Yes | Your callback URL (must match DB entry) | `https://360.shelfex.com/auth/callback` |
| `ACCESS_TOKEN_SECRET` | Yes | **Same as SSO server** — used to verify JWTs locally | Same as SSO server |

### Client App Frontend (e.g., 360 Client)

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `NEXT_PUBLIC_API_URL` | Yes | Your backend API URL | `https://360-api.shelfex.com/api/v1` |
| `NEXT_PUBLIC_SSO_URL` | Yes | SSO backend URL (for OAuth redirect) | `https://sso-api.shelfex.com/api/v1` |
| `NEXT_PUBLIC_CLIENT_ID` | Yes | Your registered client ID | `shelf360` |
| `NEXT_PUBLIC_CALLBACK_URL` | Yes | Your callback URL | `https://360.shelfex.com/auth/callback` |

---

## Production Deployment

### Deployment Order

Deploy in this order to avoid breaking changes:

1. **Database** — Run migrations (`npm run db:push`)
2. **SSO Server** — Deploy first, all clients depend on it
3. **SSO Client** — Frontend for the login/register pages
4. **Client App Servers** — Your app backends (360, ShelfScan, etc.)
5. **Client App Frontends** — Your app frontends

### Pre-Deploy Checklist

- [ ] Generate strong JWT secrets (see [Generating Secrets](#generating-secrets))
- [ ] `ACCESS_TOKEN_SECRET` is identical on SSO server and ALL client app servers
- [ ] `allowed_redirect_uris` in DB includes production callback URLs for every client app
- [ ] `CORS_ORIGIN` on SSO server includes ALL client app frontend origins
- [ ] `FRONTEND_URL` on SSO server points to SSO frontend's production URL
- [ ] `SSO_CLIENT_SECRET` on each client app server matches the plaintext secret that was bcrypt-hashed in DB
- [ ] `SSO_CALLBACK_URL` on each client app server matches the registered `allowed_redirect_uris`
- [ ] `NEXT_PUBLIC_CALLBACK_URL` on each client app frontend matches `SSO_CALLBACK_URL` on its server
- [ ] HTTPS is configured (cookies use `secure: true` when `NODE_ENV=production`)
- [ ] `RESEND_FROM_EMAIL` domain is verified in Resend dashboard
- [ ] No secrets in `.env.example` or committed `.env` files

### Build Commands

```bash
# SSO Server
cd SSO/server
npm run build          # Outputs to dist/
npm start              # Runs production build

# SSO Client
cd SSO/client
npm run build          # Next.js production build
npm start              # Runs production server

# 360 Server
cd 360/server
npm run build          # Outputs to dist/
npm start              # Runs production build

# 360 Client
cd 360/client
npm run build          # Next.js production build
npm start              # Runs production server
```

---

## Domain Strategy

### Option A: Shared Domain (Recommended)

All services under `*.shelfex.com`:

```
accounts.shelfex.com       → SSO Frontend
sso-api.shelfex.com        → SSO Backend
360.shelfex.com            → 360 Frontend
360-api.shelfex.com        → 360 Backend
```

**Advantage:** Set `COOKIE_DOMAIN=.shelfex.com` on SSO server. The `accounts_session` cookie works across all subdomains, enabling:
- **Silent SSO:** User logs into one app → visits another app → auto-authenticated (no login prompt)

### Option B: Separate Domains

```
accounts.shelfex.com       → SSO Frontend
sso-api.shelfex.com        → SSO Backend
shelf360.io                → 360 Frontend
api.shelf360.io            → 360 Backend
```

**This works.** The login-initiated OAuth flow generates the auth code directly after password verification, bypassing the need for the `accounts_session` cookie. However:
- Silent SSO does NOT work — user must re-enter password for each new app
- The `/oauth/authorize` endpoint can't detect existing sessions cross-domain

### Option C: Vercel Subdomains (Development/Staging)

```
sso-front-abc.vercel.app   → SSO Frontend
sso-api-xyz.vercel.app     → SSO Backend
```

**Warning:** `vercel.app` is on the Public Suffix List (PSL). Each `*.vercel.app` subdomain is treated as a separate site by browsers. Cookies cannot be shared. The login-initiated flow works, but silent SSO does not.

---

## Generating Secrets

Generate cryptographically secure secrets for production:

```bash
# Generate ACCESS_TOKEN_SECRET (use same value on SSO server + all app servers)
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

# Generate REFRESH_TOKEN_SECRET (SSO server only)
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

# Generate a new client secret for an app
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

**Critical:**
- `ACCESS_TOKEN_SECRET` must be **identical** on the SSO server and every client app server
- `REFRESH_TOKEN_SECRET` is only used on the SSO server
- Never use the default `your-super-secret-...-change-this-in-production` in production
- Rotate secrets by deploying new values to all services simultaneously

---

## Database Setup

### Neon PostgreSQL (Recommended)

1. Create a project at [neon.tech](https://neon.tech)
2. Copy the connection string
3. Set as `DATABASE_URL` in SSO server `.env`

### Migrations

```bash
cd sso/server

# Generate migration from schema changes
npm run db:generate

# Apply migrations to database
npm run db:migrate

# Or push schema directly (dev only)
npm run db:push

# Open Drizzle Studio (database GUI)
npm run db:studio
```

### Seed Data

```bash
npm run db:seed
```

This creates:
- Test user: `test@shelfex.com` / `12345` (pre-verified)
- Client apps: `shelfscan`, `shelfmuse`, `shelfintel`, `shelf360`

**For production:** Create client apps via direct SQL or a custom admin script. Do NOT use the dev seed secrets.

> **Note:** The seed script's console output may show different credentials than what's actually seeded. Always refer to the values in `seed.ts` source code.

### Registering a New Client App

```sql
-- First, hash the secret in Node.js:
-- const bcrypt = require('bcrypt');
-- const hash = await bcrypt.hash('my-production-secret', 12);

INSERT INTO client_apps (client_id, name, client_secret, allowed_redirect_uris)
VALUES (
  'my-app',
  'My App',
  '$2b$12$<hashed-secret>',
  '["https://myapp.shelfex.com/auth/callback", "http://localhost:3001/auth/callback"]'
);
```

---

## Deploying to Vercel

### SSO Server (Express)

Vercel doesn't natively run Express. Options:

1. **Vercel Serverless Functions** — Wrap Express with `@vendia/serverless-express` (current setup uses this via `vercel.json`)
2. **Railway / Render / Fly.io** — Better for long-running Express servers

### SSO Client (Next.js)

```bash
cd sso/client
vercel deploy --prod
```

Set environment variables in Vercel dashboard:
- `NEXT_PUBLIC_API_URL` = your SSO server's production URL

### Client App (Next.js)

```bash
cd 360/client
vercel deploy --prod
```

Set environment variables:
- `NEXT_PUBLIC_API_URL` = your app server's production URL
- `NEXT_PUBLIC_SSO_URL` = SSO server's production URL
- `NEXT_PUBLIC_CLIENT_ID` = your client ID
- `NEXT_PUBLIC_CALLBACK_URL` = your production callback URL

---

## Post-Deploy Verification

### 1. Health Check

```bash
curl https://sso-api.shelfex.com/api/v1/health
# Expected: { "status": "UP", "services": { "database": { "status": "UP" } } }
```

### 2. OAuth Flow Test

1. Visit your production app URL
2. Verify redirect to SSO login page with correct `client_id`
3. Login with valid credentials
4. Verify redirect back to your app's callback URL with `code` and `state` params
5. Verify landing on dashboard with valid session

### 3. Token Refresh Test

```bash
# Delete access_token cookie in DevTools, then make an API call
# The axios interceptor should auto-refresh and retry
```

### 4. Logout Test

1. Click logout in your app
2. Verify redirect to SSO logout endpoint
3. Verify redirect back to your app's origin
4. Visit the app again — should require fresh login

### 5. Cross-App SSO Test (Same Domain Only)

1. Login to App A
2. Visit App B in same browser
3. If using shared domain (`COOKIE_DOMAIN`): auto-authenticated
4. If using separate domains: login required (expected)

---

## Cross-Domain SSO Architecture

### How It Works

The SSO system supports two authentication paths:

**Path 1: Login-Initiated (Cross-Domain Safe)**
```
User → App Middleware → SSO /oauth/authorize → SSO Login Page
  → User enters credentials
  → SSO POST /auth/login (with OAuth params)
  → SSO generates auth code directly (no cookie needed)
  → SSO returns callback URL with code
  → SSO frontend redirects user to App /auth/callback?code=...
  → App backend exchanges code for tokens
```

**Path 2: Session-Based (Same-Domain Only)**
```
User → App Middleware → SSO /oauth/authorize
  → SSO reads accounts_session cookie
  → SSO generates auth code (user already authenticated)
  → SSO redirects to App /auth/callback?code=...
  → App backend exchanges code for tokens
  (No login prompt — silent SSO)
```

Path 1 always works. Path 2 requires the SSO frontend and server to share a domain (or at least a site in the PSL sense).

### Why `accounts_session` Doesn't Work Cross-Site

- `vercel.app` is on the Public Suffix List (PSL)
- `sso-front.vercel.app` and `sso-api.vercel.app` are treated as **different sites**
- Browsers reject `SameSite=Lax` cookies in cross-site AJAX responses
- The `accounts_session` cookie set during login is never sent to `/oauth/authorize`

The login-initiated flow (Path 1) solves this by generating the auth code directly after credential verification, without needing any cross-site cookie.

---

## Common Mistakes

| Mistake | Consequence | Fix |
|---------|-------------|-----|
| Different `ACCESS_TOKEN_SECRET` on SSO and app server | JWT verification fails — 401 on every `/auth/me` call | Use identical secret on all servers |
| Using `jsonwebtoken` in Next.js middleware | Runtime crash — Edge Runtime doesn't support Node.js `crypto` | Use manual base64 JWT decode (see INTEGRATION.md) |
| `SSO_CALLBACK_URL` doesn't match `allowed_redirect_uris` | "Invalid redirect_uri" error during OAuth | Add exact URL (protocol + host + port + path) to DB |
| Forgetting to update `CORS_ORIGIN` on SSO server | CORS errors on login API calls | Add all client app frontend origins, comma-separated |
| `secure: true` cookies without HTTPS | Cookies silently not set | Use `NODE_ENV=development` locally (disables secure flag) |
| Committing `.env` with real secrets | Credential leak | Add `.env` to `.gitignore`, use `.env.example` with empty values |
| Not saving rotated refresh token | Second refresh attempt fails (reuse detection revokes all sessions) | Always update the `refresh_token` cookie from `/auth/refresh` response |
| Using Vercel subdomains for SSO with `COOKIE_DOMAIN` | Cookies rejected — PSL prevents cross-subdomain sharing | Use a real custom domain or rely on login-initiated flow |
