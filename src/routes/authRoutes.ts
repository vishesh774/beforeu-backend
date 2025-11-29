import express from 'express';
import { signup, login, adminLogin, getMe } from '../controllers/authController';
import { sendOTP, verifyOTPController, completeProfile } from '../controllers/otpController';
import { signupValidator, loginValidator } from '../validators/authValidator';
import { validate } from '../middleware/validate';
import { protect } from '../middleware/auth';

const router = express.Router();

// OTP-based authentication
router.post('/send-otp', sendOTP);
router.post('/verify-otp', verifyOTPController);
router.post('/complete-profile', completeProfile);

// Traditional email/password authentication
router.post('/signup', validate(signupValidator), signup);
router.post('/login', validate(loginValidator), login);

// Admin authentication (requires Admin, Supervisor, or Incharge role)
router.post('/admin/login', validate(loginValidator), adminLogin);

// Protected routes
router.get('/me', protect, getMe);

export default router;

