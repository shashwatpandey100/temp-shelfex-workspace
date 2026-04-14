import { pgTable, text, timestamp, boolean, uuid, index, json, integer } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// USERS TABLE
export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull().unique(),
  username: text('username').unique(),
  password: text('password').notNull(), // hashed with bcrypt
  name: text('name'),
  emailVerified: boolean('email_verified').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  emailIdx: index('email_idx').on(table.email),
  usernameIdx: index('username_idx').on(table.username),
}));

export const usersRelations = relations(users, ({ many }) => ({
  refreshTokens: many(refreshTokens),
  authCodes: many(authCodes),
}));

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

// REFRESH TOKENS TABLE
export const refreshTokens = pgTable('refresh_tokens', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(), // store hashed version
  expiresAt: timestamp('expires_at').notNull(), // 30 days
  isRevoked: boolean('is_revoked').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  lastUsedAt: timestamp('last_used_at'),
}, (table) => ({
  userIdIdx: index('refresh_tokens_user_id_idx').on(table.userId),
  tokenHashIdx: index('refresh_tokens_token_hash_idx').on(table.tokenHash),
}));

export const refreshTokensRelations = relations(refreshTokens, ({ one }) => ({
  user: one(users, {
    fields: [refreshTokens.userId],
    references: [users.id],
  }),
}));

export type RefreshToken = typeof refreshTokens.$inferSelect;
export type NewRefreshToken = typeof refreshTokens.$inferInsert;

// AUTH CODES TABLE (OAuth Flow)
export const authCodes = pgTable('auth_codes', {
  id: uuid('id').defaultRandom().primaryKey(),
  code: text('code').notNull().unique(), // SHA256 hash of the actual code
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  clientId: text('client_id').notNull().references(() => clientApps.clientId),
  redirectUri: text('redirect_uri').notNull(), // must match on exchange
  codeChallenge: text('code_challenge'), // PKCE: S256 hash of code_verifier
  codeChallengeMethod: text('code_challenge_method'), // PKCE: "S256" or "plain"
  nonce: text('nonce'), // OpenID Connect: echoed back in id_token
  expiresAt: timestamp('expires_at').notNull(), // 10 minutes
  isUsed: boolean('is_used').default(false).notNull(), // one-time use
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  codeIdx: index('auth_codes_code_idx').on(table.code),
  userIdIdx: index('auth_codes_user_id_idx').on(table.userId),
}));

export const authCodesRelations = relations(authCodes, ({ one }) => ({
  user: one(users, {
    fields: [authCodes.userId],
    references: [users.id],
  }),
  client: one(clientApps, {
    fields: [authCodes.clientId],
    references: [clientApps.clientId],
  }),
}));

export type AuthCode = typeof authCodes.$inferSelect;
export type NewAuthCode = typeof authCodes.$inferInsert;

// CLIENT APPS TABLE (Registered Apps)
export const clientApps = pgTable('client_apps', {
  id: uuid('id').defaultRandom().primaryKey(),
  clientId: text('client_id').notNull().unique(), // e.g., "shelfscan", "shelfmuse"
  clientSecret: text('client_secret').notNull(), // hashed with bcrypt
  name: text('name').notNull(), // e.g., "ShelfScan"
  allowedRedirectUris: json('allowed_redirect_uris').$type<string[]>().notNull(), // ["https://shelfscan.com/callback"]
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  clientIdIdx: index('client_apps_client_id_idx').on(table.clientId),
}));

export type ClientApp = typeof clientApps.$inferSelect;
export type NewClientApp = typeof clientApps.$inferInsert;
// EMAIL VERIFICATION CODES TABLE
export const emailVerificationCodes = pgTable('email_verification_codes', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  code: text('code').notNull(), // 6-digit OTP
  expiresAt: timestamp('expires_at').notNull(), // 10 minutes
  isUsed: boolean('is_used').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  userIdIdx: index('email_verification_codes_user_id_idx').on(table.userId),
}));

export type EmailVerificationCode = typeof emailVerificationCodes.$inferSelect;

// PASSWORD RESET TOKENS TABLE
export const passwordResetTokens = pgTable('password_reset_tokens', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(), // SHA256 hash of the token
  expiresAt: timestamp('expires_at').notNull(), // 1 hour
  isUsed: boolean('is_used').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  userIdIdx: index('password_reset_tokens_user_id_idx').on(table.userId),
  tokenHashIdx: index('password_reset_tokens_token_hash_idx').on(table.tokenHash),
}));

export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;

// LOGIN ATTEMPTS TABLE (Rate Limiting)
export const loginAttempts = pgTable('login_attempts', {
  id: uuid('id').defaultRandom().primaryKey(),
  identifier: text('identifier').notNull(), // email or username used
  ipAddress: text('ip_address'),
  success: boolean('success').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  identifierIdx: index('login_attempts_identifier_idx').on(table.identifier),
  createdAtIdx: index('login_attempts_created_at_idx').on(table.createdAt),
}));

export type LoginAttempt = typeof loginAttempts.$inferSelect;

// AUDIT LOGS TABLE
export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  action: text('action').notNull(), // e.g. 'user.register', 'user.login', 'user.password_reset'
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  metadata: json('metadata').$type<Record<string, unknown>>(), // additional context
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  userIdIdx: index('audit_logs_user_id_idx').on(table.userId),
  actionIdx: index('audit_logs_action_idx').on(table.action),
  createdAtIdx: index('audit_logs_created_at_idx').on(table.createdAt),
}));

export type AuditLog = typeof auditLogs.$inferSelect;