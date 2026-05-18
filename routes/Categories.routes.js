const express = require('express');
const authMiddleware = require('../middlewares/authMiddleware');
const { requireRole } = require('../middlewares/roleHelpers');
const { getCategories, addCategory, deleteCategory, updateCategory } = require('../controllers/Categories.controller');
const router = express.Router();
const { getUploader } = require('../utils/uplode');
const uploader = getUploader('categoryImage');

const staffOnly = [authMiddleware, requireRole('main_admin', 'super_stockist')];

router.get('/get-categories', authMiddleware, getCategories);
router.post('/add-category', ...staffOnly, uploader, addCategory);
router.delete('/delete-category/:id', ...staffOnly, deleteCategory);
router.put('/update-category', ...staffOnly, uploader, updateCategory);

module.exports = router;
