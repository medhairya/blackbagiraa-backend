const router = require('express').Router();
const {fetchProducts,saveCart, fetchCart, placeOrder, fetchOrders,adminFetchOrders,adminUpdateOrderStatus,adminUpdatePaymentStatus,adminFetchStatsData,adminFetchMonthlySalesData,adminFetchOrderStatusData,adminAddProduct,adminDeleteProduct,adminUpdateProduct} = require('../controllers/Products.controller');
const authMiddleware = require('../middlewares/authMiddleware');

const { getUploader } = require('../utils/uplode');
const uploder = getUploader('productImg');

router.get('/fetchProducts',authMiddleware,fetchProducts);
router.post('/saveCart',authMiddleware,saveCart);
router.get('/fetchCart',authMiddleware,fetchCart);
router.post('/placeOrder',authMiddleware,placeOrder);
router.get('/fetchOrders',authMiddleware,fetchOrders);
router.get('/admin/fetchOrders',authMiddleware,adminFetchOrders);
router.put('/admin/updateOrderStatus/:orderId',authMiddleware,adminUpdateOrderStatus);
router.put('/admin/updatePaymentStatus/:orderId',authMiddleware,adminUpdatePaymentStatus);
router.get('/admin/fetchStatsData',authMiddleware,adminFetchStatsData);
router.get('/admin/fetchMonthlySalesData',authMiddleware,adminFetchMonthlySalesData);
router.get('/admin/fetchOrderStatusData',authMiddleware,adminFetchOrderStatusData);
router.post('/admin/add-product',authMiddleware,uploder,adminAddProduct);
router.delete('/admin/delete-product/:productId',authMiddleware,adminDeleteProduct);
router.put('/admin/update-product',authMiddleware,uploder,adminUpdateProduct);
module.exports = router;
