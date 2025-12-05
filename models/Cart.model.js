const mongoose = require('mongoose');

const cartSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        ref: 'User'
    },
    items: {
        type: Map,
        of: new mongoose.Schema({
            productId: { 
                type: mongoose.Schema.Types.ObjectId, 
                required: true,
                ref: 'Product'
            },
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

// Method to populate cart items with product data
cartSchema.methods.populateItems = async function() {
    const Product = mongoose.model('Product');
    const populatedItems = new Map();
    
    for (const [key, value] of this.items.entries()) {
        const product = await Product.findById(value.productId);
        if (product) {
            populatedItems.set(key, {
                ...product.toObject(),
                quantity: value.quantity
            });
        }
    }
    
    return populatedItems;
};

const Cart = mongoose.model('Cart', cartSchema);

module.exports = Cart;
