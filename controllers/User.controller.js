const User = require('../models/User.model');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { createUser } = require('../services/User.service');
const Blacklist = require('../models/Blacklist.model'); // Import the Blacklist model
const Admin = require('../models/Admin.model');

module.exports.registerUser = async (req, res) => {
    try {
        const { customerName, shopName, addressLine1, city, state, pincode, contactNumber, password } = req.body;
        const user = await createUser({ customerName, shopName, addressLine1, city, state, pincode, contactNumber, password });
        res.status(200).json({ success: true, message: 'User registered successfully', user });
    } catch (error) {
        // Send error with appropriate status code based on the error type
        if (error.message.includes('required')) {
            return res.status(400).json({ success: false, message: 'Validation error', error: error.message });
        } else if (error.message.includes('phone is invalid')) {
            return res.status(409).json({ success: false, message: 'Invalid User', error: error.message });
        }
        res.status(500).json({ success: false, message: 'User registration failed', error: error.message });
    }
};

module.exports.loginUser = async (req, res) => {
    try {
        const { contactNumber, password, role } = req.body;
        if(role !== 'admin' && role !== 'user'){
            return res.status(400).json({ success: false, message: 'Invalid role' });
        }

        if (role === 'admin') {
            const admin = await Admin.findOne({ contactNumber }).select('+password');

            if (!admin) {
                return res.status(400).json({ success: false, message: 'Invalid contact number or password' });
            }
            const isMatch = await bcrypt.compare(password, admin.password);
            if (!isMatch) {
                return res.status(400).json({ success: false, message: 'Invalid contact number or password' });
            }
            const token = admin.generateToken();
            res.cookie('token', token, { httpOnly: true, maxAge: 12 * 60 * 60 * 1000 });
            return res.status(200).json({
                success: true, message: 'Login successful', token: token,role:role
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
                success: true, message: 'Login successful', token: token,role:role
            });
        }


    } catch (error) {
        res.status(500).json({ success: false, message: 'Login failed', error: error.message });
    }
}

module.exports.logoutUser = async (req, res, next) => {
    const token = req.cookies.token || req.headers.authorization.split(' ')[1];  // Get the token from the cookie
    try {

        if (token) {
            // Add the token to the blacklist
            await Blacklist.create({ token, reason: 'User logged out' });
        }
        res.clearCookie('token');
        res.status(200).json({ success: true, message: 'Logout successful' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Logout failed', error: error.message });
    }
}

module.exports.authUser = async (req, res) => {
    try {
        const user = req.user;
        const userData = await User.findById(user._id);
        res.status(200).json({ success: true, message: 'Authentication successful', user: userData });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Authentication failed', error: error.message });
    }
}

module.exports.updateProfile = async (req, res) => {
    try {
        const { customerName, shopName, addressLine1, city, state, pincode, contactNumber } = req.body;
        const user = req.user;
        const updatedUser = await User.findByIdAndUpdate(user._id, { customerName, shopName, addressLine1, city, state, pincode, contactNumber }, { new: true });
        res.status(200).json({ success: true, message: 'Profile updated successfully', user: updatedUser });

    } catch (error) {
        res.status(500).json({ success: false, message: 'Update profile failed', error: error.message });
    }
}
