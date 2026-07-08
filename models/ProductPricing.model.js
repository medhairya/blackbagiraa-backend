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
    memberId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'HierarchyMember',
        required: true,
        index: true,
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

// Unique per product per member
productPricingSchema.index({ productId: 1, memberId: 1 }, { unique: true });

const ProductPricing = mongoose.model('ProductPricing', productPricingSchema);

module.exports = ProductPricing;
