# Shelfex Accounts - OAuth 2.0 SSO Authentication System

A production-grade Single Sign-On (SSO) authentication system built with **Express**, **TypeScript**, **Drizzle ORM**, and **PostgreSQL**. This system enables seamless authentication across multiple Shelfex products (ShelfScan, ShelfMuse, ShelfIntel).

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Database Schema](#database-schema)
3. [Authentication Flow](#authentication-flow)
4. [API Endpoints Reference](#api-endpoints-reference)
5. [SSO Flow Examples](#sso-flow-examples)
6. [Token Management](#token-management)
7. [Security Features](#security-features)
8. [Configuration](#configuration)

---

## Architecture Overview

### Core Concept

This system implements the **OAuth 2.0 Authorization Code Flow** with a centralized Identity Provider (IdP). When a user logs into any Shelfex product, they authenticate through `accounts.shelfex.com`, which then issues authorization codes that client applications exchange for tokens.

### Key Components

```
┌─────────────────────────────────────────────────────────────┐
│                    accounts.shelfex.com                     │
│                  (Identity Provider - IdP)                  │
│                                                             │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐        │
│  │   Auth API  │  │  OAuth API   │  │  Token Mgmt  │        │
│  │             │  │              │  │              │        │
│  │ /register   │  │ /authorize   │  │ JWT Utils    │        │
│  │ /login      │  │ /token       │  │ Refresh      │        │
│  │ /refresh    │  │              │  │ Validation   │        │
│  │ /logout     │  │              │  │              │        │
│  └─────────────┘  └──────────────┘  └──────────────┘        │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │             PostgreSQL Database (Neon)               │   │
│  │  - users           - refresh_tokens                  │   │
│  │  - client_apps     - auth_codes                      │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
        ▼                     ▼                     ▼
┌──────────────┐      ┌──────────────┐     ┌──────────────┐
│  shelfscan   │      │  shelfmuse   │     │  shelfintel  │
│   .com       │      │    .com      │     │    .com      │
│              │      │              │     │              │
│ Client App 1 │      │ Client App 2 │     │ Client App 3 │
└──────────────┘      └──────────────┘     └──────────────┘
```

### Cookie Strategy

The system uses **three types of cookies** for authentication:

1. **`accounts_session`** (Global SSO Cookie)
   - Domain: `.shelfexecution.com` (works across all subdomains)
   - Purpose: Enables "silent" authentication when visiting new apps
   - Set by: `POST /auth/login`
   - Read by: `GET /oauth/authorize`

2. **`access_token`** (Local Access Token)
   - Domain: `accounts.shelfex.com` only
   - Purpose: API authentication for accounts service
   - Expiry: 1 day

3. **`refresh_token`** (Local Refresh Token)
   - Domain: `accounts.shelfex.com` only
   - Purpose: Obtain new access tokens without re-login
   - Expiry: 30 days

---

## Database Schema

### `users` Table
Stores user identity and credentials.

```typescript
{
  id: UUID (PK)
  email: string (unique, indexed)
  username: string | null (unique, indexed)
  password: string (bcrypt hashed)
  name: string | null
  emailVerified: boolean (default: false)
  createdAt: timestamp
  updatedAt: timestamp
}
```

**Key Features:**
- Users can login with **email OR username**
- Passwords hashed with bcrypt (12 salt rounds)
- Email verification support (configurable via `EMAIL_VERIFICATION_REQUIRED` env)

---

### `refresh_tokens` Table
Stores long-lived refresh tokens for session management.

```typescript
{
  id: UUID (PK)
  userId: UUID (FK -> users.id, cascade delete)
  tokenHash: string (unique, indexed) // SHA256 hash of actual token
  expiresAt: timestamp // 30 days from creation
  isRevoked: boolean (default: false)
  createdAt: timestamp
  lastUsedAt: timestamp | null
}
```

**Key Features:**
- Tokens are **hashed** before storage (never store raw tokens)
- Can be revoked manually (logout) or automatically (expiry)
- `lastUsedAt` tracks token usage patterns

---

### `auth_codes` Table
Stores temporary OAuth authorization codes.

```typescript
{
  id: UUID (PK)
  code: string (unique, indexed) // Random 32-byte base64url
  userId: UUID (FK -> users.id, cascade delete)
  clientId: string (FK -> client_apps.clientId)
  redirectUri: string // Must match on token exchange
  expiresAt: timestamp // 10 minutes from creation
  isUsed: boolean (default: false) // One-time use only
  createdAt: timestamp
}
```

**Key Features:**
- **Short-lived** (10 minutes)
- **One-time use** (marked as used after exchange)
- **Bound to redirect_uri** (prevents interception attacks)

---

### `client_apps` Table
Registers allowed client applications (ShelfScan, ShelfMuse, etc.).

```typescript
{
  id: UUID (PK)
  clientId: string (unique, indexed) // e.g., "shelfscan"
  clientSecret: string // bcrypt hashed
  name: string // Display name, e.g., "ShelfScan"
  allowedRedirectUris: string[] // JSON array of valid callback URLs
  createdAt: timestamp
}
```

**Key Features:**
- Each app has unique `clientId` and `clientSecret`
- Secrets are **hashed** (like passwords)
- Redirect URIs are **whitelisted** (security)

**Example Client App:**
```json
{
  "clientId": "shelfscan",
  "name": "ShelfScan",
  "allowedRedirectUris": [
    "http://localhost:3001/callback",
    "https://shelfscan.com/callback"
  ]
}
```

---

## Authentication Flow

### Token Types

The system issues **three types of JWT tokens**:

#### 1. Access Token
- **Purpose:** Authenticate API requests
- **Expiry:** 1 day
- **Payload:**
  ```typescript
  {
    userId: string
    email: string
    emailVerified: boolean
    iss: "accounts.shelfex.com"
    aud: "shelfex-services"
    exp: timestamp
  }
  ```
- **Storage:** Cookie (`access_token`) or Authorization header
- **Usage:** Every protected API call

#### 2. Refresh Token
- **Purpose:** Obtain new access tokens without re-login
- **Expiry:** 30 days
- **Payload:**
  ```typescript
  {
    userId: string
    tokenId: string // Unique ID for this refresh token
    iss: "accounts.shelfex.com"
    exp: timestamp
  }
  ```
- **Storage:** Cookie (`refresh_token`) or request body
- **Usage:** `POST /auth/refresh`

#### 3. ID Token (OpenID Connect)
- **Purpose:** User profile information for client apps
- **Expiry:** 1 day
- **Payload:**
  ```typescript
  {
    userId: string
    email: string
    name: string | null
    emailVerified: boolean
    iss: "accounts.shelfex.com"
    aud: "shelfex-services"
    exp: timestamp
  }
  ```
- **Storage:** Not stored, returned once during token exchange
- **Usage:** Client apps decode this to display user info

---

## API Endpoints Reference

### Base URL
```
http://localhost:8000/api/v1
```

---

## Authentication Endpoints

### 1. POST `/auth/register`

**Description:** Create a new user account.

**Request Body:**
```json
{
  "email": "user@example.com",
  "username": "johndoe" // Optional
  "password": "SecurePass123!",
  "name": "John Doe" // Optional
}
```

**Success Response (201):**
```json
{
  "success": true,
  "message": "User registered successfully",
  "data": {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "email": "user@example.com",
    "username": "johndoe",
    "name": "John Doe",
    "emailVerified": false
  }
}
```

**Error Responses:**

**400 - Validation Error:**
```json
{
  "success": false,
  "message": "Email and password are required"
}
```

**409 - Duplicate User:**
```json
{
  "success": false,
  "message": "User with this email already exists"
}
```

**409 - Username Taken:**
```json
{
  "success": false,
  "message": "Username already taken"
}
```

---

### 2. POST `/auth/login`

**Description:** Authenticate user and issue tokens. Supports both regular login and OAuth flow.

**Request Body (Regular Login):**
```json
{
  "identifier": "user@example.com", // Can be email or username
  "password": "SecurePass123!"
}
```

**Request Body (OAuth Login):**
```json
{
  "identifier": "user@example.com",
  "password": "SecurePass123!",
  "client_id": "shelfscan", // Optional OAuth params
  "redirect_uri": "https://shelfscan.com/callback",
  "state": "random_csrf_token" // Optional
}
```

**Success Response - Regular Login (200):**
```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "user": {
      "id": "123e4567-e89b-12d3-a456-426614174000",
      "email": "user@example.com",
      "name": "John Doe",
      "emailVerified": false
    },
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

**Cookies Set:**
- `access_token` (HttpOnly, 1 day)
- `refresh_token` (HttpOnly, 30 days)
- `accounts_session` (HttpOnly, 1 day, domain: `.shelfex.com`)

**Success Response - OAuth Login (302):**
```
Redirect: /api/v1/oauth/authorize?client_id=shelfscan&redirect_uri=https://shelfscan.com/callback&response_type=code&state=xyz
```

**Error Responses:**

**400 - Missing Fields:**
```json
{
  "success": false,
  "message": "Email/username and password are required"
}
```

**401 - Invalid Credentials:**
```json
{
  "success": false,
  "message": "Invalid credentials"
}
```

---

### 3. GET `/auth/login`

**Description:** Get login page data with OAuth context.

**Query Parameters:**
```
?client_id=shelfscan
&redirect_uri=https://shelfscan.com/callback
&state=random_csrf_token
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Login page",
  "data": {
    "client_id": "shelfscan",
    "redirect_uri": "https://shelfscan.com/callback",
    "state": "random_csrf_token"
  }
}
```

**Usage:** Frontend calls this to get OAuth params and render login form accordingly.

---

### 4. POST `/auth/refresh`

**Description:** Exchange refresh token for a new access token.

**Request Body:**
```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." // Optional if cookie present
}
```

**Alternatively:** Send `refresh_token` cookie (automatic).

**Success Response (200):**
```json
{
  "success": true,
  "message": "Token refreshed successfully",
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

**Cookies Updated:**
- `access_token` (new token)

**Error Responses:**

**401 - No Token:**
```json
{
  "success": false,
  "message": "Refresh token required"
}
```

**401 - Invalid Token:**
```json
{
  "success": false,
  "message": "Invalid refresh token"
}
```

**401 - Revoked:**
```json
{
  "success": false,
  "message": "Refresh token has been revoked"
}
```

**401 - Expired:**
```json
{
  "success": false,
  "message": "Refresh token expired"
}
```

---

### 5. POST `/auth/logout`

**Description:** Revoke refresh token and clear cookies.

**Request Body:**
```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." // Optional if cookie present
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Logged out successfully"
}
```

**Cookies Cleared:**
- `access_token`
- `refresh_token`

**Database Update:**
- Marks refresh token as `isRevoked: true`

---

### 6. GET `/auth/me`

**Description:** Get current authenticated user details.

**Headers Required:**
```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**Or Cookie:**
```
Cookie: access_token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**Success Response (200):**
```json
{
  "success": true,
  "data": {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "email": "user@example.com",
    "name": "John Doe",
    "emailVerified": false,
    "createdAt": "2025-12-05T10:30:00.000Z"
  }
}
```

**Error Responses:**

**401 - No Token:**
```json
{
  "success": false,
  "message": "Authentication required",
  "error": "No token provided"
}
```

**401 - Invalid Token:**
```json
{
  "success": false,
  "message": "Invalid token",
  "error": "Token is malformed or invalid"
}
```

**401 - Expired Token:**
```json
{
  "success": false,
  "message": "Token expired",
  "error": "Please refresh your token"
}
```

**403 - Email Not Verified (if `EMAIL_VERIFICATION_REQUIRED=true`):**
```json
{
  "success": false,
  "message": "Email verification required",
  "error": "Please verify your email before accessing this resource"
}
```

---

## OAuth Endpoints

### 7. GET `/oauth/authorize`

**Description:** OAuth 2.0 authorization endpoint. Entry point for SSO flow.

**Query Parameters:**
```
?client_id=shelfscan (required)
&redirect_uri=https://shelfscan.com/callback (required)
&response_type=code (required, must be "code")
&state=random_csrf_token (optional)
```

**Flow Decision Tree:**

```
┌───────────────────────────────┐
│ Check accounts_session cookie │
└──────────────┬────────────────┘
               │
       ┌───────┴────────┐
       │                │
   ❌ Missing      ✅ Exists
       │                │
       ▼                ▼
Redirect to      Verify Token
/login?...           │
                 ┌───┴────┐
                 │        │
             ❌ Invalid  ✅ Valid
                 │        │
                 ▼        ▼
          Redirect to  Generate
          /login?...   Auth Code
                          │
                          ▼
                    Redirect to
                    client app
                    with code
```

**Success Response - User Logged In (302):**
```
Redirect: https://shelfscan.com/callback?code=abc123xyz...&state=random_csrf_token
```

**Response - User Not Logged In (302):**
```
Redirect: /login?client_id=shelfscan&redirect_uri=https://shelfscan.com/callback&state=random_csrf_token
```

**Error Responses:**

**400 - Missing Parameters:**
```json
{
  "success": false,
  "message": "Invalid OAuth request",
  "error": "Required params: client_id, redirect_uri, response_type=code"
}
```

**400 - Invalid Client:**
```json
{
  "success": false,
  "message": "Invalid client_id",
  "error": "Client 'invalid-client' not registered"
}
```

**400 - Invalid Redirect URI:**
```json
{
  "success": false,
  "message": "Invalid redirect_uri",
  "error": "Redirect URI not registered for this client"
}
```

**403 - Email Not Verified (if enabled):**
```json
{
  "success": false,
  "message": "Email verification required",
  "error": "Please verify your email before accessing other apps"
}
```

**Behind the Scenes:**

1. Validates `client_id` exists in `client_apps` table
2. Checks if `redirect_uri` is in the app's `allowedRedirectUris` array
3. Reads `accounts_session` cookie
4. If cookie missing → redirect to login
5. If cookie exists → verify JWT signature and expiry
6. Generate random authorization code (32 bytes, base64url)
7. Store code in `auth_codes` table with:
   - `userId` from token
   - `clientId` from query
   - `redirectUri` from query
   - `expiresAt` = now + 10 minutes
   - `isUsed` = false
8. Redirect user to `redirect_uri` with code in query string

---

### 8. POST `/oauth/token`

**Description:** Exchange authorization code for tokens. Called by **client app backends** (not browsers).

**Request Body:**
```json
{
  "code": "abc123xyz...",
  "client_id": "shelfscan",
  "client_secret": "secret-key-for-shelfscan",
  "redirect_uri": "https://shelfscan.com/callback",
  "grant_type": "authorization_code"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "id_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "Bearer",
  "expires_in": 86400 // 1 day in seconds
}
```

**Token Details:**

| Token | Purpose | Where to Store |
|-------|---------|----------------|
| `access_token` | API authorization | Client's cookie/localStorage |
| `refresh_token` | Get new access tokens | Client's HttpOnly cookie |
| `id_token` | User profile info | Decode and display, don't store |

**Error Responses:**

**400 - Missing Parameters:**
```json
{
  "success": false,
  "message": "Invalid token request",
  "error": "Required: code, client_id, client_secret, redirect_uri, grant_type=authorization_code"
}
```

**401 - Invalid Client Credentials:**
```json
{
  "success": false,
  "message": "Invalid client credentials",
  "error": "Client not found"
}
```

**401 - Wrong Client Secret:**
```json
{
  "success": false,
  "message": "Invalid client credentials",
  "error": "Client secret is incorrect"
}
```

**400 - Invalid Code:**
```json
{
  "success": false,
  "message": "Invalid authorization code",
  "error": "Code not found or does not belong to this client"
}
```

**400 - Code Already Used:**
```json
{
  "success": false,
  "message": "Authorization code already used",
  "error": "This code has been exchanged already"
}
```

**400 - Code Expired:**
```json
{
  "success": false,
  "message": "Authorization code expired",
  "error": "Code is no longer valid"
}
```

**400 - Redirect URI Mismatch:**
```json
{
  "success": false,
  "message": "Invalid redirect_uri",
  "error": "Redirect URI does not match the one used in authorization"
}
```

**Security Validations Performed:**

1. ✅ Verify `client_id` exists in database
2. ✅ Verify `client_secret` matches hashed version (bcrypt compare)
3. ✅ Verify auth code exists and belongs to this client
4. ✅ Check if code is already used (prevent replay attacks)
5. ✅ Check if code expired (10 min window)
6. ✅ Verify `redirect_uri` matches the one used in `/authorize`
7. ✅ Mark code as used immediately after validation
8. ✅ Generate fresh tokens for the user

---

## SSO Flow Examples - Detailed Walkthrough

### Scenario 1: First-Time User Visit (Cold Start - No Login)

**Context:** User opens a fresh browser and visits `shelfscan.shelfexecution.com/` for the first time. No cookies exist anywhere.

---

**Step 1: User Visits ShelfScan**

--> **User Action:** User types `https://shelfscan.shelfexecution.com/dashboard` in their browser and hits Enter.

--> **ShelfScan NextJS Middleware Check:** The middleware on ShelfScan's server executes and checks for authentication cookies:
   - Looking for: `shelfscan_access_token` and `shelfscan_refresh_token`
   - Result: ❌ **NOT FOUND** (user is not authenticated on ShelfScan)

--> **ShelfScan Decision:** Since the user is not authenticated, ShelfScan needs to redirect them to the central authentication server to verify their identity.

--> **ShelfScan Middleware Action:** 
   - Generates a random CSRF token (e.g., `xyz_random_csrf_string_abc123`) for security
   - Stores this `state` value in a temporary cookie or session on ShelfScan's domain
   - Constructs the OAuth authorization URL with the following parameters:
     - `client_id`: `shelfscan` (identifies which app is requesting authentication)
     - `redirect_uri`: `https://shelfscan.shelfexecution.com/callback` (where to send user back after authentication)
     - `response_type`: `code` (OAuth 2.0 authorization code flow)
     - `state`: `xyz_random_csrf_string_abc123` (CSRF protection token)

--> **Redirect Response:** ShelfScan sends a **302 Redirect** response to:
```
https://accounts.shelfexecution.com/api/v1/oauth/authorize?client_id=shelfscan&redirect_uri=https://shelfscan.shelfexecution.com/callback&response_type=code&state=xyz_random_csrf_string_abc123
```

---

**Step 2: Authorization Endpoint Checks for Global Session**

--> **User's Browser:** Automatically follows the redirect and sends a GET request to the accounts service at:
```
https://accounts.shelfexecution.com/api/v1/oauth/authorize?client_id=shelfscan&redirect_uri=https://shelfscan.shelfexecution.com/callback&response_type=code&state=xyz_random_csrf_string_abc123
```

--> **Accounts Backend Validation:**
   1. **Extract Query Parameters:** The backend extracts `client_id`, `redirect_uri`, `response_type`, and `state` from the URL.
   
   2. **Validate Client ID:** 
      - Queries the `client_apps` table to verify that `client_id=shelfscan` exists
      - Checks if the app is registered
      - Result: ✅ **VALID** (shelfscan is a registered client app)
   
   3. **Validate Redirect URI:**
      - Retrieves the `allowedRedirectUris` array for shelfscan from the database
      - Verifies that `https://shelfscan.shelfexecution.com/callback` is in the whitelist
      - Result: ✅ **VALID** (redirect URI is allowed for this client)
   
   4. **Validate Response Type:**
      - Checks that `response_type=code`
      - Result: ✅ **VALID** (authorization code flow)

--> **Check for Global SSO Cookie:**
   - The backend looks for the `accounts_session` cookie in the request
   - This cookie would have domain set to `.shelfexecution.com` (works across all subdomains)
   - Result: ❌ **NOT FOUND** (user has never logged in before)

--> **Backend Decision:** Since no `accounts_session` cookie exists, the user needs to authenticate with their credentials.

--> **Redirect to Login Page:** The backend sends a **302 Redirect** response to:
```
https://accounts.shelfexecution.com/login?client_id=shelfscan&redirect_uri=https://shelfscan.shelfexecution.com/callback&response_type=code&state=xyz_random_csrf_string_abc123
```

**Note:** The OAuth parameters are preserved in the URL so the login page knows this is part of an OAuth flow.

---

**Step 3: User Sees Login Page and Submits Credentials**

--> **User's Browser:** Loads the login page at `https://accounts.shelfexecution.com/login?client_id=shelfscan&...`

--> **Frontend Behavior:**
   - Renders the login form with fields for email/username and password
   - Detects the OAuth parameters in the URL (`client_id`, `redirect_uri`, `state`)
   - Stores these parameters in hidden form fields or local state

--> **User Action:** User enters their credentials:
   - Identifier: `john@example.com` (can be email or username)
   - Password: `SecurePass123!`
   - Clicks "Login" button

--> **Frontend Submission:** The frontend sends a **POST** request to:
```
https://accounts.shelfexecution.com/api/v1/auth/login
```

**Request Headers:**
```
Content-Type: application/json
```

**Request Body:**
```json
{
  "identifier": "john@example.com",
  "password": "SecurePass123!",
  "client_id": "shelfscan",
  "redirect_uri": "https://shelfscan.shelfexecution.com/callback",
  "response_type": "code",
  "state": "xyz_random_csrf_string_abc123"
}
```

**Note:** The `client_id`, `redirect_uri`, `response_type`, and `state` are included to signal that this is an OAuth login flow.

---

**Step 4: Backend Authenticates User and Sets Global SSO Cookie**

--> **Backend Validation Process:**

   1. **Extract Request Body:** Backend receives the identifier, password, and OAuth parameters.
   
   2. **Find User in Database:**
      - Queries the `users` table where `email = 'john@example.com'` OR `username = 'john@example.com'`
      - Result: User record found with ID `user-123-abc-def`
   
   3. **Verify Password:**
      - Retrieves the stored bcrypt hash from the user record
      - Uses `bcrypt.compare(password, storedHash)` to verify the password
      - Result: ✅ **VALID** (password matches)
   
   4. **Check OAuth Flow Detection:**
      - Backend checks if `client_id` parameter exists in the request
      - Result: ✅ **YES** (this is an OAuth flow from shelfscan)

--> **Generate Global SSO Session Token:**
   - Backend generates a JWT token for `accounts_session` cookie
   - **JWT Payload:**
     ```json
     {
       "userId": "user-123-abc-def",
       "email": "john@example.com",
       "emailVerified": true,
       "iss": "accounts.shelfexecution.com",
       "aud": "shelfex-services",
       "iat": 1702123456,
       "exp": 1702209856
     }
     ```
   - Expiry: 1 day (86400 seconds)

--> **Generate Local Accounts Tokens:**
   - Backend also generates `access_token` and `refresh_token` for the accounts service itself
   - These tokens allow the user to access their account settings, profile, etc.

--> **Set Cookies:**
   1. **accounts_session** (Global SSO Cookie):
      ```
      Domain: .shelfexecution.com
      Path: /
      HttpOnly: true
      Secure: true (in production)
      SameSite: Lax
      Max-Age: 86400 (1 day)
      ```
   
   2. **access_token** (Local to accounts.shelfexecution.com):
      ```
      Domain: accounts.shelfexecution.com
      Path: /
      HttpOnly: true
      Secure: true
      SameSite: Lax
      Max-Age: 86400 (1 day)
      ```
   
   3. **refresh_token** (Local to accounts.shelfexecution.com):
      ```
      Domain: accounts.shelfexecution.com
      Path: /
      HttpOnly: true
      Secure: true
      SameSite: Lax
      Max-Age: 2592000 (30 days)
      ```

--> **Store Refresh Token in Database:**
   - Backend hashes the refresh token using SHA256
   - Inserts a new record in the `refresh_tokens` table:
     ```json
     {
       "id": "token-abc-123",
       "userId": "user-123-abc-def",
       "tokenHash": "sha256_hash_of_refresh_token",
       "expiresAt": "2025-01-08T10:30:00.000Z",
       "isRevoked": false,
       "createdAt": "2025-12-09T10:30:00.000Z",
       "lastUsedAt": null
     }
     ```

--> **Redirect Back to OAuth Authorize Endpoint:** Since this was an OAuth flow, the backend sends a **302 Redirect** response to:
```
https://accounts.shelfexecution.com/api/v1/oauth/authorize?client_id=shelfscan&redirect_uri=https://shelfscan.shelfexecution.com/callback&response_type=code&state=xyz_random_csrf_string_abc123
```

**Important:** The user's browser now has the `accounts_session` cookie set, so this time the authorization endpoint will find it!

---

**Step 5: Authorization Endpoint Generates Authorization Code**

--> **User's Browser:** Follows the redirect and sends a GET request to:
```
https://accounts.shelfexecution.com/api/v1/oauth/authorize?client_id=shelfscan&redirect_uri=https://shelfscan.shelfexecution.com/callback&response_type=code&state=xyz_random_csrf_string_abc123
```

**This Time:** The browser includes the `accounts_session` cookie in the request!

--> **Backend Checks for Global SSO Cookie:**
   - Backend reads the `accounts_session` cookie from the request
   - Result: ✅ **FOUND**

--> **Verify JWT Token:**
   - Backend verifies the JWT signature using the `ACCESS_TOKEN_SECRET`
   - Checks if the token has expired
   - Extracts the `userId` from the payload
   - Result: ✅ **VALID** (user is authenticated as `user-123-abc-def`)

--> **Generate Authorization Code:**
   - Backend generates a random 32-byte authorization code using `crypto.randomBytes(32)`
   - Encodes it as base64url: `abc123xyz_secret_code_random`
   - This code is temporary and one-time use only

--> **Store Authorization Code in Database:**
   - Backend inserts a new record in the `auth_codes` table:
     ```json
     {
       "id": "auth-code-uuid-123",
       "code": "abc123xyz_secret_code_random",
       "userId": "user-123-abc-def",
       "clientId": "shelfscan",
       "redirectUri": "https://shelfscan.shelfexecution.com/callback",
       "expiresAt": "2025-12-09T10:40:00.000Z",
       "isUsed": false,
       "createdAt": "2025-12-09T10:30:00.000Z"
     }
     ```
   - **Note:** The code expires in 10 minutes and can only be used once

--> **Redirect to Client App's Callback:** Backend sends a **302 Redirect** response to:
```
https://shelfscan.shelfexecution.com/callback?code=abc123xyz_secret_code_random&state=xyz_random_csrf_string_abc123
```

---

**Step 6: ShelfScan Callback - Server-to-Server Token Exchange**

--> **User's Browser:** Follows the redirect and sends a GET request to:
```
https://shelfscan.shelfexecution.com/callback?code=abc123xyz_secret_code_random&state=xyz_random_csrf_string_abc123
```

--> **ShelfScan Backend Receives Request:**
   - This is a Next.js API route (e.g., `/app/callback/page.tsx` or `/pages/api/callback.ts`)
   - Does **NOT** render a page immediately
   - Performs server-side validation and token exchange

--> **Step 6.1: Verify State (CSRF Protection)**
   - Backend extracts the `state` parameter from the URL: `xyz_random_csrf_string_abc123`
   - Retrieves the original `state` value that was stored in Step 1 (from cookie or session)
   - Compares the two values
   - Result: ✅ **MATCH** (CSRF attack prevented)
   - If they don't match, the request is rejected immediately

--> **Step 6.2: Exchange Authorization Code for Tokens**
   - ShelfScan's backend sends a **POST** request to the Accounts Service:

**Request URL:**
```
https://accounts.shelfexecution.com/api/v1/oauth/token
```

**Request Headers:**
```
Content-Type: application/json
```

**Request Body:**
```json
{
  "code": "abc123xyz_secret_code_random",
  "client_id": "shelfscan",
  "client_secret": "shelfscan_super_secret_key_12345",
  "redirect_uri": "https://shelfscan.shelfexecution.com/callback",
  "grant_type": "authorization_code"
}
```

**Note:** The `client_secret` is stored securely in ShelfScan's backend environment variables. It's never exposed to the browser!

---

**Step 7: Accounts Service Validates and Issues Tokens**

--> **Accounts Backend Validation Process:**

   1. **Validate Client Credentials:**
      - Query `client_apps` table where `client_id = 'shelfscan'`
      - Retrieve the stored `client_secret` (bcrypt hash)
      - Use `bcrypt.compare(provided_secret, stored_hash)` to verify
      - Result: ✅ **VALID** (client is authenticated)
   
   2. **Find Authorization Code:**
      - Query `auth_codes` table where `code = 'abc123xyz_secret_code_random'`
      - Result: Code record found
   
   3. **Validate Authorization Code:**
      - Check if `clientId` in the record matches `shelfscan` ✅
      - Check if `isUsed = false` ✅ (not already used)
      - Check if `expiresAt > NOW()` ✅ (not expired)
      - Check if `redirectUri` matches the provided redirect_uri ✅
      - Result: ✅ **ALL VALID**
   
   4. **Mark Code as Used:**
      - Update the `auth_codes` record: `isUsed = true`
      - This prevents replay attacks (code can't be used again)

--> **Generate Tokens for ShelfScan:**

   1. **Access Token (JWT):**
      - **Payload:**
        ```json
        {
          "userId": "user-123-abc-def",
          "email": "john@example.com",
          "emailVerified": true,
          "iss": "accounts.shelfexecution.com",
          "aud": "shelfex-services",
          "iat": 1702123456,
          "exp": 1702209856
        }
        ```
      - Signed with `ACCESS_TOKEN_SECRET`
      - Expiry: 1 day
   
   2. **Refresh Token (JWT):**
      - Backend generates a unique token ID for tracking
      - **Payload:**
        ```json
        {
          "userId": "user-123-abc-def",
          "tokenId": "refresh-token-id-456",
          "iss": "accounts.shelfexecution.com",
          "iat": 1702123456,
          "exp": 1704715456
        }
        ```
      - Signed with `REFRESH_TOKEN_SECRET`
      - Expiry: 30 days
      - Backend hashes this token and stores it in `refresh_tokens` table
   
   3. **ID Token (OpenID Connect - JWT):**
      - **Payload:**
        ```json
        {
          "userId": "user-123-abc-def",
          "email": "john@example.com",
          "name": "John Doe",
          "emailVerified": true,
          "iss": "accounts.shelfexecution.com",
          "aud": "shelfex-services",
          "iat": 1702123456,
          "exp": 1702209856
        }
        ```
      - Contains user profile information
      - Client can decode this (it's not encrypted, just signed)
      - Used to display user info without additional API calls

--> **Return Token Response:**

**HTTP Status:** 200 OK

**Response Body:**
```json
{
  "success": true,
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJ1c2VyLTEyMy1hYmMtZGVmIiwiZW1haWwiOiJqb2huQGV4YW1wbGUuY29tIiwiZW1haWxWZXJpZmllZCI6dHJ1ZSwiaXNzIjoiYWNjb3VudHMuc2hlbGZleGVjdXRpb24uY29tIiwiYXVkIjoic2hlbGZleC1zZXJ2aWNlcyIsImlhdCI6MTcwMjEyMzQ1NiwiZXhwIjoxNzAyMjA5ODU2fQ...",
  "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJ1c2VyLTEyMy1hYmMtZGVmIiwidG9rZW5JZCI6InJlZnJlc2gtdG9rZW4taWQtNDU2IiwiaXNzIjoiYWNjb3VudHMuc2hlbGZleGVjdXRpb24uY29tIiwiaWF0IjoxNzAyMTIzNDU2LCJleHAiOjE3MDQ3MTU0NTZ9...",
  "id_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJ1c2VyLTEyMy1hYmMtZGVmIiwiZW1haWwiOiJqb2huQGV4YW1wbGUuY29tIiwibmFtZSI6IkpvaG4gRG9lIiwiZW1haWxWZXJpZmllZCI6dHJ1ZSwiaXNzIjoiYWNjb3VudHMuc2hlbGZleGVjdXRpb24uY29tIiwiYXVkIjoic2hlbGZleC1zZXJ2aWNlcyIsImlhdCI6MTcwMjEyMzQ1NiwiZXhwIjoxNzAyMjA5ODU2fQ...",
  "token_type": "Bearer",
  "expires_in": 86400
}
```

---

**Step 8: ShelfScan Establishes Local Session**

--> **ShelfScan Backend Receives Tokens:**
   - Parses the JSON response from the Accounts Service
   - Now has access to `access_token`, `refresh_token`, and `id_token`

--> **Decode ID Token (Optional):**
   - ShelfScan can decode the `id_token` without verifying the signature (it trusts the Accounts Service)
   - Extracts user information: `userId`, `email`, `name`, `emailVerified`
   - This can be used to display user info or store in ShelfScan's database

--> **Set Local Session Cookies:**
   - ShelfScan sets two HttpOnly cookies on its own domain:

   1. **shelfscan_access_token:**
      ```
      Domain: shelfscan.shelfexecution.com
      Path: /
      HttpOnly: true
      Secure: true
      SameSite: Lax
      Max-Age: 86400 (1 day)
      Value: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
      ```
   
   2. **shelfscan_refresh_token:**
      ```
      Domain: shelfscan.shelfexecution.com
      Path: /
      HttpOnly: true
      Secure: true
      SameSite: Lax
      Max-Age: 2592000 (30 days)
      Value: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
      ```

--> **Final Redirect to Dashboard:**
   - ShelfScan sends a **302 Redirect** response to:
     ```
     https://shelfscan.shelfexecution.com/dashboard
     ```

---

**Step 9: User Accesses ShelfScan Dashboard**

--> **User's Browser:** Follows the redirect and sends a GET request to:
```
https://shelfscan.shelfexecution.com/dashboard
```

**This Time:** The browser includes the `shelfscan_access_token` cookie!

--> **ShelfScan Middleware Check:**
   - Extracts the `shelfscan_access_token` cookie
   - Verifies the JWT signature (using the same secret that signed it)
   - Checks if the token has expired
   - Extracts the `userId` from the payload
   - Result: ✅ **VALID** (user is authenticated)

--> **Render Dashboard:**
   - ShelfScan fetches user-specific data from its database
   - Renders the dashboard page with personalized content
   - Display: "Welcome, John Doe!"

**✅ LOGIN FLOW COMPLETE**

**Summary:**
- **Total Redirects:** 5
- **Pages Visited:** ShelfScan → Accounts OAuth → Accounts Login → Accounts OAuth → ShelfScan Callback → ShelfScan Dashboard
- **Time:** ~2-3 seconds
- **User Experience:** User had to enter credentials once

---

---

### Scenario 2: SSO Magic - User Already Logged In (Visiting Another App)

**Context:** User successfully logged into ShelfScan (completed Scenario 1). Now they open a new browser tab and visit `https://shelfmuse.shelfexecution.com/` for the first time. The `accounts_session` cookie still exists on `.shelfexecution.com` domain.

---

**Step 1: User Visits ShelfMuse**

--> **User Action:** User types `https://shelfmuse.shelfexecution.com/` in a new tab and hits Enter.

--> **What Happens:** Browser sends a GET request to ShelfMuse's server.

--> **ShelfMuse NextJS Middleware Check:**
   - Looking for: `shelfmuse_access_token` and `shelfmuse_refresh_token`
   - Result: ❌ **NOT FOUND** (user has never visited ShelfMuse before)

--> **ShelfMuse Middleware Action:**
   - Generates a new random CSRF token (e.g., `muse_csrf_token_xyz789`)
   - Stores this `state` value in a temporary cookie on ShelfMuse's domain
   - Constructs the OAuth authorization URL with ShelfMuse-specific parameters:
     - `client_id`: `shelfmuse` (different from shelfscan!)
     - `redirect_uri`: `https://shelfmuse.shelfexecution.com/callback`
     - `response_type`: `code`
     - `state`: `muse_csrf_token_xyz789`

--> **Redirect Response:** ShelfMuse sends a **302 Redirect** to:
```
https://accounts.shelfexecution.com/api/v1/oauth/authorize?client_id=shelfmuse&redirect_uri=https://shelfmuse.shelfexecution.com/callback&response_type=code&state=muse_csrf_token_xyz789
```

---

**Step 2: Authorization Endpoint Finds Existing Session (SSO Magic!)**

--> **User's Browser:** Follows the redirect and sends a GET request to:
```
https://accounts.shelfexecution.com/api/v1/oauth/authorize?client_id=shelfmuse&redirect_uri=https://shelfmuse.shelfexecution.com/callback&response_type=code&state=muse_csrf_token_xyz789
```

**Important:** The browser automatically includes the `accounts_session` cookie (from Scenario 1) because it's set on `.shelfexecution.com` domain!

--> **Accounts Backend Validation:**

   1. **Validate Client ID:**
      - Queries `client_apps` table for `client_id=shelfmuse`
      - Result: ✅ **VALID** (shelfmuse is registered)
   
   2. **Validate Redirect URI:**
      - Checks if `https://shelfmuse.shelfexecution.com/callback` is in shelfmuse's `allowedRedirectUris`
      - Result: ✅ **VALID**
   
   3. **Check for Global SSO Cookie:**
      - Backend looks for `accounts_session` cookie
      - Result: ✅ **FOUND!** (User logged in earlier via ShelfScan)

--> **Verify JWT Token:**
   - Backend verifies the JWT signature
   - Checks expiration
   - Extracts `userId`: `user-123-abc-def`
   - Result: ✅ **VALID** (user is already authenticated!)

**🎉 SSO MAGIC:** The user doesn't need to enter credentials again! The accounts service recognizes them from the global cookie.

--> **Generate New Authorization Code (for ShelfMuse):**
   - Backend generates a fresh authorization code: `muse_auth_code_def456`
   - Stores it in `auth_codes` table:
     ```json
     {
       "id": "auth-code-uuid-456",
       "code": "muse_auth_code_def456",
       "userId": "user-123-abc-def",
       "clientId": "shelfmuse",
       "redirectUri": "https://shelfmuse.shelfexecution.com/callback",
       "expiresAt": "2025-12-09T10:50:00.000Z",
       "isUsed": false,
       "createdAt": "2025-12-09T10:40:00.000Z"
     }
     ```

--> **Immediate Redirect (No Login Page!):** Backend sends a **302 Redirect** to:
```
https://shelfmuse.shelfexecution.com/callback?code=muse_auth_code_def456&state=muse_csrf_token_xyz789
```

**Note:** User never saw the login page! This is the essence of Single Sign-On.

---

**Step 3: ShelfMuse Callback - Token Exchange**

--> **User's Browser:** Follows the redirect to:
```
https://shelfmuse.shelfexecution.com/callback?code=muse_auth_code_def456&state=muse_csrf_token_xyz789
```

--> **ShelfMuse Backend:**

   1. **Verify State:**
      - Compares received `state` with stored value
      - Result: ✅ **MATCH**
   
   2. **Exchange Code for Tokens:**
      - Sends POST request to `https://accounts.shelfexecution.com/api/v1/oauth/token`
      - **Body:**
        ```json
        {
          "code": "muse_auth_code_def456",
          "client_id": "shelfmuse",
          "client_secret": "shelfmuse_different_secret_67890",
          "redirect_uri": "https://shelfmuse.shelfexecution.com/callback",
          "grant_type": "authorization_code"
        }
        ```

--> **Accounts Service Validates and Returns Tokens:**
   - Validates the code (same process as Scenario 1, Step 7)
   - Marks code as used
   - Generates fresh tokens for ShelfMuse
   - Returns:
     ```json
     {
       "success": true,
       "access_token": "eyJhbGci...new_token_for_shelfmuse...",
       "refresh_token": "eyJhbGci...new_refresh_for_shelfmuse...",
       "id_token": "eyJhbGci...user_info_token...",
       "token_type": "Bearer",
       "expires_in": 86400
     }
     ```

--> **ShelfMuse Sets Local Cookies:**
   - Sets `shelfmuse_access_token` and `shelfmuse_refresh_token` cookies
   - Redirects to: `https://shelfmuse.shelfexecution.com/dashboard`

---

**Step 4: User Accesses ShelfMuse Dashboard**

--> **User's Browser:** Loads `https://shelfmuse.shelfexecution.com/dashboard` with the new cookies.

--> **ShelfMuse Middleware:**
   - Validates the `shelfmuse_access_token`
   - Result: ✅ **VALID**

--> **Render Dashboard:**
   - Display: "Welcome, John Doe!"

**✅ SSO COMPLETE (SEAMLESS LOGIN)**

**Summary:**
- **Total Redirects:** 3
- **Pages Visited:** ShelfMuse → Accounts OAuth → ShelfMuse Callback → ShelfMuse Dashboard
- **Time:** ~500ms (nearly instant!)
- **User Experience:** NO password prompt! Seamless authentication
- **Key Difference:** The `accounts_session` cookie enabled silent authentication

---

---

### Scenario 3: Direct Visit to Accounts Service (No OAuth Flow)

**Context:** User directly visits `https://accounts.shelfexecution.com/` by typing it in the browser or clicking a bookmark. No client app is involved.

---

**Step 1: User Visits Accounts Home Page**

--> **User Action:** User navigates to `https://accounts.shelfexecution.com/`

--> **What Happens:** Browser sends a GET request to the accounts service.

--> **Accounts Backend Check:**
   - This is not an OAuth authorization request (no `client_id` in URL)
   - This is a regular page visit to the accounts service itself
   - Backend checks for `access_token` cookie (NOT `accounts_session`)
   
--> **Two Possible Cases:**

**Case A: User is NOT logged into Accounts**
   - `access_token` cookie not found
   - Backend redirects to: `https://accounts.shelfexecution.com/login`
   - User sees login page without any OAuth parameters
   - User can login to manage their account settings, profile, etc.

**Case B: User is Already Logged into Accounts**
   - `access_token` cookie found and valid
   - Backend renders the user's account dashboard
   - User can see: Profile settings, connected apps, security settings, etc.

---

**Step 2: User Logs In (if Case A)**

--> **User Submits Login Form:**
   - Enters credentials and clicks "Login"
   - Frontend sends POST to `/api/v1/auth/login`
   - **Body:**
     ```json
     {
       "identifier": "john@example.com",
       "password": "SecurePass123!"
     }
     ```
   - **Note:** No `client_id` parameter! This is NOT an OAuth flow.

--> **Backend Authenticates:**
   - Validates credentials (same process as before)
   - Detects that `client_id` is NOT present
   - **Decision:** This is a direct login to accounts service (not OAuth)

--> **Backend Sets Cookies (All Local to Accounts):**
   1. `accounts_session` - Global SSO cookie (domain: `.shelfexecution.com`)
   2. `access_token` - Local to accounts service
   3. `refresh_token` - Local to accounts service

--> **Stores Refresh Token:**
   - Hashes and stores in `refresh_tokens` table

--> **Response:**
   - Instead of redirecting to OAuth authorize endpoint, backend returns:
     ```json
     {
       "success": true,
       "message": "Login successful",
       "data": {
         "user": {
           "id": "user-123-abc-def",
           "email": "john@example.com",
           "name": "John Doe",
           "emailVerified": true
         },
         "accessToken": "eyJhbGci...",
         "refreshToken": "eyJhbGci..."
       }
     }
     ```

--> **Frontend Behavior:**
   - Stores user info in state/context
   - Redirects user to: `https://accounts.shelfexecution.com/dashboard`
   - User can now manage their account, view connected apps, change password, etc.

**Key Points:**
- User logged into accounts service itself (not via OAuth)
- Both global `accounts_session` AND local `access_token` cookies are set
- No authorization code generated (not needed)
- User can now SSO into any client app (has global cookie)

---

---

### Scenario 4: Zombie Session - Local Session Survives Without Global Session

**Context:** User was logged into ShelfScan. They cleared their cookies in the browser settings and checked "Clear cookies from the last hour." The global `accounts_session` cookie got deleted, but the local `shelfscan_access_token` cookie is still valid (expires in 1 day, created 2 hours ago). Now they revisit ShelfScan.

---

**Step 1: User Visits ShelfScan Dashboard**

--> **User Action:** User clicks a bookmark to `https://shelfscan.shelfexecution.com/dashboard`

--> **What Happens:** Browser sends a GET request.

--> **ShelfScan Middleware Check:**
   - Looks for `shelfscan_access_token` cookie
   - Result: ✅ **FOUND** (local session still exists)

--> **Validate Local Token:**
   - Middleware extracts the JWT from the cookie
   - Verifies signature using the token secret
   - Checks expiration: `exp: 1702209856` (still valid for 22 more hours)
   - Extracts `userId`: `user-123-abc-def`
   - Result: ✅ **VALID**

--> **Grant Access:**
   - User is authenticated on ShelfScan
   - No need to contact the accounts service!
   - Render dashboard: "Welcome, John Doe!"

**✅ ACCESS GRANTED (ZOMBIE SESSION)**

**Key Point:** Each client app (ShelfScan, ShelfMuse) can validate its own JWT tokens independently without contacting the accounts service. The token contains all necessary information (userId, email, expiration).

---

**What About Visiting a Different App?**

--> **User Action:** User now opens a new tab and visits `https://shelfmuse.shelfexecution.com/`

--> **ShelfMuse Middleware:**
   - Looks for `shelfmuse_access_token`
   - Result: ❌ **NOT FOUND**

--> **Redirect to OAuth:**
   - ShelfMuse redirects to accounts service: `/oauth/authorize?client_id=shelfmuse&...`

--> **Accounts Service Check:**
   - Looks for `accounts_session` cookie
   - Result: ❌ **NOT FOUND** (user cleared it!)

--> **Redirect to Login:**
   - User is sent to: `https://accounts.shelfexecution.com/login?client_id=shelfmuse&...`
   - User must enter credentials again

**Summary:**
- ShelfScan: ✅ Still works (local token valid)
- ShelfMuse: ❌ Requires re-login (no global session)
- This is why it's called a "Zombie Session" - the local session outlives the global session

---

**When Does Zombie Session End?**

--> **Local Token Expires:**
   - After 1 day (or whatever expiry is set), the `shelfscan_access_token` JWT expires
   - User visits ShelfScan dashboard
   - Middleware validates token and finds: `exp < NOW()`
   - Result: ❌ **EXPIRED**

--> **Redirect to OAuth:**
   - ShelfScan redirects: `/oauth/authorize?client_id=shelfscan&...`
   - Accounts service checks for `accounts_session`
   - If missing: User sees login page
   - If present: SSO magic happens (code generated, token issued)

---

---

### Scenario 5: User Logged Out of Accounts, Then Visits ShelfScan

**Context:** User was fully logged into both Accounts and ShelfScan. They visited `https://accounts.shelfexecution.com/dashboard` and clicked the "Logout" button. This logout happened on the accounts service. Now they try to visit ShelfScan.

---

**Step 1: User Logs Out on Accounts Service**

--> **User Action:** On the accounts dashboard, user clicks "Logout" button.

--> **Frontend Behavior:**
   - Sends POST request to: `https://accounts.shelfexecution.com/api/v1/auth/logout`
   - May include the `refresh_token` in the body or rely on the cookie

--> **Backend Logout Process:**

   1. **Extract Refresh Token:**
      - Backend reads the `refresh_token` from the cookie or request body
   
   2. **Hash and Find Token:**
      - Hashes the token using SHA256
      - Queries `refresh_tokens` table where `tokenHash = hashed_value`
      - Finds the record
   
   3. **Revoke Token:**
      - Updates the record: `isRevoked = true`
      - This prevents the refresh token from being used again
   
   4. **Clear Cookies:**
      - Backend sends response with `Set-Cookie` headers to clear:
        - `accounts_session` (set to empty, max-age=0)
        - `access_token` (set to empty, max-age=0)
        - `refresh_token` (set to empty, max-age=0)

--> **Response:**
   ```json
   {
     "success": true,
     "message": "Logged out successfully"
   }
   ```

--> **Frontend Behavior:**
   - Redirects user to: `https://accounts.shelfexecution.com/login`
   - User is now logged out of the accounts service

**Important:** ShelfScan still has its local tokens (`shelfscan_access_token`, `shelfscan_refresh_token`)! These were NOT cleared.

---

**Step 2: User Visits ShelfScan**

--> **User Action:** User opens a new tab and visits `https://shelfscan.shelfexecution.com/dashboard`

--> **ShelfScan Middleware:**
   - Checks for `shelfscan_access_token` cookie
   - Result: ✅ **FOUND** (still exists!)

--> **Validate Token:**
   - Verifies JWT signature
   - Checks expiration
   - Result: ✅ **VALID**

--> **Grant Access:**
   - User is still logged into ShelfScan!
   - Dashboard renders: "Welcome, John Doe!"

**Surprise:** User is still logged into ShelfScan even though they logged out of accounts!

**Why?** Because:
1. JWT tokens are stateless - ShelfScan doesn't contact accounts to verify each request
2. The logout only cleared cookies on the `accounts.shelfexecution.com` domain
3. ShelfScan's cookies are on a different domain: `shelfscan.shelfexecution.com`
4. The browser didn't delete ShelfScan's cookies

---

**Step 3: User Visits Another App (ShelfMuse)**

--> **User Action:** User opens `https://shelfmuse.shelfexecution.com/`

--> **ShelfMuse Middleware:**
   - Checks for `shelfmuse_access_token`
   - Result: ❌ **NOT FOUND**

--> **Redirect to OAuth:**
   - ShelfMuse redirects to: `/oauth/authorize?client_id=shelfmuse&...`

--> **Accounts Service:**
   - Checks for `accounts_session` cookie
   - Result: ❌ **NOT FOUND** (cleared during logout!)

--> **Redirect to Login:**
   - User sees login page: `https://accounts.shelfexecution.com/login?client_id=shelfmuse&...`
   - Must enter credentials again

**Result:**
- ShelfScan: ✅ Still logged in (zombie session)
- ShelfMuse: ❌ Requires login (no global session)
- Accounts: ❌ Logged out

---

**Step 4: What If ShelfScan Token Expires?**

--> **Later:** User's `shelfscan_access_token` finally expires (after 1 day).

--> **User Visits ShelfScan:**
   - Middleware checks token
   - Result: ❌ **EXPIRED**

--> **Token Refresh Attempt:**
   - ShelfScan's frontend or middleware attempts to refresh the token
   - Sends request to accounts service: `POST /api/v1/auth/refresh`
   - Includes `shelfscan_refresh_token` (which is still valid for 30 days)

--> **Accounts Backend:**
   - Hashes the refresh token
   - Queries `refresh_tokens` table
   - Finds the record BUT: `isRevoked = true` (revoked during logout!)
   - Result: ❌ **REVOKED**

--> **Response:**
   ```json
   {
     "success": false,
     "message": "Refresh token has been revoked"
   }
   ```

--> **ShelfScan Frontend:**
   - Refresh failed
   - Clears local cookies
   - Redirects to OAuth: `/oauth/authorize?client_id=shelfscan&...`
   - User eventually sees login page

**Final State:**
- User is now fully logged out from all apps
- Must re-authenticate to access any service

---

**How to Implement Proper Global Logout:**

To immediately log user out of ALL apps:

1. **Backend:** When user clicks logout, iterate through all active sessions and revoke all refresh tokens for this user
2. **Frontend:** After logout, redirect to a "logged out" page with a list of client apps
3. **Client Apps:** Each app should implement a logout endpoint that clears local cookies
4. **Accounts Service:** Can use hidden iframes to hit each client app's logout endpoint:
   ```html
   <iframe src="https://shelfscan.shelfexecution.com/logout-silent" style="display:none"></iframe>
   <iframe src="https://shelfmuse.shelfexecution.com/logout-silent" style="display:none"></iframe>
   ```
5. **Token Expiry:** Use shorter access token expiry (e.g., 15 minutes) so zombie sessions don't last long

---

---

### Scenario 6: Token Refresh Flow (Access Token Expired)

**Context:** User is logged into ShelfScan. Their `shelfscan_access_token` expired (after 1 day), but their `shelfscan_refresh_token` is still valid (30-day expiry). User tries to access a protected page.

---

**Step 1: User Accesses Protected Resource**

--> **User Action:** User visits `https://shelfscan.shelfexecution.com/profile`

--> **ShelfScan Middleware:**
   - Extracts `shelfscan_access_token` from cookie
   - Verifies signature: ✅
   - Checks expiration: ❌ **EXPIRED** (exp < NOW)

--> **Middleware Decision:**
   - Don't immediately redirect to login
   - Attempt to refresh the token using the refresh token

---

**Step 2: Automatic Token Refresh**

--> **ShelfScan Backend Action:**
   - Extracts `shelfscan_refresh_token` from cookie
   - Sends POST request to: `https://accounts.shelfexecution.com/api/v1/auth/refresh`

**Request Headers:**
```
Content-Type: application/json
Cookie: refresh_token=eyJhbGci...
```

**Request Body (optional):**
```json
{
  "refreshToken": "eyJhbGci..."
}
```

**Note:** The refresh token can be sent in cookie OR body. Backend checks both.

---

**Step 3: Accounts Service Validates Refresh Token**

--> **Backend Process:**

   1. **Extract Refresh Token:**
      - Read from cookie or request body
      - Result: Token found
   
   2. **Verify JWT Signature:**
      - Verify using `REFRESH_TOKEN_SECRET`
      - Result: ✅ **VALID**
   
   3. **Extract Token ID:**
      - From JWT payload: `tokenId: "refresh-token-id-456"`
   
   4. **Hash the Token:**
      - Use SHA256 to hash the full refresh token
      - Result: `sha256_hash_value`
   
   5. **Find in Database:**
      - Query `refresh_tokens` table where `tokenHash = sha256_hash_value`
      - Result: Record found
   
   6. **Validate Token Status:**
      - Check `isRevoked`: ✅ `false` (not revoked)
      - Check `expiresAt`: ✅ `> NOW()` (not expired)
      - Result: ✅ **VALID**
   
   7. **Update Last Used:**
      - Update record: `lastUsedAt = NOW()`
      - This helps track token usage patterns

--> **Generate New Access Token:**
   - Backend retrieves user info from database using `userId`
   - Generates a fresh access token (JWT)
   - **Payload:**
     ```json
     {
       "userId": "user-123-abc-def",
       "email": "john@example.com",
       "emailVerified": true,
       "iss": "accounts.shelfexecution.com",
       "aud": "shelfex-services",
       "iat": 1702210000,
       "exp": 1702296400
     }
     ```

--> **Response:**

**HTTP Status:** 200 OK

**Response Body:**
```json
{
  "success": true,
  "message": "Token refreshed successfully",
  "data": {
    "accessToken": "eyJhbGci...new_fresh_token..."
  }
}
```

**Set-Cookie Header:**
```
Set-Cookie: access_token=eyJhbGci...new_fresh_token...; HttpOnly; Secure; SameSite=Lax; Max-Age=86400; Domain=accounts.shelfexecution.com; Path=/
```

**Note:** Only the access token is returned. The refresh token remains unchanged.

---

**Step 4: ShelfScan Updates Local Token**

--> **ShelfScan Backend:**
   - Receives the new access token
   - Updates the `shelfscan_access_token` cookie with the new value
   - Sets the cookie on the response going back to the user's browser

--> **Retry Original Request:**
   - ShelfScan can now retry the original request to `/profile`
   - This time with a valid, fresh access token

--> **Middleware Check:**
   - Validates the new token
   - Result: ✅ **VALID**

--> **Render Page:**
   - User sees their profile page
   - User didn't notice anything (refresh happened in background!)

**✅ SEAMLESS TOKEN REFRESH**

**Key Point:** The user never saw a login page. The token was refreshed automatically using the refresh token.

---

**What If Refresh Token Is Also Expired/Revoked?**

--> **Accounts Service Response:**
```json
{
  "success": false,
  "message": "Refresh token has been revoked"
}
```
or
```json
{
  "success": false,
  "message": "Refresh token expired"
}
```

--> **ShelfScan Behavior:**
   - Refresh failed
   - Clear all local cookies
   - Redirect to OAuth authorize endpoint
   - User will eventually see login page and must re-authenticate

---

**Optional: Refresh Token Rotation**

For enhanced security, you can implement refresh token rotation:

1. On each refresh request, generate a NEW refresh token
2. Return both new access token AND new refresh token
3. Revoke the OLD refresh token
4. If someone tries to use the old refresh token (possible theft), revoke all tokens for that user

**Example Response with Rotation:**
```json
{
  "success": true,
  "message": "Token refreshed successfully",
  "data": {
    "accessToken": "eyJhbGci...new_access...",
    "refreshToken": "eyJhbGci...new_refresh..."
  }
}
```

This way, each refresh token can only be used once, making token theft much harder to exploit

---

## Token Management

### Token Validation Priority

The auth middleware checks tokens in this order:

```typescript
// 1. Check cookies first (browser requests)
if (req.cookies?.access_token) {
  token = req.cookies.access_token;
}
// 2. Check Authorization header (API clients)
else if (req.headers.authorization?.startsWith('Bearer ')) {
  token = req.headers.authorization.substring(7);
}
```

### Token Refresh Flow

When an access token expires, clients should use the refresh token:

```
Client App:
  POST accounts.shelfex.com/api/v1/auth/refresh
  Cookie: refresh_token=eyJhbGci...
                    │
                    ▼
Accounts Server:
  1. Read refresh_token from cookie
  2. Hash token with SHA256
  3. Find hashed token in database
  4. Check if revoked ❌
  5. Check if expired ❌
  6. Get user from database
  7. Generate NEW access_token
  8. Update lastUsedAt timestamp
  9. Return new access_token
                    │
                    ▼
Client App:
  - Update access_token cookie
  - Retry original request with new token
```

**Refresh Token Rotation (Optional Enhancement):**

For maximum security, implement refresh token rotation:
1. On each refresh, issue a NEW refresh token
2. Revoke the OLD refresh token
3. Store token family ID to detect theft

---

## Security Features

### 1. Password Security
- **Bcrypt hashing** with 12 salt rounds
- Passwords never stored in plain text
- Bcrypt automatically handles salts

### 2. Token Security
- **JWT signatures** prevent tampering
- **Short-lived access tokens** (1 day) limit exposure
- **Refresh tokens hashed** before storage (SHA256)
- **HttpOnly cookies** prevent XSS attacks
- **SameSite=lax** prevents CSRF attacks

### 3. OAuth Security
- **Authorization codes** expire in 10 minutes
- **One-time use** codes (marked as used)
- **Redirect URI validation** prevents code interception
- **Client secret verification** (bcrypt)
- **State parameter** support for CSRF protection

### 4. Database Security
- **Foreign key constraints** with cascade delete
- **Unique constraints** on tokens/codes
- **Indexed fields** for performance
- **Prepared statements** via Drizzle (SQL injection prevention)

### 5. Cookie Security
```typescript
res.cookie('access_token', token, {
  httpOnly: true,        // JavaScript cannot access
  secure: isProduction,  // HTTPS only in production
  sameSite: 'lax',       // CSRF protection
  domain: '.shelfex.com', // Cross-subdomain (SSO cookie)
  maxAge: 86400000       // 1 day
});
```

### 6. Email Verification (Optional)

Control via environment variable:
```env
EMAIL_VERIFICATION_REQUIRED=false
```

When enabled:
- Unverified users get `403 Forbidden` on protected routes
- Middleware checks `emailVerified` field in JWT

---

## Configuration

### Environment Variables

```env
# Server
NODE_ENV=development
PORT=8000

# Database
DATABASE_URL=postgresql://user:pass@host:5432/dbname

# CORS
CORS_ORIGIN=http://localhost:3000

# JWT Secrets (Generate with: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))")
ACCESS_TOKEN_SECRET=your-secret-key-here
REFRESH_TOKEN_SECRET=your-secret-key-here

# Email Verification
EMAIL_VERIFICATION_REQUIRED=false

# Cookie Domain (use .shelfex.com in production for SSO)
COOKIE_DOMAIN=localhost
```

### Generating Secure Secrets

```bash
# Generate a random 512-bit secret
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

Output example:
```
a3f7c8e9d2b4f6a1c8e7d3b9f2a6c4e8d1b7f9a2c5e8d4b1f7a9c3e6d2b8f4a7c9e1d5b3f8a6c2e9d7b4f1a8c5e3d9b6f2a7c4e1d8b5f9a3c7e2d6b1f4a9c8e5d3b7
```

### Production Deployment Checklist

- [ ] Set `NODE_ENV=production`
- [ ] Use strong, unique secrets for `ACCESS_TOKEN_SECRET` and `REFRESH_TOKEN_SECRET`
- [ ] Set `COOKIE_DOMAIN=.shelfex.com` for cross-subdomain cookies
- [ ] Enable HTTPS (`secure: true` in cookies)
- [ ] Set up SSL certificates
- [ ] Configure CORS properly (whitelist specific origins)
- [ ] Enable email verification (`EMAIL_VERIFICATION_REQUIRED=true`)
- [ ] Implement rate limiting (e.g., express-rate-limit)
- [ ] Set up monitoring and logging
- [ ] Backup database regularly
- [ ] Rotate secrets periodically

---

## Client App Integration Guide

### For ShelfScan, ShelfMuse, etc.

#### Step 1: Register Client App

Insert into `client_apps` table:

```sql
INSERT INTO client_apps (client_id, client_secret, name, allowed_redirect_uris)
VALUES (
  'shelfscan',
  '$2b$12$hashed_secret_here', -- bcrypt hash of actual secret
  'ShelfScan',
  '["http://localhost:3001/callback", "https://shelfscan.com/callback"]'::json
);
```

#### Step 2: Client Middleware (Detect Unauthenticated Users)

```typescript
// shelfscan backend
app.use((req, res, next) => {
  if (!req.cookies.shelfscan_session) {
    // No local session - redirect to accounts
    const authorizeUrl = new URL('https://accounts.shelfex.com/api/v1/oauth/authorize');
    authorizeUrl.searchParams.set('client_id', 'shelfscan');
    authorizeUrl.searchParams.set('redirect_uri', 'https://shelfscan.com/callback');
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('state', generateRandomState()); // CSRF protection
    
    return res.redirect(authorizeUrl.toString());
  }
  next();
});
```

#### Step 3: Callback Handler (Exchange Code for Tokens)

```typescript
// shelfscan backend
app.get('/callback', async (req, res) => {
  const { code, state } = req.query;
  
  // Verify state (CSRF protection)
  if (!verifyState(state)) {
    return res.status(400).send('Invalid state');
  }
  
  // Exchange code for tokens
  const response = await fetch('https://accounts.shelfex.com/api/v1/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code,
      client_id: 'shelfscan',
      client_secret: process.env.SHELFSCAN_CLIENT_SECRET,
      redirect_uri: 'https://shelfscan.com/callback',
      grant_type: 'authorization_code'
    })
  });
  
  const tokens = await response.json();
  
  // Decode ID token to get user info
  const userInfo = jwt.decode(tokens.id_token);
  console.log('User:', userInfo); // { userId, email, name, emailVerified }
  
  // Set local session cookie
  res.cookie('shelfscan_session', tokens.access_token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 86400000 // 1 day
  });
  
  // Store refresh token securely
  res.cookie('shelfscan_refresh', tokens.refresh_token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 2592000000 // 30 days
  });
  
  // Redirect to dashboard
  res.redirect('/dashboard');
});
```

#### Step 4: Token Refresh

```typescript
// shelfscan backend
async function refreshAccessToken(refreshToken) {
  const response = await fetch('https://accounts.shelfex.com/api/v1/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken })
  });
  
  const { data } = await response.json();
  return data.accessToken;
}
```

---

## Troubleshooting

### Common Issues

#### 1. "Invalid client_id" Error

**Cause:** Client app not registered in database.

**Solution:**
```sql
SELECT * FROM client_apps WHERE client_id = 'your-client-id';
```

If empty, insert the client app.

---

#### 2. "Invalid redirect_uri" Error

**Cause:** Redirect URI not in `allowedRedirectUris` array.

**Solution:**
```sql
UPDATE client_apps
SET allowed_redirect_uris = '["http://localhost:3001/callback", "https://yourapp.com/callback"]'::json
WHERE client_id = 'your-client-id';
```

---

#### 3. "Authorization code expired" Error

**Cause:** Code took more than 10 minutes to exchange.

**Solution:** Ensure client app exchanges codes immediately after receiving them.

---

#### 4. "Authorization code already used" Error

**Cause:** Code was exchanged twice (possible replay attack).

**Solution:** This is expected behavior. Each code can only be used once. Request a new code by restarting the OAuth flow.

---

#### 5. Cookies Not Working in Development

**Cause:** Browser blocking cross-site cookies.

**Temporary Solution (Dev Only):**
```typescript
// Set sameSite: 'none' and secure: false for local development
res.cookie('accounts_session', token, {
  httpOnly: true,
  secure: false, // Allow HTTP in dev
  sameSite: 'none' // Allow cross-site
});
```

**Production Solution:** Use same domain (e.g., `accounts.shelfex.com` and `app.shelfex.com`).

---

#### 6. "Client secret is incorrect" Error

**Cause:** Plain text secret sent instead of hashed version, or wrong secret.

**Check:**
```typescript
// Correct: Send plain text secret (backend hashes it for comparison)
client_secret: "my-secret-key"

// Wrong: Sending bcrypt hash
client_secret: "$2b$12$..."
```

---

## Database Maintenance

### Cleanup Expired Codes

Run periodically (e.g., daily cron job):

```sql
DELETE FROM auth_codes
WHERE expires_at < NOW();
```

### Cleanup Revoked Tokens

```sql
DELETE FROM refresh_tokens
WHERE is_revoked = true
  AND created_at < NOW() - INTERVAL '30 days';
```

### Monitor Active Sessions

```sql
SELECT
  u.email,
  COUNT(rt.id) as active_sessions,
  MAX(rt.last_used_at) as last_activity
FROM users u
LEFT JOIN refresh_tokens rt ON u.id = rt.user_id
WHERE rt.is_revoked = false
  AND rt.expires_at > NOW()
GROUP BY u.id, u.email
ORDER BY last_activity DESC;
```

---

## API Testing with cURL

### 1. Register User

```bash
curl -X POST http://localhost:8000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "username": "testuser",
    "password": "SecurePass123!",
    "name": "Test User"
  }'
```

### 2. Login

```bash
curl -X POST http://localhost:8000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -c cookies.txt \
  -d '{
    "identifier": "test@example.com",
    "password": "SecurePass123!"
  }'
