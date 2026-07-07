const mongoose = require('mongoose');
const HierarchyMember = require('../models/HierarchyMember.model');
const Target = require('../models/Target.model');
const Customer = require('../models/Customer.model');
const Visit = require('../models/Visit.model');
const ProductPricing = require('../models/ProductPricing.model');
const PriceChangeRequest = require('../models/PriceChangeRequest.model');
const CartOrder = require('../models/Orders.model');
const Product = require('../models/Products.model');

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Get all descendant IDs of a member (everyone who has this member in their ancestorIds).
 * For Directors/Managers: returns ALL members.
 * For others: returns only those in their subtree.
 */
async function getDescendantIds(memberId, memberLevel) {
    if (memberLevel >= 6) {
        // Directors and Managers see everyone
        const all = await HierarchyMember.find({}, '_id').lean();
        return all.map((m) => m._id);
    }
    const descendants = await HierarchyMember.find(
        { ancestorIds: memberId },
        '_id'
    ).lean();
    return descendants.map((d) => d._id);
}

/**
 * Get period boundaries for target queries.
 */
function getPeriodBounds(duration) {
    const now = new Date();
    let start, end;

    switch (duration) {
        case 'daily':
            start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            end = new Date(start);
            end.setDate(end.getDate() + 1);
            break;
        case 'weekly': {
            const day = now.getDay();
            start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day);
            end = new Date(start);
            end.setDate(end.getDate() + 7);
            break;
        }
        case 'monthly':
        default:
            start = new Date(now.getFullYear(), now.getMonth(), 1);
            end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
            break;
    }
    return { start, end };
}

// ─── Dashboard Stats ───────────────────────────────────────────────────────────

