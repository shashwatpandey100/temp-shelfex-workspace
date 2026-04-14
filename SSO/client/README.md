# Shelfex Accounts - Frontend

A modern, polished authentication frontend built with **Next.js 14**, **TypeScript**, and **Tailwind CSS**.

## Features

- ✨ Clean, modern UI with gradient backgrounds
- 🎨 Beautiful Tailwind CSS styling
- 📱 Fully responsive design
- 🔐 OAuth 2.0 authentication flow
- ⚡ Fast page loads with Next.js
- 🎯 Type-safe with TypeScript

## Tech Stack

- **Next.js 16.0.7** (App Router)
- **React 19.2.0**
- **TypeScript 5**
- **Axios 1.13.2** (API client with credentials support)
- **Tailwind CSS 4** (Modern utility-first CSS)

## Pages

### 1. Root (`/`)
- Automatically redirects to `/login`
- Users should never directly visit accounts.shelfex.com
- In production, users are redirected here via OAuth flow from client apps

### 2. Login (`/login`)
- Clean login form with email/username and password
- OAuth flow support (detects `client_id` param)
- Error handling with user-friendly messages
- Loading states with animated spinner
- Link to register page

### 3. Register (`/register`)
- Account creation form
- Fields: Email (required), Username (optional), Password (required), Full Name (optional)
- Automatic redirect to login after successful registration
- Form validation and error messages

### 4. Success (`/success`)
- Post-login confirmation page
- Displays user account details
- Explains SSO functionality
- Logout button
- Only accessible when authenticated (redirects to login otherwise)

## Project Structure

```
frontend/
├── app/
│   ├── page.tsx              # Redirects to /login
│   ├── login/
│   │   └── page.tsx          # OAuth-ready login page
│   ├── register/
│   │   └── page.tsx          # Account creation page
│   └── success/
│       └── page.tsx          # Post-login success page
├── lib/
│   ├── axios.ts              # Axios instance with withCredentials
│   └── api.ts                # Typed API client (authApi)
├── .env.local                # Environment variables
└── package.json
```

## Environment Variables

Create a `.env.local` file in the frontend root:

```bash
NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1
```

**Production:**
```bash
NEXT_PUBLIC_API_URL=https://api.shelfex.com/api/v1
```

## Installation

```bash
cd frontend
npm install
```

## Development

Start the development server:

```bash
npm run dev
```

The app will be available at `http://localhost:3000`.

## Key Features

### Gradient Backgrounds
Each page has a unique gradient for visual appeal:
- **Login:** Blue to Purple
- **Register:** Purple to Blue
- **Success:** Green to Blue

### Responsive Design
All pages are fully responsive with:
- Mobile-first approach
- Breakpoints for sm, md, lg screens
- Touch-friendly buttons and inputs

### Loading States
All forms include:
- Disabled state during submission
- Animated spinner
- Contextual loading text

### Error Handling
User-friendly error messages with:
- Icon indicators
- Colored backgrounds (red for errors, blue for info)
- Clear, actionable text

## OAuth Flow Support

The login page supports OAuth context via query parameters:
- `client_id`: OAuth client identifier (e.g., "shelfscan")
- `redirect_uri`: Where to redirect after login
- `state`: CSRF protection token

**OAuth Login URL Example:**
```
http://localhost:3000/login?client_id=shelfscan&redirect_uri=http://localhost:3000/callback&state=random_state_123
```

When OAuth params are present:
- Displays client app info banner
- Submits credentials to backend
- Backend handles redirect to OAuth authorize endpoint

## API Client (`lib/api.ts`)

The frontend uses Axios with `withCredentials: true` to automatically send cookies with every request.

### Auth API

```typescript
// Register new user
await authApi.register({
  email: 'user@example.com',
  username: 'myusername', // optional
  password: 'securepass',
  name: 'John Doe' // optional
});

// Login (with optional OAuth params)
await authApi.login({
  identifier: 'user@example.com', // or username
  password: 'securepass',
  client_id: 'shelfscan', // optional
  redirect_uri: 'http://localhost:3000/callback', // optional
  state: 'random_state' // optional
});

// Logout (revokes refresh token)
await authApi.logout();

// Refresh access token
await authApi.refresh();
```

### OAuth API

```typescript
// Get login page data with OAuth context
const data = await oauthApi.getLoginPageData({
  client_id: 'shelfscan',
  redirect_uri: 'http://localhost:3000/callback',
  response_type: 'code',
  state: 'random_state'
});
```

## Authentication Flows

### Standard Login Flow

1. User navigates to `/login`
2. Enters email/username + password
3. Frontend calls `POST /auth/login`
4. Backend validates credentials and sets three cookies:
   - `access_token` (1 day, HttpOnly)
   - `refresh_token` (30 days, HttpOnly)
   - `accounts_session` (7 days, HttpOnly)
5. User is redirected to home page

### OAuth SSO Flow

