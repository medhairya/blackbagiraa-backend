const router = require('express').Router();
const {
    fetchProducts,
    saveCart,
    fetchCart,
    placeOrder,
    fetchOrders,
    updateOrderStatus,
    updatePaymentStatus,
    adminFetchOrders,
    adminUpdateOrderStatus,
    adminUpdatePaymentStatus,
    adminFetchStatsData,
    adminFetchMonthlySalesData,
    adminFetchOrderStatusData,
    adminAddProduct,
    adminDeleteProduct,
    adminUpdateProduct,
    productImage,
} = require('../controllers/Products.controller');
const authMiddleware = require('../middlewares/authMiddleware');
const { requireRole, requireMaxLevel, requireRoleOrLevel } = require('../middlewares/roleHelpers');

const { getUploader } = require('../utils/uplode');
const uploder = getUploader('productImg');

const staffOnly = [authMiddleware, requireRole('main_admin', 'super_stockist')];
// Catalog management: legacy staff roles or Directors (level 7)
const catalogManagers = [authMiddleware, requireRoleOrLevel(['main_admin', 'super_stockist'], 7)];
// Ordering routes: all authenticated members can access (supervisors use onBehalfOf)
const orderingAccess = [authMiddleware];

// Public: one product photo as an image file (cached on phones; see productImage)
router.get('/image/:productId', productImage);
router.get('/fetchProducts', authMiddleware, fetchProducts);
router.post('/saveCart', ...orderingAccess, saveCart);
router.get('/fetchCart', ...orderingAccess, fetchCart);
router.post('/placeOrder', ...orderingAccess, placeOrder);
router.get('/fetchOrders', ...orderingAccess, fetchOrders);
router.put('/updateOrderStatus/:orderId', authMiddleware, updateOrderStatus);
router.put('/updatePaymentStatus/:orderId', authMiddleware, updatePaymentStatus);

router.get('/admin/fetchOrders', ...staffOnly, adminFetchOrders);
router.put('/admin/updateOrderStatus/:orderId', ...staffOnly, adminUpdateOrderStatus);
router.put('/admin/updatePaymentStatus/:orderId', ...staffOnly, adminUpdatePaymentStatus);
router.get('/admin/fetchStatsData', ...staffOnly, adminFetchStatsData);
router.get('/admin/fetchMonthlySalesData', ...staffOnly, adminFetchMonthlySalesData);
router.get('/admin/fetchOrderStatusData', ...staffOnly, adminFetchOrderStatusData);
router.post('/admin/add-product', ...catalogManagers, uploder, adminAddProduct);
router.delete('/admin/delete-product/:productId', ...catalogManagers, adminDeleteProduct);
router.put('/admin/update-product', ...catalogManagers, uploder, adminUpdateProduct);

module.exports = router;