module.exports.getDashboardStats = async (req, res) => {
    try {
        const memberId = req.user.id || req.user._id;
        const memberLevel = req.user.level ?? 1;
        const descendantIds = await getDescendantIds(memberId, memberLevel);

        const [teamSize, totalOrders, revenueAgg, pendingOrders, activeTargets] = await Promise.all([
            HierarchyMember.countDocuments({ parentId: memberId }),
            CartOrder.countDocuments({ userId: { $in: descendantIds } }),
            CartOrder.aggregate([
                { $match: { userId: { $in: descendantIds }, status: { $ne: 'cancelled' } } },
                { $group: { _id: null, total: { $sum: '$totalAmount' } } },
            ]),
            CartOrder.countDocuments({ userId: { $in: descendantIds }, status: 'pending' }),
            Target.countDocuments({ assignedTo: { $in: [memberId, ...descendantIds] } }),
        ]);

        // Target achievement for this member
        const { start, end } = getPeriodBounds('monthly');
        const myTargets = await Target.find({
            assignedTo: memberId,
            periodStart: { $gte: start },
            periodEnd: { $lte: end },
        }).lean();

        let targetAchievement = 0;
        if (myTargets.length > 0) {
            const totalPct = myTargets.reduce((sum, t) => {
                return sum + (t.targetValue > 0 ? (t.achieved / t.targetValue) * 100 : 0);
            }, 0);
            targetAchievement = Math.round(totalPct / myTargets.length);
        }

        res.json({
            success: true,
            stats: {
                teamSize,
                totalOrders,
                totalRevenue: revenueAgg[0]?.total ?? 0,
                pendingOrders,
                activeTargets,
                targetAchievement,
            },
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─── Team Management ───────────────────────────────────────────────────────────

module.exports.getMyTeam = async (req, res) => {
    try {
        const memberId = req.user.id || req.user._id;
        const members = await HierarchyMember.find({ parentId: memberId })
            .select('-password')
            .sort({ level: -1, name: 1 })
            .lean();

        // Enrich with child counts and order stats
        const enriched = await Promise.all(
            members.map(async (m) => {
                const [childCount, orderStats] = await Promise.all([
                    HierarchyMember.countDocuments({ parentId: m._id }),
                    CartOrder.aggregate([
                        {
                            $match: {
                                $or: [
                                    { userId: m._id },
                                    { userId: { $in: await getDescendantIds(m._id, m.level).then(ids => ids) } },
                                ],
                                status: { $ne: 'cancelled' },
                            },
                        },
                        { $group: { _id: null, totalOrders: { $sum: 1 }, totalRevenue: { $sum: '$totalAmount' } } },
                    ]),
                ]);

                return {
                    ...m,
                    childCount,
                    totalOrders: orderStats[0]?.totalOrders ?? 0,
                    totalRevenue: orderStats[0]?.totalRevenue ?? 0,
                };
            })
        );

        res.json({ success: true, members: enriched });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports.getMemberDetail = async (req, res) => {
    try {
        const { memberId } = req.params;
        const requesterId = req.user.id || req.user._id;
        const requesterLevel = req.user.level ?? 1;

        const member = await HierarchyMember.findById(memberId).select('-password').lean();
        if (!member) {
            return res.status(404).json({ success: false, message: 'Member not found' });
        }

        // Scope check: requester must be an ancestor or director/manager
        if (requesterLevel < 6 && !member.ancestorIds?.map(String).includes(String(requesterId))) {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }

        const [subTeam, targets, orderStats] = await Promise.all([
            HierarchyMember.find({ parentId: memberId }).select('-password').lean(),
            Target.find({ assignedTo: memberId }).sort({ createdAt: -1 }).limit(10).lean(),
            CartOrder.aggregate([
                { $match: { userId: new mongoose.Types.ObjectId(memberId), status: { $ne: 'cancelled' } } },
                { $group: { _id: null, totalOrders: { $sum: 1 }, totalRevenue: { $sum: '$totalAmount' } } },
            ]),
        ]);

        res.json({
            success: true,
            member,
            subTeam,
            targets,
            orderStats: orderStats[0] ?? { totalOrders: 0, totalRevenue: 0 },
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─── Team Orders (scoped) ──────────────────────────────────────────────────────

module.exports.getTeamOrders = async (req, res) => {
    try {
        const memberId = req.user.id || req.user._id;
        const memberLevel = req.user.level ?? 1;
        const { status } = req.query;

        const descendantIds = await getDescendantIds(memberId, memberLevel);
        const allIds = [new mongoose.Types.ObjectId(memberId), ...descendantIds];

        const filter = { userId: { $in: allIds } };
        if (status) filter.status = status;

        const orders = await CartOrder.find(filter)
            .sort({ createdAt: -1 })
            .limit(100)
            .populate('userId', 'name shopName')
            .lean();

        // Transform for frontend
        const transformed = orders.map((order) => {
            const items = order.items instanceof Map
                ? [...order.items.values()]
                : Object.values(order.items || {});

            return {
                _id: order._id,
                orderId: order._id.toString().slice(-8).toUpperCase(),
                items,
                totalAmount: order.totalAmount,
                orderStatus: order.status,
                paymentStatus: order.paymentStatus,
                paymentMethod: order.paymentMethod,
                createdAt: order.createdAt,
                placedByName: order.userId?.name ?? order.shippingAddress?.customerName ?? 'Unknown',
            };
        });

        res.json({ success: true, orders: transformed });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─── Targets ───────────────────────────────────────────────────────────────────

module.exports.getTargets = async (req, res) => {
    try {
        const memberId = req.user.id || req.user._id;
        const memberLevel = req.user.level ?? 1;
        const { duration = 'monthly' } = req.query;

        const descendantIds = await getDescendantIds(memberId, memberLevel);
        const allIds = [new mongoose.Types.ObjectId(memberId), ...descendantIds];

        const targets = await Target.find({
            assignedTo: { $in: allIds },
            duration,
        })
            .populate('assignedTo', 'name level')
            .populate('assignedBy', 'name')
            .sort({ createdAt: -1 })
            .lean();

        const enriched = targets.map((t) => ({
            ...t,
            assignedToName: t.assignedTo?.name ?? 'Unknown',
            assignedByName: t.assignedBy?.name ?? 'Unknown',
        }));

        res.json({ success: true, targets: enriched });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports.createTarget = async (req, res) => {
    try {
        const assignedBy = req.user.id || req.user._id;
        const { assignedTo, targetType, duration, targetValue } = req.body;

        if (!assignedTo || !targetType || !duration || !targetValue) {
            return res.status(400).json({ success: false, message: 'All fields are required' });
        }

        const { start, end } = getPeriodBounds(duration);

        const target = new Target({
            assignedTo,
            assignedBy,
            targetType,
            duration,
            targetValue,
            periodStart: start,
            periodEnd: end,
        });

        await target.save();
        res.status(201).json({ success: true, message: 'Target assigned', target });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─── Pricing ───────────────────────────────────────────────────────────────────

module.exports.getPricing = async (req, res) => {
    try {
        const [products, pricing] = await Promise.all([
            Product.find().sort({ name: 1 }).lean(),
            ProductPricing.find().lean(),
        ]);

        res.json({ success: true, products, pricing });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports.getPriceRequests = async (req, res) => {
    try {
        const memberId = req.user.id || req.user._id;
        const memberLevel = req.user.level ?? 1;

        let filter = {};
        if (memberLevel >= 7) {
            // Directors see all pending requests
            filter = {};
        } else {
            // Others see only their own
            filter = { requestedBy: memberId };
        }

        const requests = await PriceChangeRequest.find(filter)
            .populate('requestedBy', 'name')
            .populate('productId', 'name')
            .sort({ createdAt: -1 })
            .lean();

        const enriched = requests.map((r) => ({
            ...r,
            requestedByName: r.requestedBy?.name ?? 'Unknown',
            productName: r.productId?.name ?? 'Unknown',
        }));

        res.json({ success: true, requests: enriched });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports.updatePriceRequest = async (req, res) => {
    try {
        const memberLevel = req.user.level ?? 1;
        if (memberLevel < 7) {
            return res.status(403).json({ success: false, message: 'Only directors can approve/reject' });
        }

        const { requestId } = req.params;
        const { status } = req.body;

        if (!['approved', 'rejected'].includes(status)) {
            return res.status(400).json({ success: false, message: 'Invalid status' });
        }

        const request = await PriceChangeRequest.findById(requestId);
        if (!request) {
            return res.status(404).json({ success: false, message: 'Request not found' });
        }

        request.status = status;
        request.reviewedBy = req.user.id || req.user._id;
        request.reviewedAt = new Date();
        await request.save();

        // If approved, update the actual pricing
        if (status === 'approved') {
            await ProductPricing.findOneAndUpdate(
                { productId: request.productId, level: request.targetLevel },
                {
                    retailPrice: request.requestedPrice,
                    setBy: req.user.id || req.user._id,
                },
                { upsert: true }
            );
        }

        res.json({ success: true, message: `Request ${status}` });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─── Customer Management ───────────────────────────────────────────────────────

module.exports.getCustomers = async (req, res) => {
    try {
        const memberId = req.user.id || req.user._id;
        const memberLevel = req.user.level ?? 1;

        let filter = {};
        if (memberLevel < 6) {
            // Non-directors/managers see only customers registered by themselves or descendants
            const descendantIds = await getDescendantIds(memberId, memberLevel);
            filter = { registeredBy: { $in: [new mongoose.Types.ObjectId(memberId), ...descendantIds] } };
        }

        const customers = await Customer.find(filter)
            .populate('registeredBy', 'name')
            .sort({ createdAt: -1 })
            .lean();

        const enriched = customers.map((c) => ({
            ...c,
            registeredByName: c.registeredBy?.name ?? 'Unknown',
        }));

        res.json({ success: true, customers: enriched });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports.createCustomer = async (req, res) => {
    try {
        const registeredBy = req.user.id || req.user._id;
        const { name, gstNumber, mobileNumber, address } = req.body;

        if (!name || !mobileNumber || !address?.line1 || !address?.city || !address?.state || !address?.pincode) {
            return res.status(400).json({ success: false, message: 'Name, mobile, and full address are required' });
        }

        const customer = new Customer({
            name,
            gstNumber,
            mobileNumber,
            address,
            registeredBy,
        });

        await customer.save();
        res.status(201).json({ success: true, message: 'Customer registered', customer });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports.getCustomerDetail = async (req, res) => {
    try {
        const { customerId } = req.params;
        const customer = await Customer.findById(customerId)
            .populate('registeredBy', 'name')
            .lean();

        if (!customer) {
            return res.status(404).json({ success: false, message: 'Customer not found' });
        }

        const visits = await Visit.find({ customerId })
            .sort({ visitDate: -1 })
            .lean();

        res.json({
            success: true,
            customer: { ...customer, registeredByName: customer.registeredBy?.name ?? 'Unknown' },
            visits,
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─── Reports ───────────────────────────────────────────────────────────────────

module.exports.getReports = async (req, res) => {
    try {
        const memberId = req.user.id || req.user._id;
        const memberLevel = req.user.level ?? 1;
        const { period = 'monthly' } = req.query;

        const descendantIds = await getDescendantIds(memberId, memberLevel);
        const allIds = [new mongoose.Types.ObjectId(memberId), ...descendantIds];

        const now = new Date();
        let dateFormat, periodStart, previousStart;

        switch (period) {
            case 'daily':
                periodStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
                previousStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 14);
                dateFormat = '%Y-%m-%d';
                break;
            case 'weekly':
                periodStart = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
                previousStart = new Date(now.getFullYear(), now.getMonth() - 2, now.getDate());
                dateFormat = '%Y-W%V';
                break;
            case 'quarterly':
                periodStart = new Date(now.getFullYear() - 1, 0, 1);
                previousStart = new Date(now.getFullYear() - 2, 0, 1);
                dateFormat = '%Y-Q';
                break;
            case 'monthly':
            default:
                periodStart = new Date(now.getFullYear(), now.getMonth() - 6, 1);
                previousStart = new Date(now.getFullYear(), now.getMonth() - 12, 1);
                dateFormat = '%Y-%m';
                break;
        }

        const [entries, previousRevenue] = await Promise.all([
            CartOrder.aggregate([
                {
                    $match: {
                        userId: { $in: allIds },
                        status: { $ne: 'cancelled' },
                        createdAt: { $gte: periodStart },
                    },
                },
                {
                    $group: {
                        _id: { $dateToString: { format: dateFormat, date: '$createdAt' } },
                        revenue: { $sum: '$totalAmount' },
                        orderCount: { $sum: 1 },
                    },
                },
                { $sort: { _id: 1 } },
            ]),
            CartOrder.aggregate([
                {
                    $match: {
                        userId: { $in: allIds },
                        status: { $ne: 'cancelled' },
                        createdAt: { $gte: previousStart, $lt: periodStart },
                    },
                },
                { $group: { _id: null, total: { $sum: '$totalAmount' } } },
            ]),
        ]);

        const report = {
            period,
            entries: entries.map((e) => ({
                period: e._id,
                revenue: e.revenue,
                orderCount: e.orderCount,
                unitsSold: 0, // Could be computed from items if needed
            })),
            totalRevenue: entries.reduce((sum, e) => sum + e.revenue, 0),
            totalOrders: entries.reduce((sum, e) => sum + e.orderCount, 0),
            totalUnits: 0,
            previousPeriodRevenue: previousRevenue[0]?.total ?? 0,
        };

        res.json({ success: true, report });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─── Profile ───────────────────────────────────────────────────────────────────

module.exports.updateProfile = async (req, res) => {
    try {
        const memberId = req.user.id || req.user._id;
        const { name, shopName, contactNumber } = req.body;

        const member = await HierarchyMember.findById(memberId);
        if (!member) {
            return res.status(404).json({ success: false, message: 'Member not found' });
        }

        if (name) member.name = name;
        if (shopName) member.shopName = shopName;
        await member.save();

        const updatedMember = await HierarchyMember.findById(memberId).select('-password').lean();
        res.json({ success: true, message: 'Profile updated', member: updatedMember });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
