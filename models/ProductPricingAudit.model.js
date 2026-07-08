const mongoose = require('mongoose');

/**
 * Product Pricing Audit — logs every price override/change.
 */
const productPricingAuditSchema = new mongoose.Schema({
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
    oldPrice: {
        type: Number,
        required: true,
    },
    newPrice: {
        type: Number,
        required: true,
    },
    changedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'HierarchyMember',
        required: true,
    },
    changeType: {
        type: String,
        enum: ['direct_override', 'request_approval'],
        required: true,
    },
}, { timestamps: true });

productPricingAuditSchema.index({ memberId: 1, createdAt: -1 });

const ProductPricingAudit = mongoose.model('ProductPricingAudit', productPricingAuditSchema);

module.exports = ProductPricingAudit;
