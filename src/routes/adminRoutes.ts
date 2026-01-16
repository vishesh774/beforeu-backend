import express from 'express';
import { getAllUsers, getUser, createUser, updateUser, deactivateUser } from '../controllers/adminController';
import {
  getAllServiceRegions,
  getServiceRegion,
  createServiceRegion,
  updateServiceRegion,
  toggleServiceRegionStatus,
  checkPointInRegion
} from '../controllers/serviceRegionController';
import {
  getAllServices,
  getService,
  createService,
  updateService,
  toggleServiceStatus
} from '../controllers/serviceController';
import {
  getAllServicePartners,
  getServicePartner,
  createServicePartner,
  updateServicePartner,
  toggleServicePartnerStatus
} from '../controllers/servicePartnerController';
import {
  getAllCustomers,
  getCustomer,
  toggleCustomerStatus,
  addCustomer
} from '../controllers/customerController';
import {
  getAllBookings,
  getBookingById,
  updateOrderItemStatus,
  getEligibleServicePartners,
  assignServicePartner,
  rescheduleBooking,
  cancelBooking,
  assignServiceLocation
} from '../controllers/bookingController';
import {
  getAllPolicies,
  getPolicy,
  createPolicy,
  updatePolicy,
  deletePolicy,
  updateSequence
} from '../controllers/refundCancellationPolicyController';
import {
  getAllFAQs,
  getFAQ,
  createFAQ,
  updateFAQ,
  deleteFAQ,
  updateSequence as updateFAQSequence
} from '../controllers/faqController';
import {
  getAllRules,
  getRule,
  createRule,
  updateRule,
  deleteRule,
  updateSequence as updateRulesSequence
} from '../controllers/serviceDefinitionsVisitRulesController';
import {
  getAllTerms,
  getTerm,
  createTerm,
  updateTerm,
  deleteTerm,
  updateSequence as updateTermsSequence
} from '../controllers/termsAndConditionsController';
import {
  getAllPlans,
  getPlan,
  createPlan,
  updatePlan,
  deletePlan,
  getUserPlans,
  getPlanTransactions,
  getPlanTransactionDetails,
  verifyPlanPaymentStatus,
  togglePlanStatus
} from '../controllers/planController';
import {
  getAllCheckoutFields,
  getCheckoutField,
  createCheckoutField,
  updateCheckoutField,
  deleteCheckoutField,
  toggleCheckoutFieldStatus
} from '../controllers/checkoutConfigController';
import { updateAppConfig } from '../controllers/configController';
import { getRazorpayOrderDetails, reconcileExternalPayment } from '../controllers/paymentController';
import { getCompanySettings, updateCompanySettings } from '../controllers/companySettingsController';
import { generateInvoicePDF } from '../controllers/invoiceController';
import { requireAdmin } from '../middleware/adminAuth';

const router = express.Router();

// All routes require admin authentication
router.use(requireAdmin);

// Dashboard routes
import { getDashboardMetrics } from '../controllers/dashboardController';
router.get('/metrics', getDashboardMetrics);

// User management routes
router.get('/users', getAllUsers);
router.get('/users/:id', getUser);
router.post('/users', createUser);
router.put('/users/:id', updateUser);
router.patch('/users/:id/deactivate', deactivateUser);

// Service region routes
router.get('/service-regions', getAllServiceRegions);
router.get('/service-regions/:id', getServiceRegion);
router.post('/service-regions', createServiceRegion);
router.put('/service-regions/:id', updateServiceRegion);
router.patch('/service-regions/:id/toggle-status', toggleServiceRegionStatus);
router.post('/service-regions/check-point', checkPointInRegion);

// Service management routes
router.get('/services', getAllServices);
router.get('/services/:id', getService);
router.post('/services', createService);
router.put('/services/:id', updateService);
router.patch('/services/:id/toggle-status', toggleServiceStatus);

// Service partner routes
router.get('/service-partners', getAllServicePartners);
router.get('/service-partners/:id', getServicePartner);
router.post('/service-partners', createServicePartner);
router.put('/service-partners/:id', updateServicePartner);
router.patch('/service-partners/:id/toggle-status', toggleServicePartnerStatus);

// Service Location routes
import {
  createServiceLocation,
  getAllServiceLocations,
  getServiceLocationById,
  updateServiceLocation,
  toggleServiceLocationStatus
} from '../controllers/serviceLocationController';

