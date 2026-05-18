const CartOrder = require('../models/Orders.model');

module.exports.placeOrder = async ({
    userId,
    superStockistId,
    items,
    totalAmount,
    paymentMethod,
    shippingAddress,
}) => {
    try {
        const order = new CartOrder({
            userId,
            superStockistId,
            items,
            totalAmount,
            paymentMethod,
            shippingAddress,
        });
        await order.save();
        return { success: true, order };
    } catch (error) {
        throw new Error('Failed to place order');
    }
};
