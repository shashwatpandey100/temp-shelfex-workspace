import { Resend } from 'resend';
import logger from './logger';

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';

export async function sendVerificationEmail(to: string, code: string, name?: string | null) {
  try {
    const { data, error } = await resend.emails.send({
      from: `Shelfex Accounts <${FROM_EMAIL}>`,
      to,
      subject: 'Verify your email — Shelfex',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
          <h2 style="color: #131313;">Verify your email</h2>
          <p>Hi${name ? ` ${name}` : ''},</p>
          <p>Your verification code is:</p>
          <div style="background: #f5f5f5; padding: 16px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 8px; margin: 16px 0;">
            ${code}
          </div>
          <p style="color: #666; font-size: 14px;">This code expires in 10 minutes.</p>
          <p style="color: #666; font-size: 14px;">If you didn't create an account on Shelfex, ignore this email.</p>
        </div>
      `,
    });

    if (error) {
      logger.error(`Failed to send verification email to ${to}: ${JSON.stringify(error)}`);
      return false;
    }

    logger.info(`Verification email sent to ${to} (id: ${data?.id})`);
    return true;
  } catch (error) {
    logger.error(`Email send error: ${error}`);
    return false;
  }
}

export async function sendPasswordResetEmail(to: string, resetUrl: string, name?: string | null) {
  try {
    const { data, error } = await resend.emails.send({
      from: `Shelfex Accounts <${FROM_EMAIL}>`,
      to,
      subject: 'Reset your password — Shelfex',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
          <h2 style="color: #131313;">Reset your password</h2>
          <p>Hi${name ? ` ${name}` : ''},</p>
          <p>We received a request to reset your password. Click the button below:</p>
          <div style="margin: 24px 0;">
            <a href="${resetUrl}" style="background: #131313; color: white; padding: 12px 24px; text-decoration: none; font-size: 14px; font-weight: 500;">
              Reset Password
            </a>
          </div>
          <p style="color: #666; font-size: 14px;">This link expires in 1 hour.</p>
          <p style="color: #666; font-size: 14px;">If you didn't request this, ignore this email. Your password won't change.</p>
        </div>
      `,
    });

    if (error) {
      logger.error(`Failed to send password reset email to ${to}: ${JSON.stringify(error)}`);
      return false;
    }

    logger.info(`Password reset email sent to ${to} (id: ${data?.id})`);
    return true;
  } catch (error) {
    logger.error(`Email send error: ${error}`);
    return false;
  }
}

export async function sendWelcomeEmail(to: string, name?: string | null) {
  try {
    const { data, error } = await resend.emails.send({
      from: `Shelfex Accounts <${FROM_EMAIL}>`,
      to,
      subject: 'Welcome to Shelfex!',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
          <h2 style="color: #131313;">Welcome to Shelfex!</h2>
          <p>Hi${name ? ` ${name}` : ''},</p>
          <p>Your Shelfex account has been created. You can now sign in to any Shelfex app using your email and password.</p>
          <p style="color: #666; font-size: 14px;">If you didn't create this account, please contact support.</p>
        </div>
      `,
    });

    if (error) {
      logger.error(`Failed to send welcome email to ${to}: ${JSON.stringify(error)}`);
      return false;
    }

    logger.info(`Welcome email sent to ${to} (id: ${data?.id})`);
    return true;
  } catch (error) {
    logger.error(`Email send error: ${error}`);
    return false;
  }
}
