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

// ─── Level→RoleName mapping ────────────────────────────────────────────────────
const LEVEL_TO_ROLE = {
    7: 'director',
    6: 'manager',
    5: 'distributor_ss',
    4: 'sub_ss',
    3: 'distributor',
    2: 'wholesaler',
    1: 'retailer',
};

// ─── Member Registration & Management ─────────────────────────────────────────

/**
 * Director (7) directly creates a Manager (6) or SS/Distributor (5).
 * Auth required — only level 7 can call this.
 */
module.exports.addMemberByDirector = async (req, res) => {
    try {
        const callerLevel = req.user.level ?? 0;
        if (callerLevel < 7) {
            return res.status(403).json({ success: false, message: 'Only Directors can add members directly.' });
        }

        const { name, contactNumber, password, targetLevel, shopName, address } = req.body;
        if (!name || !contactNumber || !password || !targetLevel) {
            return res.status(400).json({ success: false, message: 'name, contactNumber, password, and targetLevel are required.' });
        }
        if (![5, 6].includes(Number(targetLevel))) {
            return res.status(400).json({ success: false, message: 'Directors can only add level 5 (SS/Distributor) or level 6 (Manager).' });
        }

        const existing = await HierarchyMember.findOne({ contactNumber });
        if (existing) {
            return res.status(409).json({ success: false, message: 'A member with this contact number already exists.' });
        }

        const directorId = req.user.id || req.user._id;
        const director = await HierarchyMember.findById(directorId);
        const parentAncestors = director ? [...(director.ancestorIds ?? []), director._id] : [];

        const member = new HierarchyMember({
            name: name.trim(),
            contactNumber: contactNumber.trim(),
            password, // will be hashed by pre-save hook
            level: Number(targetLevel),
            roleName: LEVEL_TO_ROLE[Number(targetLevel)],
            parentId: directorId,
            ancestorIds: parentAncestors,
            shopName: shopName?.trim() || '',
            address: address || {},
            isActive: true,
        });

        await member.save();

        res.status(201).json({
            success: true,
            message: `${LEVEL_TO_ROLE[Number(targetLevel)]} added successfully.`,
            member: {
                _id: member._id,
                name: member.name,
                contactNumber: member.contactNumber,
                level: member.level,
                roleName: member.roleName,
                inviteCode: member.inviteCode,
            },
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * Public — no auth needed. Look up parent info from an invite code.
 * Returns the parent's name, level, and what level the new registrant will be.
 */
module.exports.lookupInvite = async (req, res) => {
    try {
        const { code } = req.query;
        if (!code) {
            return res.status(400).json({ success: false, message: 'Invite code is required.' });
        }

        const parent = await HierarchyMember.findOne({ inviteCode: code.toUpperCase().trim() }).lean();
        if (!parent) {
            return res.status(404).json({ success: false, message: 'Invalid invite code. Please check and try again.' });
        }
        if (!parent.isActive) {
            return res.status(403).json({ success: false, message: 'This invite code belongs to a deactivated account.' });
        }

        const newLevel = parent.level - 1;
        if (newLevel < 1) {
            return res.status(400).json({ success: false, message: 'This member cannot invite new members below their level.' });
        }

        res.json({
            success: true,
            parentName: parent.name,
            parentLevel: parent.level,
            parentRoleName: parent.roleName,
            newMemberLevel: newLevel,
            newMemberRoleName: LEVEL_TO_ROLE[newLevel],
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * Public — no auth needed. Register a new HierarchyMember using an invite code.
 * Level is automatically set to parent_level - 1.
 * Level-1 members do NOT receive an inviteCode.
 */
module.exports.registerWithInvite = async (req, res) => {
    try {
        const { name, contactNumber, password, inviteCode, shopName, address } = req.body;
        if (!name || !contactNumber || !password || !inviteCode) {
            return res.status(400).json({ success: false, message: 'name, contactNumber, password, and inviteCode are required.' });
        }

        const parent = await HierarchyMember.findOne({ inviteCode: inviteCode.toUpperCase().trim() });
        if (!parent) {
            return res.status(404).json({ success: false, message: 'Invalid invite code. Please check and try again.' });
        }
        if (!parent.isActive) {
            return res.status(403).json({ success: false, message: 'This invite code belongs to a deactivated account.' });
        }

        const newLevel = parent.level - 1;
        if (newLevel < 1) {
            return res.status(400).json({ success: false, message: 'Cannot register below level 1.' });
        }

        const existing = await HierarchyMember.findOne({ contactNumber: contactNumber.trim() });
        if (existing) {
            return res.status(409).json({ success: false, message: 'An account with this contact number already exists.' });
        }

        const ancestorIds = [...(parent.ancestorIds ?? []), parent._id];

        const member = new HierarchyMember({
            name: name.trim(),
            contactNumber: contactNumber.trim(),
            password,
            level: newLevel,
            roleName: LEVEL_TO_ROLE[newLevel],
            parentId: parent._id,
            ancestorIds,
            shopName: shopName?.trim() || '',
            address: address || {},
            isActive: true,
            // inviteCode is auto-generated by pre-save hook for level >= 2
            // For level 1, no inviteCode will be set
        });

        await member.save();

        res.status(201).json({
            success: true,
            message: 'Account created successfully! You can now log in.',
            level: newLevel,
            roleName: LEVEL_TO_ROLE[newLevel],
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * Change the level of a direct subordinate. Available to levels 3–6.
 * A caller at level N can set a subordinate's level to any value from 1 to N-1.
 */
module.exports.changeMemberLevel = async (req, res) => {
    try {
        const callerLevel = req.user.level ?? 1;
        const callerId = req.user.id || req.user._id;

        if (callerLevel < 3 || callerLevel > 6) {
            return res.status(403).json({ success: false, message: 'Level change is only available to members at levels 3–6.' });
        }

        const { memberId } = req.params;
        const { newLevel } = req.body;

        if (!newLevel || Number(newLevel) < 1 || Number(newLevel) >= callerLevel) {
            return res.status(400).json({
                success: false,
                message: `New level must be between 1 and ${callerLevel - 1}.`,
            });
        }

        // Target must be a descendant in the caller's subtree
        const target = await HierarchyMember.findById(memberId);
        if (!target) {
            return res.status(404).json({ success: false, message: 'Member not found.' });
        }

        const isSubordinate = target.ancestorIds?.some((id) => id.toString() === callerId.toString());
        if (!isSubordinate && target.parentId?.toString() !== callerId.toString()) {
            return res.status(403).json({ success: false, message: 'You can only change the level of your direct subordinates.' });
        }

        const targetLevel = Number(newLevel);
        target.level = targetLevel;
        target.roleName = LEVEL_TO_ROLE[targetLevel];

        // For level 1 — remove invite code (leaf node)
        if (targetLevel === 1) {
            target.inviteCode = undefined;
        }

        await target.save();

        res.json({
            success: true,
            message: `${target.name}'s level changed to ${LEVEL_TO_ROLE[targetLevel]} (Level ${targetLevel}).`,
            member: { _id: target._id, level: target.level, roleName: target.roleName, inviteCode: target.inviteCode },
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

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

module.exports.updateTarget = async (req, res) => {
    try {
        const callerId = req.user.id || req.user._id;
        const callerLevel = req.user.level ?? 1;
        const { targetId } = req.params;
        const { targetValue } = req.body;

        if (targetValue === undefined || targetValue < 0) {
            return res.status(400).json({ success: false, message: 'Valid targetValue is required.' });
        }

        const target = await Target.findById(targetId);
        if (!target) {
            return res.status(404).json({ success: false, message: 'Target not found.' });
        }

        // Only allow the person who assigned it or a Director to edit it
        if (target.assignedBy.toString() !== callerId.toString() && callerLevel < 7) {
            return res.status(403).json({ success: false, message: 'You do not have permission to edit this target.' });
        }

        target.targetValue = targetValue;
        await target.save();

        res.json({ success: true, message: 'Target updated successfully', target });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports.deleteTarget = async (req, res) => {
    try {
        const callerId = req.user.id || req.user._id;
        const callerLevel = req.user.level ?? 1;
        const { targetId } = req.params;

        const target = await Target.findById(targetId);
        if (!target) {
            return res.status(404).json({ success: false, message: 'Target not found.' });
        }

        // Only allow the person who assigned it or a Director to delete it
        if (target.assignedBy.toString() !== callerId.toString() && callerLevel < 7) {
            return res.status(403).json({ success: false, message: 'You do not have permission to delete this target.' });
        }

        await Target.findByIdAndDelete(targetId);
        res.json({ success: true, message: 'Target deleted successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─── Pricing ───────────────────────────────────────────────────────────────────

module.exports.searchMembers = async (req, res) => {
    try {
        const { q } = req.query;
        const callerId = req.user.id || req.user._id;
        const callerLevel = req.user.level ?? 1;

        if (callerLevel < 6) {
            return res.status(403).json({ success: false, message: 'Unauthorized' });
        }

        if (!q) {
            return res.json({ success: true, members: [] });
        }

        const regex = new RegExp(q, 'i');
        const filter = {
            $or: [
                { name: regex },
                { contactNumber: regex },
                { inviteCode: regex }
            ]
        };

        // If caller is Manager (6), restrict to direct/indirect subordinates in their subtree
        if (callerLevel === 6) {
            filter.ancestorIds = callerId;
        } else {
            // Directors (7) can search any level below them (1-6)
            filter.level = { $ne: 7 };
        }

        const members = await HierarchyMember.find(filter)
            .select('name contactNumber level roleName inviteCode shopName ancestorIds')
            .limit(20)
            .lean();

        res.json({ success: true, members });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports.getPricing = async (req, res) => {
    try {
        const [products, pricing] = await Promise.all([
            Product.find().sort({ name: 1 }).lean(),
            ProductPricing.find().populate('memberId', 'name contactNumber level roleName inviteCode shopName').lean(),
        ]);

        res.json({ success: true, products, pricing });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/** Director directly sets a price for a product for a specific member */
module.exports.setPrice = async (req, res) => {
    try {
        const memberLevel = req.user.level ?? 1;
        if (memberLevel < 7) {
            return res.status(403).json({ success: false, message: 'Only Directors can set prices directly.' });
        }

        const { productId, memberId, retailPrice } = req.body;
        if (!productId || !memberId || retailPrice === undefined) {
            return res.status(400).json({ success: false, message: 'productId, memberId, and retailPrice are required.' });
        }
        if (retailPrice < 0) {
            return res.status(400).json({ success: false, message: 'Price cannot be negative.' });
        }

        const directorId = req.user.id || req.user._id;
        const result = await ProductPricing.findOneAndUpdate(
            { productId, memberId },
            { retailPrice, setBy: directorId },
            { upsert: true, new: true }
        );

        res.json({ success: true, message: `Price updated successfully.`, pricing: result });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/** Manager submits a price change request to the Director for a specific member */
module.exports.createPriceRequest = async (req, res) => {
    try {
        const memberLevel = req.user.level ?? 1;
        if (memberLevel < 6) {
            return res.status(403).json({ success: false, message: 'Only Managers can submit price change requests.' });
        }

        const { productId, targetMemberId, requestedPrice, reason } = req.body;
        if (!productId || !targetMemberId || requestedPrice === undefined) {
            return res.status(400).json({ success: false, message: 'productId, targetMemberId, and requestedPrice are required.' });
        }

        const existing = await ProductPricing.findOne({ productId, memberId: targetMemberId }).lean();
        const currentPrice = existing?.retailPrice ?? 0;
        const requestedBy = req.user.id || req.user._id;

        const priceRequest = await PriceChangeRequest.create({
            requestedBy,
            productId,
            currentPrice,
            requestedPrice,
            targetMemberId,
            reason: reason || '',
            status: 'pending',
        });

        res.status(201).json({ success: true, message: 'Price change request submitted.', request: priceRequest });
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
            filter = {};
        } else {
            filter = { requestedBy: memberId };
        }

        const requests = await PriceChangeRequest.find(filter)
            .populate('requestedBy', 'name')
            .populate('targetMemberId', 'name level roleName inviteCode')
            .populate('productId', 'name')
            .sort({ createdAt: -1 })
            .lean();

        const enriched = requests.map((r) => ({
            ...r,
            requestedByName: r.requestedBy?.name ?? 'Unknown',
            targetMemberName: r.targetMemberId?.name ?? 'Unknown',
            targetMemberLevel: r.targetMemberId?.level,
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
                { productId: request.productId, memberId: request.targetMemberId },
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
        const { name, shopName, password, inviteCode } = req.body;

        const member = await HierarchyMember.findById(memberId);
        if (!member) {
            return res.status(404).json({ success: false, message: 'Member not found' });
        }

        if (name) member.name = name;
        if (shopName) member.shopName = shopName;

        // Allow levels 2 to 6 to update inviteCode
        if (inviteCode && member.level >= 2 && member.level <= 6) {
            const cleanCode = inviteCode.trim().toUpperCase();
            if (cleanCode !== member.inviteCode) {
                const exists = await HierarchyMember.exists({ inviteCode: cleanCode, _id: { $ne: memberId } });
                if (exists) {
                    return res.status(400).json({ success: false, message: 'This invite code is already taken. Please choose another one.' });
                }
                member.inviteCode = cleanCode;
            }
        }

        // Update password if provided
        if (password) {
            const bcrypt = require('bcryptjs');
            member.password = await bcrypt.hash(password, 10);
        }

        await member.save();

        const updatedMember = await HierarchyMember.findById(memberId).select('-password').lean();
        res.json({ success: true, message: 'Profile updated successfully', member: updatedMember });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
