import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, AccessTokenPayload } from '../utils/jwt';
import logger from '../utils/logger';

declare global {
  namespace Express {
    interface Request {
      user?: AccessTokenPayload;
    }
  }
}

export const authMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    let token: string | undefined;

    if (req.cookies?.access_token) {
      token = req.cookies.access_token;
      logger.debug('Token found in cookies');
    } else if (req.headers.authorization) {
      const authHeader = req.headers.authorization;
      if (authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7);
        logger.debug('Token found in Authorization header');
      }
    }

    if (!token) {
      res.status(401).json({
        success: false,
        message: 'Authentication required',
        error: 'No token provided',
      });
      return;
    }

    const decoded = verifyAccessToken(token);

    const emailVerificationRequired = process.env.EMAIL_VERIFICATION_REQUIRED === 'true';
    if (emailVerificationRequired && !decoded.emailVerified) {
      res.status(403).json({
        success: false,
        message: 'Email verification required',
        error: 'Please verify your email before accessing this resource',
      });
      return;
    }

    // Attach user to request
    req.user = decoded;
    next();
  } catch (error) {
    if (error instanceof Error) {
      logger.error(`Auth middleware error: ${error.message}`);

      if (error.message === 'Access token expired') {
        res.status(401).json({
          success: false,
          message: 'Token expired',
          error: 'Please refresh your token',
        });
        return;
      }

      if (error.message === 'Invalid access token') {
        res.status(401).json({
          success: false,
          message: 'Invalid token',
          error: 'Token is malformed or invalid',
        });
        return;
      }
    }

    res.status(401).json({
      success: false,
      message: 'Authentication failed',
      error: 'Could not verify token',
    });
  }
};