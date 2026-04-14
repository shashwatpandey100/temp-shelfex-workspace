// Password validation rules — keep in sync with SSO server (src/utils/password.ts)
// Min 8 chars, 1 uppercase, 1 lowercase, 1 number, 1 special char

export interface PasswordValidationResult {
  valid: boolean;
  errors: string[];
}

export function validatePassword(password: string): PasswordValidationResult {
  const errors: string[] = [];

  if (password.length < 8) {
    errors.push('At least 8 characters');
  }
  if (password.length > 128) {
    errors.push('At most 128 characters');
  }
  if (!/[a-z]/.test(password)) {
    errors.push('One lowercase letter');
  }
  if (!/[A-Z]/.test(password)) {
    errors.push('One uppercase letter');
  }
  if (!/[0-9]/.test(password)) {
    errors.push('One number');
  }
  if (!/[^a-zA-Z0-9]/.test(password)) {
    errors.push('One special character');
  }

  return { valid: errors.length === 0, errors };
}
