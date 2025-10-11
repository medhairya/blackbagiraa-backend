const User = require('../models/User.model');

module.exports.createUser = async ({
    customerName, shopName, addressLine1, city, state, pincode, contactNumber, password
}) => {
    if (!customerName || !shopName || !addressLine1 || !city || !state || !pincode || !contactNumber || !password) {
        throw new Error('All fields are required');
    }

    // Check for duplicate entry based on contactNumber
    const existingUser = await User.findOne({ contactNumber });
    if (existingUser) {
        throw new Error('User with this phone is invalid');
    }

    const user = new User({
        customerName,
        shopName,
        addressLine1,
        city,
        state,
        pincode,
        contactNumber,
        password
    });

    await user.save();
    return user;
};
