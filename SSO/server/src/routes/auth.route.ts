import { Router } from 'express';
import {
  register,
  verifyEmail,
  resendVerification,
  login,
  getLoginPage,
  forgotPassword,
  resetPassword,
  refresh,
  logout,
  logoutRedirect,
  getCurrentUser,
} from '../controllers/auth.controller';
import { authMiddleware } from '../middlewares/auth.middleware';

const router = Router();

// Public routes
router.get('/login', getLoginPage);
router.post('/register', register);
router.post('/verify-email', verifyEmail);
router.post('/resend-verification', resendVerification);
router.post('/login', login);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);
router.post('/refresh', refresh);
router.post('/logout', logout);
router.get('/logout', logoutRedirect);

// Protected routes
router.get('/me', authMiddleware, getCurrentUser);

export default router;