```

### 3. Get Current User (with Cookie)

```bash
curl -X GET http://localhost:8000/api/v1/auth/me \
  -b cookies.txt
```

### 4. Get Current User (with Header)

```bash
curl -X GET http://localhost:8000/api/v1/auth/me \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN_HERE"
```

### 5. Refresh Token

```bash
curl -X POST http://localhost:8000/api/v1/auth/refresh \
  -b cookies.txt \
  -c cookies.txt
```

### 6. OAuth Authorize (Manual Test)

```bash
curl -X GET "http://localhost:8000/api/v1/oauth/authorize?client_id=shelfscan&redirect_uri=http://localhost:3001/callback&response_type=code" \
  -b cookies.txt \
  -L # Follow redirects
```

### 7. OAuth Token Exchange

```bash
curl -X POST http://localhost:8000/api/v1/oauth/token \
  -H "Content-Type: application/json" \
  -d '{
    "code": "YOUR_AUTH_CODE_HERE",
    "client_id": "shelfscan",
    "client_secret": "shelfscan-secret",
    "redirect_uri": "http://localhost:3001/callback",
    "grant_type": "authorization_code"
  }'
```

---

## Architecture Decisions

### Why OAuth 2.0 Authorization Code Flow?

**Alternatives Considered:**
1. **Implicit Flow** - Tokens in URL (insecure)
2. **Password Grant** - Client apps see user passwords (bad)
3. **Client Credentials** - No user context

**Why Authorization Code:**
- ✅ Most secure for server-side apps
- ✅ Client never sees user password
- ✅ Tokens never exposed in URL
- ✅ Supports refresh tokens
- ✅ Industry standard (Google, GitHub, Auth0)

### Why Separate Access + Refresh Tokens?

**Alternatives Considered:**
1. **Single long-lived token** - If leaked, valid for 30 days
2. **Session IDs in database** - Requires DB lookup on every request

**Why Dual Tokens:**
- ✅ Access token short-lived (1 day) - limits damage if leaked
- ✅ Refresh token rarely used - can be revoked
- ✅ Stateless access tokens - no DB lookup needed
- ✅ Can revoke all sessions by clearing refresh tokens

### Why Hash Refresh Tokens in Database?

**If leaked:** Attacker can't use database dump to impersonate users.

**Trade-off:** Slightly slower token validation (SHA256 hash on each refresh).

### Why `accounts_session` Cookie?

**Enables SSO:** When user visits new app, accounts server can detect existing login without password prompt.

**Domain Strategy:**
- Set `domain: .shelfex.com`
- Cookie accessible on `accounts.shelfex.com`, `shelfscan.shelfex.com`, `shelfmuse.shelfex.com`

---

## Performance Considerations

### Database Indexes

All critical fields are indexed:
- `users.email` (login lookups)
- `users.username` (login lookups)
- `refresh_tokens.token_hash` (refresh validation)
- `refresh_tokens.user_id` (user session queries)
- `auth_codes.code` (OAuth code validation)
- `client_apps.client_id` (OAuth client validation)

### Token Validation

Access tokens are **stateless JWTs**:
- No database lookup on every request
- Only signature verification (fast)
- Trade-off: Can't revoke immediately (wait for expiry)

Refresh tokens require **database lookup**:
- Check if revoked
- Check if expired
- Update `lastUsedAt`

### Caching Opportunities

**Client Apps:** Load once, cache in memory (rarely change).

```typescript
// Example: In-memory cache
const clientCache = new Map();

