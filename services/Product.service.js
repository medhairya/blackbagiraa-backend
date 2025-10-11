const CartOrder = require("../models/Orders.model");

module.exports.placeOrder = async({
    userId,
    items,
    totalAmount,
    paymentMethod,
    shippingAddress
})=>{
    try {
        // console.log(userId,items,totalAmount,paymentMethod,shippingAddress);
        
        const order = new CartOrder({
            userId,
            items,
            totalAmount,
            paymentMethod,
            shippingAddress
        });
        await order.save();
        return { success: true, order };
    } catch (error) {
        throw new Error('Failed to place order');
    }
}
