const User = require('../models/User.model');
const Admin = require('../models/Admin.model');

function normalizeStockistCode(code) {
    return code?.trim().toUpperCase();
}

module.exports.normalizeStockistCode = normalizeStockistCode;

module.exports.resolveSuperStockist = async (superStockistCode) => {
    const code = normalizeStockistCode(superStockistCode);
    if (!code) {
        throw new Error('Super stockist code is required');
    }

    const superStockist = await Admin.findOne({
        role: 'super_stockist',
        stockistCode: code,
        isActive: true,
    });

    if (!superStockist) {
        throw new Error('Invalid or inactive super stockist code');
    }

    return superStockist;
};

module.exports.createUser = async ({
    customerName,
    shopName,
    addressLine1,
    city,
    state,
    pincode,
    contactNumber,
    password,
    superStockistCode,
}) => {
    if (
        !customerName ||
        !shopName ||
        !addressLine1 ||
        !city ||
        !state ||
        !pincode ||
        !contactNumber ||
        !password ||
        !superStockistCode
    ) {
        throw new Error('All fields are required');
    }

    const existingUser = await User.findOne({ contactNumber });
    if (existingUser) {
        throw new Error('User with this phone is invalid');
    }

    const superStockist = await module.exports.resolveSuperStockist(superStockistCode);

    const user = new User({
        customerName,
        shopName,
        addressLine1,
        city,
        state,
        pincode,
        contactNumber,
        password,
        superStockistId: superStockist._id,
    });

    await user.save();
    return user;
};