async function getClient(clientId) {
  if (clientCache.has(clientId)) {
    return clientCache.get(clientId);
  }
  
  const client = await db.query.clientApps.findFirst({
    where: eq(clientApps.clientId, clientId)
  });
  
  clientCache.set(clientId, client);
  return client;
}
```

---

## Future Enhancements

### 1. Email Verification
- Send verification email on registration
- `POST /auth/verify-email?token=xyz`
- Update `emailVerified` field

### 2. Password Reset
- `POST /auth/forgot-password` - Send reset email
- `POST /auth/reset-password` - Update password with token

### 3. Two-Factor Authentication (2FA)
- TOTP (Time-based One-Time Password)
- SMS codes
- Backup codes

### 4. OAuth Scopes
- Fine-grained permissions (e.g., `read:profile`, `write:data`)
- Store in `auth_codes` table
- Return in ID token

### 5. Refresh Token Rotation
- Issue new refresh token on each use
- Revoke old refresh token
- Detect token theft

### 6. Rate Limiting
- Prevent brute force attacks on `/login`
- Limit token exchange attempts
- Use `express-rate-limit`

### 7. Audit Logs
- Track all login attempts
- Record token usage
- Monitor suspicious activity

### 8. Social Login
- "Login with Google"
- "Login with GitHub"
- Federated identity

---

## Conclusion

This authentication system provides **enterprise-grade security** with **seamless user experience**. The OAuth 2.0 flow ensures passwords never leave the accounts service, while the SSO cookie enables instant authentication across all Shelfex products.

**Key Takeaways:**
- 🔒 **Secure** - Hashed passwords, signed JWTs, one-time codes
- ⚡ **Fast** - Stateless access tokens, indexed database, SSO cookies
- 🎯 **Scalable** - Supports unlimited client apps, horizontal scaling
- 🛠️ **Maintainable** - TypeScript, Drizzle ORM, clear separation of concerns

For questions or contributions, please open an issue on GitHub.

---

**Built with ❤️ by the Shelfex Team**
