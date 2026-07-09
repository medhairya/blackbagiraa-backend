const router = require('express').Router();
const {
    fetchProducts,
    saveCart,
    fetchCart,
    placeOrder,
    fetchOrders,
    adminFetchOrders,
    adminUpdateOrderStatus,
    adminUpdatePaymentStatus,
    adminFetchStatsData,
    adminFetchMonthlySalesData,
    adminFetchOrderStatusData,
    adminAddProduct,
    adminDeleteProduct,
    adminUpdateProduct,
} = require('../controllers/Products.controller');
const authMiddleware = require('../middlewares/authMiddleware');
const { requireRole, requireMaxLevel } = require('../middlewares/roleHelpers');

const { getUploader } = require('../utils/uplode');
const uploder = getUploader('productImg');

const staffOnly = [authMiddleware, requireRole('main_admin', 'super_stockist')];
// Ordering routes: all authenticated members can access (supervisors use onBehalfOf)
const orderingAccess = [authMiddleware];

router.get('/fetchProducts', authMiddleware, fetchProducts);
router.post('/saveCart', ...orderingAccess, saveCart);
router.get('/fetchCart', ...orderingAccess, fetchCart);
router.post('/placeOrder', ...orderingAccess, placeOrder);
router.get('/fetchOrders', ...orderingAccess, fetchOrders);

router.get('/admin/fetchOrders', ...staffOnly, adminFetchOrders);
router.put('/admin/updateOrderStatus/:orderId', ...staffOnly, adminUpdateOrderStatus);
router.put('/admin/updatePaymentStatus/:orderId', ...staffOnly, adminUpdatePaymentStatus);
router.get('/admin/fetchStatsData', ...staffOnly, adminFetchStatsData);
router.get('/admin/fetchMonthlySalesData', ...staffOnly, adminFetchMonthlySalesData);
router.get('/admin/fetchOrderStatusData', ...staffOnly, adminFetchOrderStatusData);
router.post('/admin/add-product', ...staffOnly, uploder, adminAddProduct);
router.delete('/admin/delete-product/:productId', ...staffOnly, adminDeleteProduct);
router.put('/admin/update-product', ...staffOnly, uploder, adminUpdateProduct);

module.exports = router;