router.post('/service-locations', createServiceLocation);
router.get('/service-locations', getAllServiceLocations);
router.get('/service-locations/:id', getServiceLocationById);
router.put('/service-locations/:id', updateServiceLocation);
router.patch('/service-locations/:id/toggle-status', toggleServiceLocationStatus);

// Customer management routes
router.get('/customers', getAllCustomers);
router.post('/customers', addCustomer);
router.get('/customers/:id', getCustomer);
router.patch('/customers/:id/toggle-status', toggleCustomerStatus);

// Booking management routes
router.get('/bookings', getAllBookings);
router.get('/bookings/:id', getBookingById);
router.get('/bookings/:id/eligible-partners', getEligibleServicePartners);
router.post('/bookings/:id/assign-partner', assignServicePartner);
router.post('/bookings/:id/reschedule', rescheduleBooking);
router.post('/bookings/:id/cancel', cancelBooking);
router.post('/bookings/:bookingId/items/:itemId/assign-location', assignServiceLocation);
router.patch('/bookings/:bookingId/items/:itemId/status', updateOrderItemStatus);

// Refund & Cancellation Policy routes
router.get('/refund-cancellation-policies', getAllPolicies);
router.get('/refund-cancellation-policies/:id', getPolicy);
router.post('/refund-cancellation-policies', createPolicy);
router.put('/refund-cancellation-policies/:id', updatePolicy);
router.delete('/refund-cancellation-policies/:id', deletePolicy);
router.patch('/refund-cancellation-policies/update-sequence', updateSequence);

// FAQ routes
router.get('/faqs', getAllFAQs);
router.get('/faqs/:id', getFAQ);
router.post('/faqs', createFAQ);
router.put('/faqs/:id', updateFAQ);
router.delete('/faqs/:id', deleteFAQ);
router.patch('/faqs/update-sequence', updateFAQSequence);

// Service Definitions & Visit Rules routes
router.get('/service-definitions-visit-rules', getAllRules);
router.get('/service-definitions-visit-rules/:id', getRule);
router.post('/service-definitions-visit-rules', createRule);
router.put('/service-definitions-visit-rules/:id', updateRule);
router.delete('/service-definitions-visit-rules/:id', deleteRule);
router.patch('/service-definitions-visit-rules/update-sequence', updateRulesSequence);

// Terms & Conditions routes
router.get('/terms-and-conditions', getAllTerms);
router.get('/terms-and-conditions/:id', getTerm);
router.post('/terms-and-conditions', createTerm);
router.put('/terms-and-conditions/:id', updateTerm);
router.delete('/terms-and-conditions/:id', deleteTerm);
router.patch('/terms-and-conditions/update-sequence', updateTermsSequence);

// Plan routes
router.get('/plans', getAllPlans);
router.get('/plans/:id', getPlan);
router.post('/plans', createPlan);
router.put('/plans/:id', updatePlan);
router.patch('/plans/:id/toggle-status', togglePlanStatus);
router.delete('/plans/:id', deletePlan);
router.get('/user-plans', getUserPlans);
router.get('/plan-transactions', getPlanTransactions);
router.get('/plan-transactions/:id', getPlanTransactionDetails);
router.post('/plan-transactions/:id/verify', verifyPlanPaymentStatus);

// Checkout Config routes
router.get('/checkout-config', getAllCheckoutFields);
router.get('/checkout-config/:id', getCheckoutField);
router.post('/checkout-config', createCheckoutField);
router.put('/checkout-config/:id', updateCheckoutField);
router.delete('/checkout-config/:id', deleteCheckoutField);
router.patch('/checkout-config/:id/toggle-status', toggleCheckoutFieldStatus);

// Global App Config
router.put('/config', updateAppConfig);

// Payment reconciliation routes
router.get('/payments/razorpay-order/:orderId', getRazorpayOrderDetails);
router.post('/payments/reconcile', reconcileExternalPayment);

// Company Settings routes
router.get('/company-settings', getCompanySettings);
router.put('/company-settings', updateCompanySettings);

// Customer App Settings routes
import { getCustomerAppSettings, updateCustomerAppSettings } from '../controllers/customerAppSettingsController';
router.get('/customer-app-settings', getCustomerAppSettings);
router.put('/customer-app-settings', updateCustomerAppSettings);

// Invoice routes
router.get('/invoices/booking/:id', generateInvoicePDF);
router.get('/invoices/plan-transaction/:id', generateInvoicePDF);
// Reviews routes
import { getAllReviews, publishReview } from '../controllers/reviewController';
router.get('/reviews', getAllReviews);
router.put('/reviews/:id/publish', publishReview);
export default router;

