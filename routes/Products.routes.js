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
const { requireRole } = require('../middlewares/roleHelpers');

const { getUploader } = require('../utils/uplode');
const uploder = getUploader('productImg');

const staffOnly = [authMiddleware, requireRole('main_admin', 'super_stockist')];
const userOnly = [authMiddleware, requireRole('user')];

router.get('/fetchProducts', authMiddleware, fetchProducts);
router.post('/saveCart', ...userOnly, saveCart);
router.get('/fetchCart', ...userOnly, fetchCart);
router.post('/placeOrder', ...userOnly, placeOrder);
router.get('/fetchOrders', ...userOnly, fetchOrders);

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
