const mongoose = require('mongoose');

const STAFF_ROLES = ['main_admin', 'super_stockist'];

function getStaffId(req) {
    return req.user?.id || req.user?._id;
}

function getOrderScope(req) {
    const role = req.user?.role;

    if (role === 'main_admin') {
        return {};
    }

    if (role === 'super_stockist') {
        const staffId = getStaffId(req);
        if (!staffId) {
            return { _id: null };
        }
        return { superStockistId: new mongoose.Types.ObjectId(staffId) };
    }

    if (role === 'user') {
        const userId = req.user?._id;
        if (!userId) {
            return { _id: null };
        }
        return { userId: new mongoose.Types.ObjectId(userId) };
    }

    return { _id: null };
}

function getDistributorScope(req) {
    const role = req.user?.role;

    if (role === 'main_admin') {
        return {};
    }

    if (role === 'super_stockist') {
        const staffId = getStaffId(req);
        if (!staffId) {
            return { _id: null };
        }
        return { superStockistId: new mongoose.Types.ObjectId(staffId) };
    }

    return { _id: null };
}

function requireRole(...roles) {
    return (req, res, next) => {
        if (!req.user?.role || !roles.includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: 'Forbidden: insufficient permissions',
            });
        }
        next();
    };
}

async function assertOrderInScope(req, order) {
    if (!order) {
        return false;
    }

    const role = req.user?.role;

    if (role === 'main_admin') {
        return true;
    }

    if (role === 'super_stockist') {
        const staffId = getStaffId(req);
        return order.superStockistId?.toString() === staffId?.toString();
    }

    if (role === 'user') {
        return order.userId?.toString() === req.user?._id?.toString();
    }

    return false;
}

module.exports = {
    STAFF_ROLES,
    getStaffId,
    getOrderScope,
    getDistributorScope,
    requireRole,
    assertOrderInScope,
};
