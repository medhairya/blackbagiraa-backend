const express = require('express');
const authMiddleware = require('../middlewares/authMiddleware');
const {
    getDashboardStats,
    getMyTeam,
    getMemberDetail,
    getTeamOrders,
    getTargets,
    createTarget,
    getPricing,
    setPrice,
    createPriceRequest,
    getPriceRequests,
    updatePriceRequest,
    getCustomers,
    createCustomer,
    getCustomerDetail,
    getReports,
    updateProfile,
} = require('../controllers/Hierarchy.controller');

const router = express.Router();

// All routes require authentication
router.use(authMiddleware);

// Dashboard
router.get('/dashboard-stats', getDashboardStats);

// Team management
router.get('/my-team', getMyTeam);
router.get('/members/:memberId', getMemberDetail);

// Orders (scoped by hierarchy)
router.get('/team-orders', getTeamOrders);

// Target management
router.get('/targets', getTargets);
router.post('/targets', createTarget);

// Pricing (Directors + Managers)
router.get('/pricing', getPricing);
router.post('/pricing', setPrice);                              // Director: set price directly
router.post('/pricing/requests', createPriceRequest);          // Manager: submit price request
router.get('/pricing/requests', getPriceRequests);
router.put('/pricing/requests/:requestId', updatePriceRequest);

// Customer management
router.get('/customers', getCustomers);
router.post('/customers', createCustomer);
router.get('/customers/:customerId', getCustomerDetail);

// Reports
router.get('/reports', getReports);

// Profile
router.put('/profile', updateProfile);

module.exports = router;