For detailed OAuth scenarios (Cold Start, SSO Magic, Zombie Session, etc.), see the backend README.md which documents 6 complete flows with request/response examples.

**Quick Overview:**

**Scenario 1: New User (Cold Start)**
1. User clicks "Login" on client app (e.g., ShelfScan)
2. Client redirects to `http://localhost:8000/api/v1/oauth/authorize?client_id=shelfscan&...`
3. Backend checks `accounts_session` cookie → Not found
4. Backend redirects to `http://localhost:3000/login?client_id=shelfscan&...`
5. User enters credentials
6. Backend sets cookies and redirects to `http://localhost:3000/callback?code=xyz&state=abc`
7. Client app exchanges code for tokens

**Scenario 2: Returning User (SSO Magic)**
1. User already has valid `accounts_session` cookie
2. Client redirects to OAuth authorize endpoint
3. Backend finds valid session → generates code instantly
4. Backend redirects to callback → **No login page shown!**
5. Seamless SSO experience

**Scenario 3: Expired Access Token**
1. `access_token` expired but `refresh_token` and `accounts_session` still valid
2. Backend auto-generates new auth code using session
3. Client exchanges code for fresh tokens
4. User never sees login prompt

## Cookie Management

The frontend automatically sends cookies with every request via `withCredentials: true` in Axios.

### Cookies Set by Backend

| Cookie | Domain | HttpOnly | SameSite | Expiry | Purpose |
|--------|--------|----------|----------|--------|---------|
| `accounts_session` | `.shelfex.com` | Yes | Lax | 30 days | Global SSO session |
| `access_token` | `accounts.shelfex.com` | Yes | Lax | 1 day | API authorization |
| `refresh_token` | `accounts.shelfex.com` | Yes | Lax | 30 days | Token refresh |

### Production Cookie Domain

In production, set `COOKIE_DOMAIN` in backend `.env`:
```bash
COOKIE_DOMAIN=.shelfex.com
```

This allows `accounts_session` to work across:
- accounts.shelfex.com
- devshelfscan.shelfexecution.com
- dev.shelfmuse.tech

## Security Best Practices

### 1. **Credentials Management**
- ✅ All API requests use `withCredentials: true`
- ✅ Cookies are HttpOnly (not accessible via JavaScript)
- ✅ SameSite=Lax prevents CSRF attacks
- ✅ Secure flag set in production (HTTPS only)

### 2. **Token Storage**
- ✅ Tokens stored in HttpOnly cookies (not localStorage)
- ✅ Access token: 1 day expiry
- ✅ Refresh token: 30 days expiry with rotation
- ✅ Refresh tokens can be revoked

### 3. **OAuth Security**
- ✅ State parameter for CSRF protection
- ✅ Authorization codes are one-time use
- ✅ Auth codes expire in 10 minutes
- ✅ Client secrets verified with bcrypt

### 4. **Password Security**
- ✅ Passwords hashed with bcrypt (12 rounds)
- ✅ Minimum password length enforced on backend
- ✅ Passwords never stored in plain text

### 5. **Protected Routes**
- ✅ Success page checks auth on mount
- ✅ Redirects to login if not authenticated
- ✅ Uses `/auth/me` endpoint to verify session

### 6. **No Client-Side Token Storage**
- ❌ JWT tokens are NOT stored in localStorage or sessionStorage
- ✅ All tokens stored in HttpOnly cookies only
- ✅ Frontend never has access to raw tokens
- ✅ Prevents XSS token theft

## Testing the Application

### Prerequisites
1. Backend running on `http://localhost:8000`
2. Frontend running on `http://localhost:3000`
3. Database seeded with test user and client apps (see backend README)

### Test Steps

1. **Start both servers:**
   ```bash
   # Terminal 1 - Backend
   cd backend
   npm run dev

   # Terminal 2 - Frontend
   cd frontend
   npm run dev
   ```

2. **Test Registration:**
   - Visit: `http://localhost:3000/register`
   - Create new account with email and password
   - Should redirect to login page

3. **Test Login:**
   - Visit: `http://localhost:3000/login`
   - Enter your credentials
   - Should redirect to `/success` page showing account details
   - Check cookies in DevTools (Application → Cookies → localhost:3000)
   - Should see: `access_token`, `refresh_token`, `accounts_session`
   - Try logging out from success page

4. **Test OAuth Flow (Cold Start):**
   - Open new incognito window
4. **Test OAuth Flow (Production Simulation):**
   - For real OAuth testing, you need a client app (ShelfScan, ShelfMuse, etc.)
   - Client app redirects to: `http://localhost:8000/api/v1/oauth/authorize?client_id=shelfscan&redirect_uri=https://shelfscan.com/callback&response_type=code&state=test123`
   - User logs in on accounts frontend
   - Backend redirects to client's callback with auth code
   - Client app exchanges code for tokens
   
   **Note:** The accounts frontend does NOT have a `/callback` page. Only client apps have callbacks.

### Issue: "Network Error" on API calls

