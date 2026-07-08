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
    addMemberByDirector,
    lookupInvite,
    registerWithInvite,
    changeMemberLevel,
    updateTarget,
    deleteTarget,
    searchMembers,
    getPricingAuditLogs,
} = require('../controllers/Hierarchy.controller');

const router = express.Router();

// ── Public routes (no auth required) ──────────────────────────────────────────
router.get('/lookup-invite', lookupInvite);          // Preview invite code info
router.post('/register', registerWithInvite);        // Self-registration with invite code

// All routes below require authentication
router.use(authMiddleware);

// Dashboard
router.get('/dashboard-stats', getDashboardStats);

// Team management
router.get('/my-team', getMyTeam);
router.get('/members/search', searchMembers);
router.get('/members/:memberId', getMemberDetail);
router.post('/members', addMemberByDirector);                   // Director: add Manager or SS
router.patch('/members/:memberId/level', changeMemberLevel);    // Change subordinate level (levels 3-6)

// Orders (scoped by hierarchy)
router.get('/team-orders', getTeamOrders);

// Target management
router.get('/targets', getTargets);
router.post('/targets', createTarget);
router.put('/targets/:targetId', updateTarget);
router.delete('/targets/:targetId', deleteTarget);

// Pricing (Directors + Managers)
router.get('/pricing', getPricing);
router.post('/pricing', setPrice);                              // Director: set price directly
router.post('/pricing/requests', createPriceRequest);          // Manager: submit price request
router.get('/pricing/requests', getPriceRequests);
router.put('/pricing/requests/:requestId', updatePriceRequest);
router.get('/pricing/audit-logs', getPricingAuditLogs);

// Customer management
router.get('/customers', getCustomers);
router.post('/customers', createCustomer);
router.get('/customers/:customerId', getCustomerDetail);

// Reports
router.get('/reports', getReports);

// Profile
router.put('/profile', updateProfile);

module.exports = router;
