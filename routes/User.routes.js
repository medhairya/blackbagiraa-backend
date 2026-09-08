const express = require('express');
const {
    registerUser,
    loginUser,
    logoutUser,
    authUser,
    updateProfile,
    validateStockistCode,
} = require('../controllers/User.controller');
const { body, validationResult } = require('express-validator');
const authMiddleware = require('../middlewares/authMiddleware');
const { requireRole } = require('../middlewares/roleHelpers');
const router = express.Router();

// ── DISABLED: Public registration routes ──────────────────────────────────────
// Public registration has been disabled for security. All member creation
// now goes through the admin-controlled hierarchy endpoints (L6+ only).
router.get('/validate-stockist-code', (req, res) => {
    res.status(403).json({
        success: false,
        message: 'Public registration has been disabled. Contact your Director or Manager to create an account.',
    });
});

router.post('/register', (req, res) => {
    res.status(403).json({
        success: false,
        message: 'Public registration has been disabled. Contact your Director or Manager to create an account.',
    });
});

router.post(
    '/login',
    [
        body('contactNumber').notEmpty().isNumeric().withMessage('Contact number is required and must be numeric'),
        body('password').notEmpty().withMessage('Password is required'),
    ],
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ message: errors.array() });
        }
        next();
    },
    loginUser
);

router.post('/logout', authMiddleware, logoutUser);
router.get('/auth/user', authMiddleware, authUser);
router.put('/update-profile', authMiddleware, requireRole('user'), updateProfile);

module.exports = router;
