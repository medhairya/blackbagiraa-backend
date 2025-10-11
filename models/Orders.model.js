const mongoose = require('mongoose');

const cartOrderSchema = new mongoose.Schema({
    userId: { 
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        ref: 'User'
    },
    items: {
        type: Map,
        of: new mongoose.Schema({
            _id: { type: String, required: true },
            name: { type: String, required: true },
            image: { type: String, required: true },
            MRP: { type: Number, required: true },
            retailPrice: { type: Number, required: true },
            scheme: { type: String },
            boxQuantity:{type:Number},
            category: { type: String, required: true },
            createdAt: { type: Date, default: Date.now },
            quantity: { type: Number, required: true }
        }),
        default: {}
    },
    totalAmount: { type: Number, required: true },
    status: { 
        type: String, 
        enum: ['pending', 'processing', 'shipped', 'delivered', 'cancelled'], 
        default: 'pending' 
    },
    paymentMethod: { type: String, required: true },
    paymentStatus: { 
        type: String, 
        enum: ['pending', 'paid', 'failed'], 
        default: 'pending' 
    },
    shippingAddress: {
        type: new mongoose.Schema({
            addressLine1: { type: String, required: true },
            city: { type: String, required: true },
            state: { type: String, required: true },
            pincode: { type: String, required: true },
            shopName: { type: String, required: true },
            customerName: { type: String, required: true },
        }),
        required: true
    }
}, { timestamps: true });

const CartOrder = mongoose.model('CartOrder', cartOrderSchema);

module.exports = CartOrder;
