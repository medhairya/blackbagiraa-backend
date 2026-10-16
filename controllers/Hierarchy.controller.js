const mongoose = require('mongoose');
const HierarchyMember = require('../models/HierarchyMember.model');
const Target = require('../models/Target.model');
const Customer = require('../models/Customer.model');
const Visit = require('../models/Visit.model');
const ProductPricing = require('../models/ProductPricing.model');
const PriceChangeRequest = require('../models/PriceChangeRequest.model');
const CartOrder = require('../models/Orders.model');
const Product = require('../models/Products.model');
const AuditLog = require('../models/AuditLog.model');
const { getIo } = require('../socket');

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Get all descendant IDs of a member (everyone who has this member in their ancestorIds).
 * For Directors (L7): returns ALL members.
 * For Managers (L6) and below: returns only those in their subtree.
 */
async function getDescendantIds(memberId, memberLevel) {
    if (memberLevel >= 7) {
        // Only Directors see everyone
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

/**
 * The member plus everyone below them, at any depth. Unlike getDescendantIds,
 * this never widens to "everyone" for Directors — it is strictly the subtree.
 */
async function getSubtreeIds(memberId) {
    const id = new mongoose.Types.ObjectId(memberId);
    const descendants = await HierarchyMember.find({ ancestorIds: id }, '_id').lean();
    return [id, ...descendants.map((d) => d._id)];
}

/** Non-cancelled order count and revenue for a member and their whole sub-team. */
async function getSubtreeOrderStats(memberId) {
    const ids = await getSubtreeIds(memberId);
    const agg = await CartOrder.aggregate([
        { $match: { userId: { $in: ids }, status: { $ne: 'cancelled' } } },
        { $group: { _id: null, totalOrders: { $sum: 1 }, totalRevenue: { $sum: '$totalAmount' } } },
    ]);
    return { totalOrders: agg[0]?.totalOrders ?? 0, totalRevenue: agg[0]?.totalRevenue ?? 0 };
}

/**
 * Recompute `achieved` for revenue/orders targets from delivered orders placed in the
 * target's period by the assignee or anyone below them. This credits every level up to
 * the Director, includes orders delivered before the target was created, and stays
 * correct when an order's status changes back and forth. Changed values are written back.
 * Visits targets keep their stored value (no visit tracking yet).
 * Mutates and returns the given (lean) targets.
 */
async function computeTargetAchievement(targets) {
    const subtreeCache = new Map();
    const writes = [];

    for (const t of targets) {
        if (t.targetType !== 'revenue' && t.targetType !== 'orders') continue;

        const assigneeId = String(t.assignedTo?._id ?? t.assignedTo);
        if (!subtreeCache.has(assigneeId)) {
            subtreeCache.set(assigneeId, await getSubtreeIds(assigneeId));
        }

        const agg = await CartOrder.aggregate([
            {
                $match: {
                    userId: { $in: subtreeCache.get(assigneeId) },
                    status: 'delivered',
                    createdAt: { $gte: t.periodStart, $lt: t.periodEnd },
                },
            },
            { $group: { _id: null, revenue: { $sum: '$totalAmount' }, count: { $sum: 1 } } },
        ]);

        const achieved = t.targetType === 'revenue' ? (agg[0]?.revenue ?? 0) : (agg[0]?.count ?? 0);
        if (achieved !== t.achieved) {
            writes.push({ updateOne: { filter: { _id: t._id }, update: { $set: { achieved } } } });
        }
        t.achieved = achieved;
    }

    if (writes.length > 0) await Target.bulkWrite(writes);
    return targets;
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

// ─── Audit Log Helper ──────────────────────────────────────────────────────────

/**
 * Silently write an audit log entry. Failures are caught and ignored so that
 * they never break the main request flow.
 *
 * @param {Request}  req          - Express request (used to read req.user and IP)
 * @param {string}   action       - One of the AuditLog.action enum values
 * @param {ObjectId|null} targetId - The affected member's _id (or null)
 * @param {string|null}  targetName - The affected member's name snapshot
 * @param {object}   details      - Free-form change details (old/new values, etc.)
 */
async function logAction(req, action, targetId, targetName, details = {}) {
    try {
        const performedBy = req.user.id || req.user._id;
        await AuditLog.create({
            action,
            performedBy,
            performedByName: req.user.name || null,
            performedByLevel: req.user.level || null,
            performedByRole: req.user.roleName || LEVEL_TO_ROLE[req.user.level] || null,
            targetMember: targetId || null,
            targetMemberName: targetName || null,
            details,
            ipAddress: req.ip || req.headers['x-forwarded-for'] || null,
        });
    } catch (_) {
        // Audit log failures must never crash the main endpoint
    }
}

// ─── Member Registration & Management ─────────────────────────────────────────

/**
 * Admin-controlled member creation — Directors (L7) and Managers (L6) only.
 * Directors can add levels 1–6, Managers can add levels 1–5.
 * Optionally accepts `parentInviteCode` to place the new member under a specific
 * parent in the hierarchy; if omitted, the member is placed under the caller.
 */
module.exports.adminAddMember = async (req, res) => {
    try {
        const callerLevel = req.user.level ?? 0;
        const callerId = req.user.id || req.user._id;

        if (callerLevel < 6) {
            return res.status(403).json({ success: false, message: 'Only Directors and Managers can add members.' });
        }

        const {
            name, contactNumber, password, targetLevel,
            shopName, gstNumber, email, address,
            parentInviteCode,
        } = req.body;

        // ── Required field validation ──────────────────────────────────────
        if (!name || !contactNumber || !password || !targetLevel) {
            return res.status(400).json({ success: false, message: 'name, contactNumber, password, and targetLevel are required.' });
        }
        if (String(password).length < 6) {
            return res.status(400).json({ success: false, message: 'Password must be at least 6 characters.' });
        }

        const level = Number(targetLevel);
        const maxLevel = callerLevel - 1; // Directors(7) → max 6, Managers(6) → max 5

        if (level < 1 || level > maxLevel) {
            return res.status(400).json({
                success: false,
                message: `You can add members at levels 1–${maxLevel}.`,
            });
        }

        // ── Duplicate check ─────────────────────────────────────────────────
        const existing = await HierarchyMember.findOne({ contactNumber: contactNumber.trim() });
        if (existing) {
            return res.status(409).json({ success: false, message: 'A member with this contact number already exists.' });
        }

        // ── Determine parent ────────────────────────────────────────────────
        let parentMember;

        if (parentInviteCode && parentInviteCode.trim()) {
            // Look up the specified parent by invite code
            parentMember = await HierarchyMember.findOne({
                inviteCode: parentInviteCode.trim().toUpperCase(),
            });
            if (!parentMember) {
                return res.status(404).json({ success: false, message: 'Invalid parent invite code. No member found with that code.' });
            }
            if (!parentMember.isActive) {
                return res.status(403).json({ success: false, message: 'The specified parent account is deactivated.' });
            }

            // Directors (L7) can place members anywhere in the database.
            // Managers (L6) can only place members within their own subtree.
            if (callerLevel < 7) {
                const parentId = parentMember._id.toString();
                if (parentId !== callerId.toString()) {
                    const isInSubtree = parentMember.ancestorIds?.some(
                        (id) => id.toString() === callerId.toString()
                    );
                    if (!isInSubtree) {
                        return res.status(403).json({
                            success: false,
                            message: 'The specified parent is not in your hierarchy. You can only add members under yourself or your subordinates.',
                        });
                    }
                }
            }

            // Validate new member level is below the parent
            if (level >= parentMember.level) {
                return res.status(400).json({
                    success: false,
                    message: `New member level (${level}) must be below the parent's level (${parentMember.level}).`,
                });
            }
        } else {
            // Default: place under the caller
            parentMember = await HierarchyMember.findById(callerId);
            if (!parentMember) {
                return res.status(500).json({ success: false, message: 'Could not find your own member record.' });
            }
        }

        // ── Build ancestor path ─────────────────────────────────────────────
        const ancestorIds = [...(parentMember.ancestorIds ?? []), parentMember._id];

        // ── Create member ───────────────────────────────────────────────────
        const member = new HierarchyMember({
            name: name.trim(),
            contactNumber: contactNumber.trim(),
            password, // stored in plain text (no hashing)
            level,
            roleName: LEVEL_TO_ROLE[level],
            parentId: parentMember._id,
            ancestorIds,
            shopName: shopName?.trim() || '',
            gstNumber: gstNumber?.trim() || '',
            email: email?.trim() || '',
            address: address ? {
                line1: address.line1?.trim() || '',
                city: address.city?.trim() || '',
                state: address.state?.trim() || '',
                pincode: address.pincode?.trim() || '',
            } : {},
            isActive: true,
        });

        await member.save();

        // ── Audit log ───────────────────────────────────────────────────────
        logAction(req, 'add_member', member._id, member.name, {
            newMemberName: member.name,
            newMemberContact: member.contactNumber,
            newMemberLevel: member.level,
            newMemberRole: member.roleName,
            newMemberInviteCode: member.inviteCode || null,
            placedUnder: parentMember.name,
            placedUnderId: parentMember._id,
        });

        res.status(201).json({
            success: true,
            message: `${LEVEL_TO_ROLE[level]} "${name.trim()}" added successfully under ${parentMember.name}.`,
            member: {
                _id: member._id,
                name: member.name,
                contactNumber: member.contactNumber,
                level: member.level,
                roleName: member.roleName,
                inviteCode: member.inviteCode,
                parentName: parentMember.name,
            },
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * Authenticated invite code lookup — L6+ only.
 * Returns the parent member's name, level, role so the admin can verify
 * before placing a new member under them.
 */
module.exports.adminLookupInvite = async (req, res) => {
    try {
        const callerLevel = req.user.level ?? 0;
        if (callerLevel < 6) {
            return res.status(403).json({ success: false, message: 'Only Directors and Managers can look up invite codes.' });
        }

        const { code } = req.query;
        if (!code) {
            return res.status(400).json({ success: false, message: 'Invite code is required.' });
        }

        const parent = await HierarchyMember.findOne({
            inviteCode: code.toUpperCase().trim(),
        }).lean();

        if (!parent) {
            return res.status(404).json({ success: false, message: 'Invalid invite code. No member found.' });
        }
        if (!parent.isActive) {
            return res.status(403).json({ success: false, message: 'This invite code belongs to a deactivated account.' });
        }

        // Directors (L7) can look up any invite code in the database.
        // Managers (L6) can only look up codes belonging to themselves or their subtree.
        const callerId = (req.user.id || req.user._id).toString();
        if (callerLevel < 7) {
            const parentId = parent._id.toString();
            if (parentId !== callerId) {
                const isInSubtree = parent.ancestorIds?.some(
                    (id) => id.toString() === callerId
                );
                if (!isInSubtree) {
                    return res.status(403).json({
                        success: false,
                        message: 'This member is not in your hierarchy.',
                    });
                }
            }
        }

        res.json({
            success: true,
            parentId: parent._id,
            parentName: parent.name,
            parentLevel: parent.level,
            parentRoleName: parent.roleName,
            parentShopName: parent.shopName || '',
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * Change a subordinate's password. Directors (L7) can change any member's
 * password. Managers (L6) can change passwords of their subordinates (L1–L5).
 * Passwords are stored in plain text so admins can retrieve and share them.
 */
module.exports.changePassword = async (req, res) => {
    try {
        const callerLevel = req.user.level ?? 0;
        const callerId = (req.user.id || req.user._id).toString();

        if (callerLevel < 6) {
            return res.status(403).json({ success: false, message: 'Only Directors and Managers can change passwords.' });
        }

        const { memberId } = req.params;
        const { newPassword } = req.body;

        if (!newPassword || String(newPassword).length < 6) {
            return res.status(400).json({ success: false, message: 'New password must be at least 6 characters.' });
        }

        const target = await HierarchyMember.findById(memberId);
        if (!target) {
            return res.status(404).json({ success: false, message: 'Member not found.' });
        }

        // Directors can change anyone's password; Managers only their subordinates
        if (callerLevel === 6) {
            const isSubordinate = target.ancestorIds?.some(
                (id) => id.toString() === callerId
            );
            if (!isSubordinate && target.parentId?.toString() !== callerId) {
                return res.status(403).json({ success: false, message: 'You can only change passwords for your subordinates.' });
            }
            if (target.level >= callerLevel) {
                return res.status(403).json({ success: false, message: 'You cannot change the password of a member at your level or above.' });
            }
        }

        // Store password in plain text (no hashing)
        target.password = newPassword;
        await target.save();

        // ── Audit log ───────────────────────────────────────────────────────
        logAction(req, 'change_password', target._id, target.name, {
            memberName: target.name,
            memberLevel: target.level,
            memberRole: target.roleName,
        });

        res.json({
            success: true,
            message: `Password for ${target.name} has been updated successfully.`,
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─── DISABLED: Public registration routes ──────────────────────────────────────
// These endpoints have been disabled for security. All member creation now
// goes through adminAddMember (authenticated, L6+ only).

module.exports.lookupInvite = async (req, res) => {
    return res.status(403).json({
        success: false,
        message: 'Public registration has been disabled. Contact your Director or Manager to create an account.',
    });
};

module.exports.registerWithInvite = async (req, res) => {
    return res.status(403).json({
        success: false,
        message: 'Public registration has been disabled. Contact your Director or Manager to create an account.',
    });
};

/**
 * Change the level of a subordinate. Available to levels 3–7.
 * A caller at level N can set a subordinate's level to any value from 1 to N-1.
 */
module.exports.changeMemberLevel = async (req, res) => {
    try {
        const callerLevel = req.user.level ?? 1;
        const callerId = req.user.id || req.user._id;

        if (callerLevel < 3) {
            return res.status(403).json({ success: false, message: 'Level change is only available to members at level 3 and above.' });
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
            return res.status(403).json({ success: false, message: 'You can only change the level of your subordinates.' });
        }

        const oldLevel = target.level;
        const targetLevel = Number(newLevel);
        target.level = targetLevel;
        target.roleName = LEVEL_TO_ROLE[targetLevel];
        // Invite code is kept as-is on level changes — codes are permanent.

        await target.save();

        // ── Audit log ───────────────────────────────────────────────────────
        logAction(req, 'change_level', target._id, target.name, {
            memberName: target.name,
            oldLevel,
            oldRole: LEVEL_TO_ROLE[oldLevel],
            newLevel: targetLevel,
            newRole: LEVEL_TO_ROLE[targetLevel],
        });

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
        // Same set as Team Orders and Reports: the member's own orders + everyone below.
        // (A Director's descendant list already contains every member, themselves included.)
        const scopeIds = memberLevel >= 7
            ? descendantIds
            : [new mongoose.Types.ObjectId(memberId), ...descendantIds];

        const now = new Date();
        const activePeriod = { periodStart: { $lte: now }, periodEnd: { $gt: now } };

        const [teamSize, totalOrders, revenueAgg, pendingOrders, activeTargets, myTargets] = await Promise.all([
            HierarchyMember.countDocuments({ parentId: memberId }),
            CartOrder.countDocuments({ userId: { $in: scopeIds } }),
            CartOrder.aggregate([
                { $match: { userId: { $in: scopeIds }, status: { $ne: 'cancelled' } } },
                { $group: { _id: null, total: { $sum: '$totalAmount' } } },
            ]),
            CartOrder.countDocuments({ userId: { $in: scopeIds }, status: 'pending' }),
            // Only targets whose period is running right now
            Target.countDocuments({ assignedTo: { $in: scopeIds }, ...activePeriod }),
            Target.find({ assignedTo: memberId, ...activePeriod }).lean(),
        ]);

        // Average progress of my currently running targets, each capped at 100%
        await computeTargetAchievement(myTargets);
        let targetAchievement = 0;
        if (myTargets.length > 0) {
            const totalPct = myTargets.reduce((sum, t) => {
                const pct = t.targetValue > 0 ? (t.achieved / t.targetValue) * 100 : 0;
                return sum + Math.min(pct, 100);
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

        // Enrich with child counts and order stats (member + their whole sub-team)
        const enriched = await Promise.all(
            members.map(async (m) => {
                const [childCount, orderStats] = await Promise.all([
                    HierarchyMember.countDocuments({ parentId: m._id }),
                    getSubtreeOrderStats(m._id),
                ]);
                return { ...m, childCount, ...orderStats };
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

        // Scope check: Directors (L7) see anyone; others can only view themselves or their descendants
        if (requesterLevel < 7 && String(member._id) !== String(requesterId) && !member.ancestorIds?.map(String).includes(String(requesterId))) {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }

        const [subTeamMembers, targets, orderStats] = await Promise.all([
            HierarchyMember.find({ parentId: memberId }).select('-password').lean(),
            Target.find({ assignedTo: memberId }).sort({ createdAt: -1 }).limit(10).lean(),
            // Member's own orders + everyone below them
            getSubtreeOrderStats(memberId),
        ]);

        // Each direct report's totals also include their own sub-team
        const [subTeam] = await Promise.all([
            Promise.all(
                subTeamMembers.map(async (s) => {
                    const [childCount, stats] = await Promise.all([
                        HierarchyMember.countDocuments({ parentId: s._id }),
                        getSubtreeOrderStats(s._id),
                    ]);
                    return { ...s, childCount, ...stats };
                })
            ),
            computeTargetAchievement(targets),
        ]);

        res.json({
            success: true,
            member,
            subTeam,
            targets,
            orderStats,
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
        const { status, search } = req.query;

        const descendantIds = await getDescendantIds(memberId, memberLevel);
        const allIds = [new mongoose.Types.ObjectId(memberId), ...descendantIds];

        const filter = { userId: { $in: allIds } };
        if (status) filter.status = status;

        // Increase limit when search query is active to ensure we match relevant records
        const limitValue = search ? 500 : 100;

        const orders = await CartOrder.find(filter)
            .sort({ createdAt: -1 })
            .limit(limitValue)
            .populate('userId', 'name shopName contactNumber gstNumber')
            .lean();

        // Transform for frontend and apply search filter
        let transformed = orders.map((order) => {
            const items = order.items instanceof Map
                ? [...order.items.values()]
                : Object.values(order.items || {});

            const customerName = order.userId?.name ?? order.shippingAddress?.customerName ?? 'Unknown';
            const shopName = order.userId?.shopName ?? order.shippingAddress?.shopName ?? 'Unknown';
            const contactNumber = order.userId?.contactNumber ?? '';
            const gstNumber = order.userId?.gstNumber ?? '';
            const orderId = order._id.toString().slice(-8).toUpperCase();

            return {
                _id: order._id,
                buyerId: order.userId?._id?.toString() || order.userId?.toString() || '',
                orderId,
                items,
                totalAmount: order.totalAmount,
                orderStatus: order.status,
                paymentStatus: order.paymentStatus,
                paymentMethod: order.paymentMethod,
                createdAt: order.createdAt,
                placedByName: customerName,
                shopName,
                contactNumber,
                gstNumber
            };
        });

        if (search && search.trim()) {
            const q = search.trim().toUpperCase();
            transformed = transformed.filter((order) =>
                order.orderId.includes(q) ||
                order.placedByName.toUpperCase().includes(q) ||
                order.shopName.toUpperCase().includes(q) ||
                order.contactNumber.includes(q) ||
                order.gstNumber.toUpperCase().includes(q) ||
                order._id.toString().toUpperCase().includes(q)
            );
        }

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

        await computeTargetAchievement(targets);

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
            ],
            // Both Managers (6) and Directors (7) can search everyone registered except level 7 Directors
            level: { $ne: 7 }
        };

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

        // Resolve old price for audit log
        const existingPricing = await ProductPricing.findOne({ productId, memberId });
        let oldPrice = existingPricing ? existingPricing.retailPrice : 0;
        if (!existingPricing) {
            const Product = require('../models/Products.model');
            const product = await Product.findById(productId);
            oldPrice = product ? product.retailPrice : 0;
        }

        const result = await ProductPricing.findOneAndUpdate(
            { productId, memberId },
            { retailPrice, setBy: directorId },
            { upsert: true, new: true }
        );

        // Save price change audit log (product-pricing-specific)
        const ProductPricingAudit = require('../models/ProductPricingAudit.model');
        await ProductPricingAudit.create({
            productId,
            memberId,
            oldPrice,
            newPrice: retailPrice,
            changedBy: directorId,
            changeType: 'direct_override',
        });

        // ── General audit log ────────────────────────────────────────────────
        logAction(req, 'set_price', memberId, null, {
            productId,
            memberId,
            oldPrice,
            newPrice: retailPrice,
        });

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

        // Emit live event so Directors see new requests immediately
        try { getIo().emit('priceRequestCreated', priceRequest); } catch (_) { }

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
            // Directors only see pending requests (approved/rejected are in History)
            filter = { status: 'pending' };
        } else {
            // Managers see all their own requests (including approved/rejected)
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

            // Log approved price request in product-pricing audit logs
            const ProductPricingAudit = require('../models/ProductPricingAudit.model');
            await ProductPricingAudit.create({
                productId: request.productId,
                memberId: request.targetMemberId,
                oldPrice: request.currentPrice,
                newPrice: request.requestedPrice,
                changedBy: req.user.id || req.user._id,
                changeType: 'request_approval',
            });
        }

        // ── General audit log ────────────────────────────────────────────────
        logAction(req, status === 'approved' ? 'approve_price' : 'reject_price', request.targetMemberId, null, {
            requestId,
            productId: request.productId,
            targetMemberId: request.targetMemberId,
            oldPrice: request.currentPrice,
            newPrice: request.requestedPrice,
            decision: status,
        });

        // Emit live event so Managers see approval/rejection immediately
        try { getIo().emit('priceRequestUpdated', { requestId, status }); } catch (_) { }

        res.json({ success: true, message: `Request ${status}` });
    } catch (error) {
        // Provide clearer error for duplicate key issues
        if (error.code === 11000) {
            return res.status(409).json({
                success: false,
                message: 'A stale database index is blocking this operation. Please restart the server to run the migration, or manually drop the "productid_1_level_1" index from the productpricings collection.',
            });
        }
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports.getPricingAuditLogs = async (req, res) => {
    try {
        const memberLevel = req.user.level ?? 1;
        if (memberLevel < 7) {
            return res.status(403).json({ success: false, message: 'Only Directors can view audit logs.' });
        }

        const ProductPricingAudit = require('../models/ProductPricingAudit.model');
        const logs = await ProductPricingAudit.find()
            .populate('productId', 'name')
            .populate('memberId', 'name level roleName inviteCode')
            .populate('changedBy', 'name')
            .sort({ createdAt: -1 })
            .limit(100)
            .lean();

        res.json({ success: true, logs });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * GET /api/hierarchy/audit-logs
 * Returns paginated audit log entries. Directors (L7) only.
 *
 * Query params:
 *   page      {number}  — 1-based page number (default: 1)
 *   limit     {number}  — entries per page (default: 50, max: 100)
 *   action    {string}  — filter by action type (optional)
 *   fromDate  {string}  — ISO date, filter entries from this date (optional)
 *   toDate    {string}  — ISO date, filter entries up to this date (optional)
 *   memberId  {string}  — filter entries where performedBy OR targetMember = memberId (optional)
 */
module.exports.getAuditLogs = async (req, res) => {
    try {
        const memberLevel = req.user.level ?? 1;
        if (memberLevel < 7) {
            return res.status(403).json({ success: false, message: 'Only Directors can view audit logs.' });
        }

        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
        const skip = (page - 1) * limit;

        const filter = {};

        if (req.query.action) {
            filter.action = req.query.action;
        }

        if (req.query.fromDate || req.query.toDate) {
            filter.createdAt = {};
            if (req.query.fromDate) filter.createdAt.$gte = new Date(req.query.fromDate);
            if (req.query.toDate) filter.createdAt.$lte = new Date(req.query.toDate);
        }

        if (req.query.memberId) {
            const mid = new mongoose.Types.ObjectId(req.query.memberId);
            filter.$or = [{ performedBy: mid }, { targetMember: mid }];
        }

        const [logs, total] = await Promise.all([
            AuditLog.find(filter)
                .populate('performedBy', 'name level roleName')
                .populate('targetMember', 'name level roleName')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            AuditLog.countDocuments(filter),
        ]);

        res.json({
            success: true,
            total,
            page,
            pages: Math.ceil(total / limit),
            logs,
        });
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

// Dates below are built with local-time constructors; server.js pins process.env.TZ to
// Asia/Kolkata, so "local" is IST everywhere in this section.
const REPORT_TZ = 'Asia/Kolkata';
const REPORT_PERIODS = ['daily', 'weekly', 'monthly'];
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const REPORT_GROUP_FORMAT = { daily: '%Y-%m-%d', weekly: '%G-%V', monthly: '%Y-%m' };
const LEVEL_LABEL = { 7: 'Director', 6: 'Manager', 5: 'Super Stockist', 4: 'Sub SS', 3: 'Distributor', 2: 'Wholesaler', 1: 'Retailer' };

const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Monday 00:00 of the week containing `d` (weeks run Monday–Sunday). */
function startOfWeekMonday(d) {
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    return addDays(day, -((day.getDay() + 6) % 7));
}

/** Monday of ISO week `week` in ISO week-numbering year `year`. */
function isoWeekMonday(year, week) {
    return addDays(startOfWeekMonday(new Date(year, 0, 4)), (week - 1) * 7);
}

/**
 * Whole-bucket ranges ending with the current day/week/month:
 * daily = last 7 days, weekly = last 5 Monday-start weeks, monthly = last 6 months.
 * The previous range is the same length immediately before.
 */
function reportRanges(period, now = new Date()) {
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    switch (period) {
        case 'daily': {
            const start = addDays(today, -6);
            return { start, end: addDays(today, 1), previousStart: addDays(start, -7) };
        }
        case 'weekly': {
            const start = addDays(startOfWeekMonday(today), -28);
            return { start, end: addDays(start, 35), previousStart: addDays(start, -35) };
        }
        case 'monthly':
        default:
            return {
                start: new Date(today.getFullYear(), today.getMonth() - 5, 1),
                end: new Date(today.getFullYear(), today.getMonth() + 1, 1),
                previousStart: new Date(today.getFullYear(), today.getMonth() - 11, 1),
            };
    }
}

/**
 * Human label for a grouping key:
 *   daily   "2026-10-16" → "16 Oct"
 *   weekly  "2026-41"    → "Oct, W1"  (week belongs to the month of its Monday;
 *                                      W1 = first week whose Monday is in that month)
 *   monthly "2026-10"    → "Oct, 26"
 */
function labelFor(period, key) {
    const [a, b, c] = key.split('-').map(Number);
    if (period === 'daily') {
        const day = new Date(a, b - 1, c);
        return { label: `${c} ${SHORT_MONTHS[b - 1]}`, from: ymd(day), to: ymd(day) };
    }
    if (period === 'weekly') {
        const monday = isoWeekMonday(a, b);
        return {
            label: `${SHORT_MONTHS[monday.getMonth()]}, W${Math.ceil(monday.getDate() / 7)}`,
            from: ymd(monday),
            to: ymd(addDays(monday, 6)),
        };
    }
    return {
        label: `${SHORT_MONTHS[b - 1]}, ${String(a).slice(-2)}`,
        from: ymd(new Date(a, b - 1, 1)),
        to: ymd(new Date(a, b, 0)),
    };
}

/** Sales report for a member's scope (themselves + everyone below; Directors see all). */
async function buildSalesReport(memberId, memberLevel, requestedPeriod) {
    const period = REPORT_PERIODS.includes(requestedPeriod) ? requestedPeriod : 'monthly';
    const descendantIds = await getDescendantIds(memberId, memberLevel);
    const userIds = memberLevel >= 7
        ? descendantIds
        : [new mongoose.Types.ObjectId(memberId), ...descendantIds];
    const { start, end, previousStart } = reportRanges(period);

    const [grouped, previousRevenue] = await Promise.all([
        CartOrder.aggregate([
            { $match: { userId: { $in: userIds }, status: { $ne: 'cancelled' }, createdAt: { $gte: start, $lt: end } } },
            {
                // Units = boxes ordered: sum of `quantity` over the order's items
                // (items is stored as an object keyed by product id)
                $addFields: {
                    units: {
                        $sum: {
                            $map: {
                                input: { $objectToArray: { $ifNull: ['$items', {}] } },
                                as: 'i',
                                in: { $ifNull: ['$$i.v.quantity', 0] },
                            },
                        },
                    },
                },
            },
            {
                $group: {
                    _id: { $dateToString: { format: REPORT_GROUP_FORMAT[period], date: '$createdAt', timezone: REPORT_TZ } },
                    revenue: { $sum: '$totalAmount' },
                    orderCount: { $sum: 1 },
                    unitsSold: { $sum: '$units' },
                },
            },
            { $sort: { _id: 1 } },
        ]),
        CartOrder.aggregate([
            { $match: { userId: { $in: userIds }, status: { $ne: 'cancelled' }, createdAt: { $gte: previousStart, $lt: start } } },
            { $group: { _id: null, total: { $sum: '$totalAmount' } } },
        ]),
    ]);

    const entries = grouped.map((e) => {
        const { label, from, to } = labelFor(period, e._id);
        return { period: label, from, to, revenue: e.revenue, orderCount: e.orderCount, unitsSold: e.unitsSold };
    });

    return {
        period,
        range: { start, end },
        userIds,
        entries,
        totalRevenue: entries.reduce((sum, e) => sum + e.revenue, 0),
        totalOrders: entries.reduce((sum, e) => sum + e.orderCount, 0),
        totalUnits: entries.reduce((sum, e) => sum + e.unitsSold, 0),
        previousPeriodRevenue: previousRevenue[0]?.total ?? 0,
    };
}

module.exports.getReports = async (req, res) => {
    try {
        const memberId = req.user.id || req.user._id;
        const memberLevel = req.user.level ?? 1;
        const r = await buildSalesReport(memberId, memberLevel, req.query.period);

        res.json({
            success: true,
            report: {
                period: r.period,
                from: ymd(r.range.start),
                to: ymd(addDays(r.range.end, -1)),
                entries: r.entries,
                totalRevenue: r.totalRevenue,
                totalOrders: r.totalOrders,
                totalUnits: r.totalUnits,
                previousPeriodRevenue: r.previousPeriodRevenue,
            },
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * GET /api/hierarchy/reports/export?period=daily|weekly|monthly
 * Excel workbook of the caller's sales report — Directors (L7) and Managers (L6) only.
 * Sheets: Summary, Breakdown, Orders (every order incl. cancelled), Order Items.
 */
module.exports.exportSalesReport = async (req, res) => {
    try {
        const memberLevel = req.user.level ?? 1;
        if (memberLevel < 6) {
            return res.status(403).json({ success: false, message: 'Only Directors and Managers can download reports.' });
        }

        const ExcelJS = require('exceljs');
        const memberId = req.user.id || req.user._id;
        const report = await buildSalesReport(memberId, memberLevel, req.query.period);
        const { start, end } = report.range;

        const [me, orders] = await Promise.all([
            HierarchyMember.findById(memberId).select('name level').lean(),
            CartOrder.find({ userId: { $in: report.userIds }, createdAt: { $gte: start, $lt: end } })
                .sort({ createdAt: 1 })
                // Orders' `userId` ref still says the legacy 'User' model; buyers are HierarchyMembers
                .populate({ path: 'userId', model: HierarchyMember, select: 'name shopName level contactNumber gstNumber address parentId' })
                .lean(),
        ]);

        // Names of each buyer's parent ("placed under"), in one query
        const parentIds = [...new Set(orders.map((o) => o.userId?.parentId?.toString()).filter(Boolean))];
        const parents = await HierarchyMember.find({ _id: { $in: parentIds } }, 'name').lean();
        const parentName = new Map(parents.map((p) => [p._id.toString(), p.name]));

        // exceljs writes Dates as UTC; shift so Excel shows IST wall-clock time
        const ist = (d) => new Date(new Date(d).getTime() + 330 * 60 * 1000);
        const fromDate = start;
        const toDate = addDays(end, -1);
        const RUPEE = '"₹"#,##0.00';

        const cancelled = orders.filter((o) => o.status === 'cancelled');
        const cancelledValue = cancelled.reduce((s, o) => s + (o.totalAmount || 0), 0);
        const prev = report.previousPeriodRevenue;
        const periodName = report.period.charAt(0).toUpperCase() + report.period.slice(1);

        const wb = new ExcelJS.Workbook();
        wb.creator = 'Black Bagiraa';
        wb.created = new Date();

        const styleHeader = (ws) => {
            const header = ws.getRow(1);
            header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF16A34A' } };
            header.alignment = { vertical: 'middle' };
            ws.views = [{ state: 'frozen', ySplit: 1 }];
        };
        const addTable = (name, columns, rows) => {
            const ws = wb.addWorksheet(name);
            ws.columns = columns;
            ws.addRows(rows);
            styleHeader(ws);
            if (rows.length > 0) {
                ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
            }
            return ws;
        };

        // ── Summary ───────────────────────────────────────────────────────────
        const summary = wb.addWorksheet('Summary');
        summary.columns = [
            { header: 'Item', key: 'k', width: 34 },
            { header: 'Value', key: 'v', width: 32 },
        ];
        const summaryRows = [
            ['Generated for', `${me?.name ?? 'Unknown'} (${LEVEL_LABEL[me?.level] ?? `Level ${me?.level}`})`],
            ['Generated at (IST)', ist(new Date())],
            ['Report type', periodName],
            ['From', ist(fromDate)],
            ['To', ist(toDate)],
            ['Total revenue (excl. cancelled)', report.totalRevenue],
            ['Orders (excl. cancelled)', report.totalOrders],
            ['Boxes sold (excl. cancelled)', report.totalUnits],
            ['Average order value', report.totalOrders > 0 ? report.totalRevenue / report.totalOrders : 0],
            ['Cancelled orders', cancelled.length],
            ['Cancelled order value', cancelledValue],
            ['Previous period revenue', prev],
            ['Change vs previous period', prev > 0 ? (report.totalRevenue - prev) / prev : 'n/a'],
        ];
        summary.addRows(summaryRows.map(([k, v]) => ({ k, v })));
        styleHeader(summary);
        summary.getColumn('k').font = { bold: true };
        summary.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
        summary.getCell('B3').numFmt = 'dd-mmm-yyyy hh:mm AM/PM';
        summary.getCell('B5').numFmt = 'dd-mmm-yyyy';
        summary.getCell('B6').numFmt = 'dd-mmm-yyyy';
        ['B7', 'B10', 'B12', 'B13'].forEach((c) => { summary.getCell(c).numFmt = RUPEE; });
        if (prev > 0) summary.getCell('B14').numFmt = '0.0%';
        summary.getColumn('v').alignment = { horizontal: 'left' };

        // ── Breakdown (same rows as the screen) ───────────────────────────────
        const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
        addTable('Breakdown', [
            { header: periodName === 'Daily' ? 'Date' : periodName === 'Weekly' ? 'Week' : 'Month', key: 'label', width: 14 },
            { header: 'From', key: 'from', width: 14, style: { numFmt: 'dd-mmm-yyyy' } },
            { header: 'To', key: 'to', width: 14, style: { numFmt: 'dd-mmm-yyyy' } },
            { header: 'Revenue', key: 'revenue', width: 16, style: { numFmt: RUPEE } },
            { header: 'Orders', key: 'orders', width: 10 },
            { header: 'Boxes', key: 'boxes', width: 10 },
            { header: 'Avg order value', key: 'avg', width: 16, style: { numFmt: RUPEE } },
        ], report.entries.map((e) => ({
            label: e.period,
            from: ist(parseYmd(e.from)),
            to: ist(parseYmd(e.to)),
            revenue: e.revenue,
            orders: e.orderCount,
            boxes: e.unitsSold,
            avg: e.orderCount > 0 ? e.revenue / e.orderCount : 0,
        })));

        // ── Orders + Order Items ──────────────────────────────────────────────
        const orderRows = [];
        const itemRows = [];
        for (const o of orders) {
            const buyer = o.userId && typeof o.userId === 'object' ? o.userId : null;
            const items = Object.values(o.items || {});
            const orderId = o._id.toString().slice(-8).toUpperCase();
            const when = ist(o.createdAt);
            const buyerName = buyer?.name ?? o.shippingAddress?.customerName ?? 'Unknown';
            const shop = buyer?.shopName || o.shippingAddress?.shopName || '';

            orderRows.push({
                id: orderId,
                date: when,
                time: when,
                buyer: buyerName,
                shop,
                level: buyer ? (LEVEL_LABEL[buyer.level] ?? `Level ${buyer.level}`) : '',
                phone: buyer?.contactNumber ?? '',
                gst: buyer?.gstNumber ?? '',
                city: buyer?.address?.city || o.shippingAddress?.city || '',
                parent: buyer?.parentId ? (parentName.get(buyer.parentId.toString()) ?? '') : '',
                status: o.status,
                payment: o.paymentStatus,
                method: o.paymentMethod,
                boxes: items.reduce((s, i) => s + (i.quantity || 0), 0),
                total: o.totalAmount,
            });

            for (const i of items) {
                const boxSize = i.boxQuantity || 1;
                itemRows.push({
                    id: orderId,
                    date: when,
                    buyer: buyerName,
                    shop,
                    product: i.name,
                    category: i.category,
                    boxes: i.quantity,
                    boxSize,
                    pieces: (i.quantity || 0) * boxSize,
                    pricePiece: i.retailPrice,
                    priceBox: (i.retailPrice || 0) * boxSize,
                    lineTotal: (i.retailPrice || 0) * boxSize * (i.quantity || 0),
                    mrp: i.MRP,
                    status: o.status,
                });
            }
        }

        addTable('Orders', [
            { header: 'Order ID', key: 'id', width: 12 },
            { header: 'Date', key: 'date', width: 13, style: { numFmt: 'dd-mmm-yyyy' } },
            { header: 'Time', key: 'time', width: 10, style: { numFmt: 'hh:mm AM/PM' } },
            { header: 'Buyer', key: 'buyer', width: 22 },
            { header: 'Shop', key: 'shop', width: 22 },
            { header: 'Level', key: 'level', width: 14 },
            { header: 'Phone', key: 'phone', width: 13 },
            { header: 'GST', key: 'gst', width: 17 },
            { header: 'City', key: 'city', width: 14 },
            { header: 'Placed under', key: 'parent', width: 20 },
            { header: 'Status', key: 'status', width: 12 },
            { header: 'Payment status', key: 'payment', width: 15 },
            { header: 'Payment method', key: 'method', width: 16 },
            { header: 'Boxes', key: 'boxes', width: 8 },
            { header: 'Total', key: 'total', width: 14, style: { numFmt: RUPEE } },
        ], orderRows);

        addTable('Order Items', [
            { header: 'Order ID', key: 'id', width: 12 },
            { header: 'Date', key: 'date', width: 13, style: { numFmt: 'dd-mmm-yyyy' } },
            { header: 'Buyer', key: 'buyer', width: 22 },
            { header: 'Shop', key: 'shop', width: 22 },
            { header: 'Product', key: 'product', width: 26 },
            { header: 'Category', key: 'category', width: 16 },
            { header: 'Boxes', key: 'boxes', width: 8 },
            { header: 'Box size', key: 'boxSize', width: 9 },
            { header: 'Pieces', key: 'pieces', width: 9 },
            { header: 'Price / piece', key: 'pricePiece', width: 13, style: { numFmt: RUPEE } },
            { header: 'Price / box', key: 'priceBox', width: 13, style: { numFmt: RUPEE } },
            { header: 'Line total', key: 'lineTotal', width: 14, style: { numFmt: RUPEE } },
            { header: 'MRP', key: 'mrp', width: 10, style: { numFmt: RUPEE } },
            { header: 'Order status', key: 'status', width: 13 },
        ], itemRows);

        const buffer = await wb.xlsx.writeBuffer();
        const fileName = `Sales-Report_${periodName}_${ymd(new Date())}.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        res.send(Buffer.from(buffer));
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─── Profile ───────────────────────────────────────────────────────────────────

module.exports.updateProfile = async (req, res) => {
    try {
        const memberId = req.user.id || req.user._id;
        const { name, shopName, password, inviteCode } = req.body;

        // Members cannot change their own password from the profile.
        // Passwords are changed only by Managers (L6) / Directors (L7) via
        // PATCH /members/:memberId/password.
        if (password) {
            return res.status(403).json({
                success: false,
                message: 'Password cannot be changed from the profile. Contact your Manager or Director.',
            });
        }

        const member = await HierarchyMember.findById(memberId);
        if (!member) {
            return res.status(404).json({ success: false, message: 'Member not found' });
        }

        // Invite codes are permanent once generated — nobody can change them.
        // Sending the same code back unchanged (older app versions do) is fine.
        if (inviteCode && inviteCode.trim().toUpperCase() !== member.inviteCode) {
            return res.status(403).json({
                success: false,
                message: 'Invite code cannot be changed once it has been generated.',
            });
        }

        if (name) member.name = name;
        if (shopName) member.shopName = shopName;

        await member.save();

        const updatedMember = await HierarchyMember.findById(memberId).select('-password').lean();
        res.json({ success: true, message: 'Profile updated successfully', member: updatedMember });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─── Leaderboard ───────────────────────────────────────────────────────────────

/**
 * GET /api/hierarchy/leaderboard
 * Sales Leaderboard for Directors (L7) and Managers (L6).
 * Ranks entities by sales volume (in money).
 *
 * CRITICAL ACCESS RULE:
 * - Directors (L7): see actual sales numbers (totalSales, orderCount) in money.
 * - Managers (L6): can see the leaderboard and rankings ONLY; sales numbers
 *   (totalSales, orderCount) are strictly omitted (null) for security and privacy.
 */
module.exports.getLeaderboard = async (req, res) => {
    try {
        const callerLevel = req.user.level ?? 1;
        if (callerLevel < 6) {
            return res.status(403).json({ success: false, message: 'Leaderboard is only accessible to Directors and Managers.' });
        }

        const isDirector = callerLevel >= 7;
        const { type = 'managers', duration = 'monthly' } = req.query;

        // Build date filter based on duration
        let dateFilter = {};
        if (duration !== 'all_time') {
            const { start, end } = getPeriodBounds(duration);
            dateFilter = { createdAt: { $gte: start, $lt: end } };
        }

        let rankedList = [];

        if (type === 'managers') {
            // Rank all active Level 6 Managers by their total team sales
            const managers = await HierarchyMember.find({ level: 6, isActive: true })
                .select('name contactNumber level roleName shopName')
                .lean();

            rankedList = await Promise.all(
                managers.map(async (manager) => {
                    const descendants = await HierarchyMember.find(
                        { ancestorIds: manager._id },
                        '_id'
                    ).lean();
                    const allUserIds = [manager._id, ...descendants.map((d) => d._id)];

                    const orderMatch = {
                        userId: { $in: allUserIds },
                        status: { $ne: 'cancelled' }, // every order counts unless cancelled
                        ...dateFilter,
                    };

                    const salesAgg = await CartOrder.aggregate([
                        { $match: orderMatch },
                        {
                            $group: {
                                _id: null,
                                totalSales: { $sum: '$totalAmount' },
                                orderCount: { $sum: 1 },
                            },
                        },
                    ]);

                    return {
                        _id: manager._id,
                        name: manager.name,
                        contactNumber: manager.contactNumber,
                        level: manager.level,
                        roleName: manager.roleName,
                        shopName: manager.shopName || '',
                        teamSize: descendants.length,
                        totalSales: salesAgg[0]?.totalSales ?? 0,
                        orderCount: salesAgg[0]?.orderCount ?? 0,
                    };
                })
            );
        } else {
            // Rank individual buyers / members by sales
            const orderMatch = {
                status: { $ne: 'cancelled' }, // every order counts unless cancelled
                ...dateFilter,
            };

            const memberSales = await CartOrder.aggregate([
                { $match: orderMatch },
                {
                    $group: {
                        _id: '$userId',
                        totalSales: { $sum: '$totalAmount' },
                        orderCount: { $sum: 1 },
                    },
                },
                { $sort: { totalSales: -1 } },
                { $limit: 50 },
            ]);

            const memberIds = memberSales.map((s) => s._id);
            const members = await HierarchyMember.find({ _id: { $in: memberIds }, isActive: true })
                .select('name contactNumber level roleName shopName')
                .lean();

            const memberMap = new Map(members.map((m) => [m._id.toString(), m]));

            rankedList = memberSales
                .filter((s) => memberMap.has(s._id.toString()))
                .map((s) => {
                    const m = memberMap.get(s._id.toString());
                    return {
                        _id: m._id,
                        name: m.name,
                        contactNumber: m.contactNumber,
                        level: m.level,
                        roleName: m.roleName,
                        shopName: m.shopName || '',
                        totalSales: s.totalSales,
                        orderCount: s.orderCount,
                    };
                });
        }

        // Sort descending by totalSales, then by orderCount
        rankedList.sort((a, b) => {
            if (b.totalSales !== a.totalSales) {
                return b.totalSales - a.totalSales;
            }
            return b.orderCount - a.orderCount;
        });

        // Strip numbers for non-directors (Managers get null)
        const leaderboard = rankedList.map((item, index) => ({
            rank: index + 1,
            memberId: item._id?.toString() ?? String(index + 1),
            name: item.name,
            roleName: item.roleName,
            level: item.level,
            shopName: item.shopName,
            teamSize: item.teamSize ?? 0,
            // Numbers are only exposed to Directors (L7)
            totalSales: isDirector ? item.totalSales : null,
            orderCount: isDirector ? item.orderCount : null,
        }));

        res.json({
            success: true,
            isDirector,
            duration,
            type,
            leaderboard,
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

