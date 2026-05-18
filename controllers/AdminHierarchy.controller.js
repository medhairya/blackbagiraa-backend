const mongoose = require('mongoose');
const Admin = require('../models/Admin.model');
const User = require('../models/User.model');
const { normalizeStockistCode } = require('../services/User.service');
const { getStaffId } = require('../middlewares/roleHelpers');

module.exports.listSuperStockists = async (req, res) => {
    try {
        const superStockists = await Admin.find({ role: 'super_stockist' }).select('-password').sort({ createdAt: -1 });

        const withCounts = await Promise.all(
            superStockists.map(async (stockist) => {
                const distributorCount = await User.countDocuments({ superStockistId: stockist._id });
                return {
                    ...stockist.toObject(),
                    distributorCount,
                };
            })
        );

        res.status(200).json({ success: true, superStockists: withCounts });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports.createSuperStockist = async (req, res) => {
    try {
        const { name, contactNumber, password, stockistCode } = req.body;

        if (!name || !contactNumber || !password || !stockistCode) {
            return res.status(400).json({ success: false, message: 'All fields are required' });
        }

        const code = normalizeStockistCode(stockistCode);
        const existingCode = await Admin.findOne({ stockistCode: code });
        if (existingCode) {
            return res.status(409).json({ success: false, message: 'Stockist code already exists' });
        }

        const existingContact = await Admin.findOne({ contactNumber });
        if (existingContact) {
            return res.status(409).json({ success: false, message: 'Contact number already in use' });
        }

        const superStockist = new Admin({
            name,
            contactNumber,
            password,
            stockistCode: code,
            role: 'super_stockist',
            isActive: true,
        });

        await superStockist.save();

        res.status(201).json({
            success: true,
            message: 'Super stockist created',
            superStockist: {
                _id: superStockist._id,
                name: superStockist.name,
                contactNumber: superStockist.contactNumber,
                stockistCode: superStockist.stockistCode,
                isActive: superStockist.isActive,
            },
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports.updateSuperStockist = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, stockistCode, isActive, password } = req.body;

        const superStockist = await Admin.findOne({ _id: id, role: 'super_stockist' });
        if (!superStockist) {
            return res.status(404).json({ success: false, message: 'Super stockist not found' });
        }

        if (name) superStockist.name = name;
        if (typeof isActive === 'boolean') superStockist.isActive = isActive;

        if (stockistCode) {
            const code = normalizeStockistCode(stockistCode);
            const duplicate = await Admin.findOne({
                stockistCode: code,
                _id: { $ne: superStockist._id },
            });
            if (duplicate) {
                return res.status(409).json({ success: false, message: 'Stockist code already exists' });
            }
            superStockist.stockistCode = code;
        }

        if (password) {
            superStockist.password = password;
        }

        await superStockist.save();

        res.status(200).json({
            success: true,
            message: 'Super stockist updated',
            superStockist: {
                _id: superStockist._id,
                name: superStockist.name,
                contactNumber: superStockist.contactNumber,
                stockistCode: superStockist.stockistCode,
                isActive: superStockist.isActive,
            },
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports.listDistributors = async (req, res) => {
    try {
        const { superStockistId } = req.params;
        const role = req.user.role;

        let filter = {};

        if (role === 'super_stockist') {
            filter.superStockistId = getStaffId(req);
        } else if (superStockistId) {
            if (!mongoose.Types.ObjectId.isValid(superStockistId)) {
                return res.status(400).json({ success: false, message: 'Invalid super stockist id' });
            }
            filter.superStockistId = superStockistId;
        }

        const distributors = await User.find(filter)
            .select('-password')
            .populate('superStockistId', 'name stockistCode')
            .sort({ _id: -1 });

        res.status(200).json({ success: true, distributors });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports.listAllDistributors = async (req, res) => {
    try {
        const distributors = await User.find()
            .select('-password')
            .populate('superStockistId', 'name stockistCode')
            .sort({ _id: -1 });

        res.status(200).json({ success: true, distributors });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
