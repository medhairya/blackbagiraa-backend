const express = require('express');
const { registerUser, loginUser, logoutUser, authUser,updateProfile } = require('../controllers/User.controller');
const { body, validationResult } = require('express-validator');
const authMiddleware = require('../middlewares/authMiddleware');
const router = express.Router();

router.post('/register', 
    [
        body('customerName').notEmpty().withMessage('Customer name is required'),
        body('shopName').notEmpty().withMessage('Shop name is required'),
        body('addressLine1').notEmpty().withMessage('Address line 1 is required'),
        body('city').notEmpty().withMessage('City is required'),
        body('state').notEmpty().withMessage('State is required'),
        body('pincode').notEmpty().isNumeric().withMessage('Pincode is required and must be numeric'),
        body('contactNumber').notEmpty().isNumeric().withMessage('Contact number is required and must be numeric'),
        body('password').notEmpty().withMessage('Password is required')
    ], 
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ message: errors.array() });
        }
        next();
    },
    // PINCODE validation middleware
    (req, res, next) => {
        const { pincode } = req.body;

        if (!pincode.startsWith('390') && !pincode.startsWith('391')) {
            return res.status(400).json({ 
                success: false, 
                message: 'Sorry! Our online service is not yet available in your area. We’re expanding soon — stay tuned for updates!' 
            });
        }

        next();
    },

    registerUser
);

router.post('/login', 
    [
        body('contactNumber').notEmpty().isNumeric().withMessage('Contact number is required and must be numeric'),
        body('password').notEmpty().withMessage('Password is required')
    ], 
    (req, res, next) => {
        const errors = validationResult(req);
        //check here role for user
        if (!errors.isEmpty()) {
            return res.status(400).json({ message: errors.array() });
        }
        next();
    },
    loginUser
);
router.post('/logout',authMiddleware,logoutUser);   
router.get('/auth/user',authMiddleware,authUser);
router.put('/update-profile',authMiddleware,updateProfile);

module.exports = router;
