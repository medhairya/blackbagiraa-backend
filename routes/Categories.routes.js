const express = require('express');
const authMiddleware = require('../middlewares/authMiddleware');
const { getCategories,addCategory,deleteCategory,updateCategory } = require('../controllers/Categories.controller');
const router = express.Router();
const { getUploader } = require('../utils/uplode');
const uploader = getUploader('categoryImage')
//for this category first check the docs how to do that you add one json file from utils in fronted folder
router.get('/get-categories',authMiddleware,getCategories);
router.post('/add-category',authMiddleware,uploader,addCategory);
router.delete('/delete-category/:id',authMiddleware,deleteCategory);
router.put('/update-category',authMiddleware,uploader,updateCategory);

module.exports = router;
