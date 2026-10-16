const express = require('express');
const authMiddleware = require('../middlewares/authMiddleware');
const { requireRoleOrLevel } = require('../middlewares/roleHelpers');
const { getCategories, addCategory, deleteCategory, updateCategory } = require('../controllers/Categories.controller');
const router = express.Router();
const { getUploader } = require('../utils/uplode');
const uploader = getUploader('categoryImage');

// Catalog management: legacy staff roles or Directors (level 7)
const catalogManagers = [authMiddleware, requireRoleOrLevel(['main_admin', 'super_stockist'], 7)];

router.get('/get-categories', authMiddleware, getCategories);
router.post('/add-category', ...catalogManagers, uploader, addCategory);
router.delete('/delete-category/:id', ...catalogManagers, deleteCategory);
router.put('/update-category', ...catalogManagers, uploader, updateCategory);

module.exports = router;
