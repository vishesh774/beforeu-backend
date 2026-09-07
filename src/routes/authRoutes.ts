import express from 'express';
import { signup, login, adminLogin, getMe, addAddress, updateAddress, deleteAddress, addFamilyMember, updateFamilyMember, deleteFamilyMember, deleteAccount, cancelAccountDeletion, getAccountDeletionStatus, savePushToken, sendEmailOTP, verifyEmailOTP, updateEmail } from '../controllers/authController';
import { sendOTP, verifyOTPController, completeProfile } from '../controllers/otpController';
import { getAllPlans, purchasePlan, getMyPlanDetails } from '../controllers/planController';
import { getAllFAQs } from '../controllers/faqController';
import { getAllPolicies } from '../controllers/refundCancellationPolicyController';
import { getAllRules } from '../controllers/serviceDefinitionsVisitRulesController';
import { getAllTerms } from '../controllers/termsAndConditionsController';
import { signupValidator, loginValidator } from '../validators/authValidator';
import { validate } from '../middleware/validate';
import { protect, optionalAuth } from '../middleware/auth';

const router = express.Router();

// OTP-based authentication (Phone)
router.post('/send-otp', sendOTP);
router.post('/verify-otp', verifyOTPController);
router.post('/complete-profile', completeProfile);

// Email Verification OTP
router.post('/send-email-otp', (req, res, next) => {
    // Optionally use protect if token is present, but don't enforce it
    // This allows sendEmailOTP to check if email belongs to current user if they are logged in
    if (req.headers.authorization) {
        protect(req, res, next);
    } else {
        next();
    }
}, sendEmailOTP);
router.post('/verify-email-otp', verifyEmailOTP);
router.post('/update-email', protect, updateEmail);

// Traditional email/password authentication
router.post('/signup', validate(signupValidator), signup);
router.post('/login', validate(loginValidator), login);

// Admin authentication (requires Admin, Supervisor, or Incharge role)
router.post('/admin/login', validate(loginValidator), adminLogin);

// Protected routes
router.get('/me', protect, getMe);
router.get('/plans', optionalAuth, getAllPlans); // Customer-facing plans (active only; restricted plans shown only to their allow-list)
router.post('/plans/purchase', protect, purchasePlan); // Purchase a plan
router.get('/my-plan', protect, getMyPlanDetails); // Get current user's plan details with credits and savings
router.get('/faqs', getAllFAQs); // Customer-facing FAQs endpoint (only active FAQs)
router.get('/refund-cancellation-policies', getAllPolicies); // Customer-facing policies endpoint (only active)
router.get('/service-definitions-visit-rules', getAllRules); // Customer-facing rules endpoint (only active)
router.get('/terms-and-conditions', getAllTerms); // Customer-facing terms endpoint (only active)
router.post('/addresses', protect, addAddress);
router.put('/addresses/:id', protect, updateAddress);
router.delete('/addresses/:id', protect, deleteAddress);
router.post('/family-members', protect, addFamilyMember);
router.patch('/family-members/:id', protect, updateFamilyMember);
router.delete('/family-members/:id', protect, deleteFamilyMember);
router.delete('/delete-account', protect, deleteAccount); // Schedules deletion after a retention window
router.post('/cancel-account-deletion', protect, cancelAccountDeletion);
router.get('/account-deletion-status', protect, getAccountDeletionStatus);
router.post('/push-token', protect, savePushToken); // Customer app Expo push token

export default router;

