const mongoose = require('mongoose');
const { type } = require('os');

const cartSchema = new mongoose.Schema({
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
            quantity: { type: Number, required: true },
        }),
        default: {}
    }
}, { timestamps: true });

cartSchema.pre('save', function (next) {
    const newItems = new Map(this.items);

    for (const [key, value] of newItems.entries()) {
        if (value.quantity <= 0) {
            newItems.delete(key);
        }
    }

    this.items = newItems;
    this.markModified('items'); // Ensure Mongoose detects the change
    next();
});

const Cart = mongoose.model('Cart', cartSchema);

module.exports = Cart;
