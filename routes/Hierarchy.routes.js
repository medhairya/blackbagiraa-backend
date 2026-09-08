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
    adminAddMember,
    adminLookupInvite,
    changePassword,
    lookupInvite,
    registerWithInvite,
    changeMemberLevel,
    updateTarget,
    deleteTarget,
    searchMembers,
    getPricingAuditLogs,
    getAuditLogs,
} = require('../controllers/Hierarchy.controller');

const router = express.Router();

// ── DISABLED public routes — return 403 with message ──────────────────────────
router.get('/lookup-invite', lookupInvite);          // Disabled — returns 403
router.post('/register', registerWithInvite);        // Disabled — returns 403

// All routes below require authentication
router.use(authMiddleware);

// Dashboard
router.get('/dashboard-stats', getDashboardStats);

// Team management
router.get('/my-team', getMyTeam);
router.get('/members/search', searchMembers);
router.get('/members/:memberId', getMemberDetail);
router.post('/admin-add-member', adminAddMember);                   // L6+: add any subordinate with full details
router.get('/admin-lookup-invite', adminLookupInvite);              // L6+: lookup invite code for parent placement
router.patch('/members/:memberId/level', changeMemberLevel);        // Change subordinate level (levels 3+)
router.patch('/members/:memberId/password', changePassword);        // L6+: change subordinate password

// Legacy route alias — kept for backward compat during transition
router.post('/members', adminAddMember);

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

// Audit Logs (Directors only — full system history)
router.get('/audit-logs', getAuditLogs);

// Customer management
router.get('/customers', getCustomers);
router.post('/customers', createCustomer);
router.get('/customers/:customerId', getCustomerDetail);

// Reports
router.get('/reports', getReports);

// Profile
router.put('/profile', updateProfile);

module.exports = router;

