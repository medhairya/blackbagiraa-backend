const mongoose = require('mongoose');

/**
 * Per-level product pricing — Directors set different prices
 * for each hierarchy level (e.g., Distributor/SS level gets a different
 * price than Retailer level).
 */
const productPricingSchema = new mongoose.Schema({
    productId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
        required: true,
    },
    level: {
        type: Number,
        required: true,
        enum: [1, 2, 3, 4, 5],
    },
    retailPrice: {
        type: Number,
        required: true,
        min: 0,
    },
    setBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'HierarchyMember',
        required: true,
    },
}, { timestamps: true });

// Unique per product per level
productPricingSchema.index({ productId: 1, level: 1 }, { unique: true });

const ProductPricing = mongoose.model('ProductPricing', productPricingSchema);

module.exports = ProductPricing;