**Solution:**
- Ensure backend is running on port 8000
- Check `NEXT_PUBLIC_API_URL` in `.env.local`
- Verify CORS is enabled on backend

### Issue: Cookies not being sent

**Solution:**
- Check `withCredentials: true` in `lib/axios.ts`
- Ensure backend allows credentials in CORS config
- In production, verify `COOKIE_DOMAIN` matches your domain structure

### Issue: OAuth redirect not working

**Solution:**
- Check `allowedRedirectUris` in `clientApps` table
- Verify `client_id` matches database
- Ensure `redirect_uri` is URL-encoded
- Check backend logs for validation errors

### Issue: "Invalid client" error

**Solution:**
- Verify `client_id` exists in `clientApps` table
- Check if client is active (not disabled)
- Run `npm run db:seed` in backend to recreate clients

### Issue: Gradient not showing

**Solution:**
- Ensure Tailwind CSS is properly configured
- Check that `globals.css` imports Tailwind directives
- Restart dev server after Tailwind config changes

## Production Deployment

### Environment Variables

```bash
NEXT_PUBLIC_API_URL=https://api.shelfex.com/api/v1
```

### Build

```bash
npm run build
npm run start
```

### Considerations

1. **Domain Setup:**
   - Frontend: `accounts.shelfex.com`
   - Backend: `api.shelfex.com`
   - Set `COOKIE_DOMAIN=.shelfex.com` on backend

2. **HTTPS Required:**
   - Secure cookies require HTTPS
   - Use a reverse proxy (Nginx, Caddy)
   - Enable SSL certificates

3. **CORS Configuration:**
   - Update backend `ALLOWED_ORIGINS` to include production domains:
     ```
     ALLOWED_ORIGINS=https://accounts.shelfex.com,https://devshelfscan.shelfexecution.com,https://dev.shelfmuse.tech
     ```

4. **Redirect URIs:**
   - Update `allowedRedirectUris` in database for each client app
   - Use production domains instead of localhost

## Client App Integration

When building client apps (ShelfScan, ShelfMuse, etc.), follow this pattern:

### 1. Initiate OAuth Flow (Frontend)

```typescript
const loginUrl = `https://api.shelfex.com/api/v1/oauth/authorize?client_id=shelfscan&redirect_uri=${encodeURIComponent('https://devshelfscan.shelfexecution.com/callback')}&response_type=code&state=${generateRandomState()}`;

window.location.href = loginUrl;
```

### 2. Handle Callback (Backend)

```typescript
// In your /callback route handler
app.get('/callback', async (req, res) => {
  const { code, state } = req.query;
  
  // Verify state matches what you sent
  if (!verifyState(state)) {
    return res.status(400).send('Invalid state');
  }
  
  // Exchange code for tokens
  const response = await axios.post('https://api.shelfex.com/api/v1/oauth/token', {
    grant_type: 'authorization_code',
    code,
    redirect_uri: 'https://devshelfscan.shelfexecution.com/callback',
    client_id: 'shelfscan',
    client_secret: process.env.CLIENT_SECRET
  });
  
  const { access_token, refresh_token, id_token } = response.data;
  
  // Decode id_token to get user info
  const user = jwt.decode(id_token);
  
  // Create session for user in your app
  req.session.userId = user.sub;
  req.session.accessToken = access_token;
  req.session.refreshToken = refresh_token;
  
  res.redirect('/dashboard');
});
```

### 3. Use Access Token

```typescript
// Make authenticated requests to your backend
app.get('/api/protected', authenticateUser, async (req, res) => {
  // Access token is available in session
  const accessToken = req.session.accessToken;
  
  // Optional: Verify token with accounts backend
  const userInfo = await axios.get('https://api.shelfex.com/api/v1/auth/me', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  
  res.json({ user: userInfo.data });
});
```

### 4. Refresh Tokens

```typescript
async function refreshAccessToken(refreshToken: string) {
  const response = await axios.post('https://api.shelfex.com/api/v1/auth/refresh', 
    {}, 
    {
      headers: { Cookie: `refresh_token=${refreshToken}` }
    }
  );
  
  return response.data.accessToken;
}
```

## Development Notes

### Test Data
See backend README for test credentials and seeded client apps.

### UI Patterns
- **Gradients:** Each page uses unique gradient backgrounds for visual distinction
- **Loading States:** All forms disable inputs and show spinner during submission
- **Error Handling:** Red-tinted alerts with icon indicators
- **OAuth Context:** Blue info banners when OAuth params are present
- **Responsive:** Mobile-first design with `sm:`, `md:`, `lg:` breakpoints

## Further Reading

- [Backend README](../backend/README.md) - Complete API documentation
- [OAuth 2.0 Spec](https://tools.ietf.org/html/rfc6749)
- [Next.js App Router Docs](https://nextjs.org/docs/app)
- [Axios Documentation](https://axios-http.com/docs/intro)

**Test User:**
- Email: `test@shelfex.com`
- Username: `testuser`
- Password: `12345`