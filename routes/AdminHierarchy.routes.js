const express = require('express');
const authMiddleware = require('../middlewares/authMiddleware');
const { requireRole } = require('../middlewares/roleHelpers');
const {
    listSuperStockists,
    createSuperStockist,
    updateSuperStockist,
    listDistributors,
    listAllDistributors,
    getNetworkInsights,
} = require('../controllers/AdminHierarchy.controller');

const router = express.Router();

const mainAdminOnly = [authMiddleware, requireRole('main_admin')];
const staffOnly = [authMiddleware, requireRole('main_admin', 'super_stockist')];

router.get('/super-stockists', ...mainAdminOnly, listSuperStockists);
router.post('/super-stockists', ...mainAdminOnly, createSuperStockist);
router.put('/super-stockists/:id', ...mainAdminOnly, updateSuperStockist);

router.get('/distributors', ...mainAdminOnly, listAllDistributors);
router.get('/distributors/by-stockist/:superStockistId', ...mainAdminOnly, listDistributors);
router.get('/my-distributors', ...staffOnly, listDistributors);
router.get('/network-insights', ...mainAdminOnly, getNetworkInsights);

module.exports = router;
