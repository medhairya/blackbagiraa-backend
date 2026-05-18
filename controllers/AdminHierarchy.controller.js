const mongoose = require('mongoose');
const Admin = require('../models/Admin.model');
const User = require('../models/User.model');
const CartOrder = require('../models/Orders.model');
const { normalizeStockistCode } = require('../services/User.service');
const { getStaffId } = require('../middlewares/roleHelpers');

function getOrderItems(order) {
    if (!order.items) return [];
    if (order.items instanceof Map) {
        return [...order.items.values()];
    }
    return Object.values(order.items);
}

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

module.exports.getNetworkInsights = async (req, res) => {
    try {
        const superStockists = await Admin.find({ role: 'super_stockist' })
            .select('-password')
            .sort({ name: 1 });

        const distributorCounts = await User.aggregate([
            { $group: { _id: '$superStockistId', count: { $sum: 1 } } },
        ]);
        const countByStockist = new Map(
            distributorCounts.map((d) => [d._id?.toString(), d.count])
        );

        const orders = await CartOrder.find()
            .populate('userId', 'shopName customerName contactNumber')
            .lean();

        const insightsMap = new Map();

        for (const stockist of superStockists) {
            const id = stockist._id.toString();
            insightsMap.set(id, {
                _id: stockist._id,
                name: stockist.name,
                stockistCode: stockist.stockistCode,
                distributorCount: countByStockist.get(id) || 0,
                totalOrders: 0,
                totalSales: 0,
                totalUnits: 0,
                distributors: new Map(),
                products: new Map(),
            });
        }

        for (const order of orders) {
            const stockistId = order.superStockistId?.toString();
            if (!stockistId || !insightsMap.has(stockistId)) continue;

            const insight = insightsMap.get(stockistId);
            const isCancelled = order.status === 'cancelled';

            insight.totalOrders += 1;
            if (!isCancelled) {
                insight.totalSales += order.totalAmount || 0;
            }

            const user = order.userId;
            const userId = user?._id?.toString();
            if (userId) {
                if (!insight.distributors.has(userId)) {
                    insight.distributors.set(userId, {
                        _id: user._id,
                        shopName: user.shopName || 'Unknown',
                        customerName: user.customerName || '',
                        contactNumber: user.contactNumber || '',
                        orderCount: 0,
                        totalSales: 0,
                        totalUnits: 0,
                    });
                }
                const dist = insight.distributors.get(userId);
                dist.orderCount += 1;
                if (!isCancelled) {
                    dist.totalSales += order.totalAmount || 0;
                }
            }

            if (isCancelled) continue;

            for (const item of getOrderItems(order)) {
                const qty = item.quantity || 0;
                const revenue = (item.retailPrice || 0) * qty;
                insight.totalUnits += qty;
                if (userId) {
                    insight.distributors.get(userId).totalUnits += qty;
                }

                const name = item.name;
                if (!name) continue;

                if (!insight.products.has(name)) {
                    insight.products.set(name, {
                        name,
                        category: item.category || 'Other',
                        quantity: 0,
                        revenue: 0,
                    });
                }
                const product = insight.products.get(name);
                product.quantity += qty;
                product.revenue += revenue;
            }
        }

        const superStockistInsights = [...insightsMap.values()].map((insight) => {
            const distributors = [...insight.distributors.values()].sort(
                (a, b) => b.totalSales - a.totalSales
            );
            const productsArr = [...insight.products.values()].sort(
                (a, b) => b.quantity - a.quantity
            );
            const topProducts = productsArr.slice(0, 10);
            const lowProducts = productsArr
                .filter((p) => p.quantity > 0)
                .slice(-10)
                .reverse();

            const categoryMap = new Map();
            for (const p of productsArr) {
                if (!categoryMap.has(p.category)) {
                    categoryMap.set(p.category, {
                        category: p.category,
                        quantity: 0,
                        revenue: 0,
                    });
                }
                const cat = categoryMap.get(p.category);
                cat.quantity += p.quantity;
                cat.revenue += p.revenue;
            }

            return {
                _id: insight._id,
                name: insight.name,
                stockistCode: insight.stockistCode,
                distributorCount: insight.distributorCount,
                totalOrders: insight.totalOrders,
                totalSales: insight.totalSales,
                totalUnits: insight.totalUnits,
                distributors,
                topProducts,
                lowProducts,
                categoryBreakdown: [...categoryMap.values()].sort(
                    (a, b) => b.quantity - a.quantity
                ),
            };
        });

        res.status(200).json({
            success: true,
            insights: { superStockists: superStockistInsights },
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
