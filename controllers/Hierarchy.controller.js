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

        // For level 1 — remove invite code (leaf node)
        if (targetLevel === 1) {
            target.inviteCode = undefined;
        }

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

        // Scope check: Directors (L7) see anyone; others can only view themselves or their descendants
        if (requesterLevel < 7 && String(member._id) !== String(requesterId) && !member.ancestorIds?.map(String).includes(String(requesterId))) {
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
                        paymentStatus: 'paid',
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
                paymentStatus: 'paid',
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

