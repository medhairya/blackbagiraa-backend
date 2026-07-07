const User = require('../models/User.model');
const bcrypt = require('bcryptjs');
const { createUser, resolveSuperStockist, normalizeStockistCode } = require('../services/User.service');
const Blacklist = require('../models/Blacklist.model');
const Admin = require('../models/Admin.model');
const { getStaffId } = require('../middlewares/roleHelpers');

module.exports.registerUser = async (req, res) => {
    try {
        const {
            customerName,
            shopName,
            addressLine1,
            city,
            state,
            pincode,
            contactNumber,
            password,
            superStockistCode,
        } = req.body;
        const user = await createUser({
            customerName,
            shopName,
            addressLine1,
            city,
            state,
            pincode,
            contactNumber,
            password,
            superStockistCode,
        });
        res.status(200).json({ success: true, message: 'User registered successfully', user });
    } catch (error) {
        if (error.message.includes('required') || error.message.includes('stockist')) {
            return res.status(400).json({ success: false, message: error.message });
        }
        if (error.message.includes('phone is invalid')) {
            return res.status(409).json({ success: false, message: 'Invalid User', error: error.message });
        }
        res.status(500).json({ success: false, message: 'User registration failed', error: error.message });
    }
};

module.exports.validateStockistCode = async (req, res) => {
    try {
        const { code } = req.query;
        if (!code) {
            return res.status(400).json({ success: false, message: 'Code is required' });
        }
        const superStockist = await resolveSuperStockist(code);
        res.status(200).json({
            success: true,
            name: superStockist.name,
            stockistCode: superStockist.stockistCode,
        });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

module.exports.loginUser = async (req, res) => {
    try {
        const { contactNumber, password, role } = req.body;

        // ── Try HierarchyMember first (new system) ──────────────────────────
        const HierarchyMember = require('../models/HierarchyMember.model');
        const hierarchyMember = await HierarchyMember.findOne({ contactNumber }).select('+password');

        if (hierarchyMember) {
            if (!hierarchyMember.isActive) {
                return res.status(403).json({ success: false, message: 'Account is deactivated' });
            }
            const isMatch = await hierarchyMember.comparePassword(password);
            if (!isMatch) {
                return res.status(400).json({ success: false, message: 'Invalid contact number or password' });
            }
            const token = hierarchyMember.generateToken();
            res.cookie('token', token, { httpOnly: true, maxAge: 12 * 60 * 60 * 1000 });
            return res.status(200).json({
                success: true,
                message: 'Login successful',
                token,
                role: hierarchyMember.roleName,
                level: hierarchyMember.level,
                member: {
                    _id: hierarchyMember._id,
                    name: hierarchyMember.name,
                    contactNumber: hierarchyMember.contactNumber,
                    level: hierarchyMember.level,
                    roleName: hierarchyMember.roleName,
                    shopName: hierarchyMember.shopName,
                    inviteCode: hierarchyMember.inviteCode,
                    isActive: hierarchyMember.isActive,
                },
            });
        }

        // ── Fallback: legacy Admin/User login ───────────────────────────────
        if (role !== 'admin' && role !== 'user') {
            return res.status(400).json({ success: false, message: 'Invalid role' });
        }

        if (role === 'admin') {
            const admin = await Admin.findOne({ contactNumber }).select('+password');

            if (!admin) {
                return res.status(400).json({ success: false, message: 'Invalid contact number or password' });
            }
            if (!admin.isActive) {
                return res.status(403).json({ success: false, message: 'Account is deactivated' });
            }
            const isMatch = await bcrypt.compare(password, admin.password);
            if (!isMatch) {
                return res.status(400).json({ success: false, message: 'Invalid contact number or password' });
            }
            const token = admin.generateToken();
            res.cookie('token', token, { httpOnly: true, maxAge: 12 * 60 * 60 * 1000 });

            // Map legacy role to level
            const level = admin.role === 'main_admin' ? 7 : 5;
            return res.status(200).json({
                success: true,
                message: 'Login successful',
                token,
                role: admin.role,
                level,
            });
        }

        if (role === 'user') {
            const user = await User.findOne({ contactNumber }).select('+password');
            if (!user) {
                return res.status(400).json({ success: false, message: 'Invalid contact number or password' });
            }
            const isMatch = await bcrypt.compare(password, user.password);
            if (!isMatch) {
                return res.status(400).json({ success: false, message: 'Invalid contact number or password' });
            }
            const token = user.generateAuthToken();
            res.cookie('token', token, { httpOnly: true, maxAge: 12 * 60 * 60 * 1000 });
            return res.status(200).json({
                success: true,
                message: 'Login successful',
                token,
                role: 'user',
                level: 1, // Retailers
            });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: 'Login failed', error: error.message });
    }
};

module.exports.logoutUser = async (req, res) => {
    const authHeader = req.headers.authorization;
    const token = req.cookies.token || (authHeader && authHeader.split(' ')[1]);
    try {
        if (token) {
            await Blacklist.create({ token, reason: 'User logged out' });
        }
        res.clearCookie('token');
        res.status(200).json({ success: true, message: 'Logout successful' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Logout failed', error: error.message });
    }
};

module.exports.authUser = async (req, res) => {
    try {
        const role = req.user?.role;

        if (role === 'main_admin' || role === 'super_stockist') {
            const staffId = getStaffId(req);
            const admin = await Admin.findById(staffId).select('-password');
            return res.status(200).json({
                success: true,
                message: 'Authentication successful',
                user: admin,
                role,
            });
        }

        const userData = await User.findById(req.user._id).populate('superStockistId', 'name stockistCode');
        res.status(200).json({
            success: true,
            message: 'Authentication successful',
            user: userData,
            role: 'user',
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Authentication failed', error: error.message });
    }
};

module.exports.updateProfile = async (req, res) => {
    try {
        const { customerName, shopName, addressLine1, city, state, pincode, contactNumber } = req.body;
        const updatedUser = await User.findByIdAndUpdate(
            req.user._id,
            { customerName, shopName, addressLine1, city, state, pincode, contactNumber },
            { new: true }
        );
        res.status(200).json({ success: true, message: 'Profile updated successfully', user: updatedUser });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Update profile failed', error: error.message });
    }
};
