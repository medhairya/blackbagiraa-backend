const mongoose = require('mongoose');

/**
 * Price change request — Managers can request price changes,
 * which must be approved by Directors.
 */
const priceChangeRequestSchema = new mongoose.Schema({
    requestedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'HierarchyMember',
        required: true,
        index: true,
    },
    productId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
        required: true,
    },
    currentPrice: {
        type: Number,
        required: true,
    },
    requestedPrice: {
        type: Number,
        required: true,
    },
    targetMemberId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'HierarchyMember',
        required: true,
    },
    reason: { type: String },
    status: {
        type: String,
        enum: ['pending', 'approved', 'rejected'],
        default: 'pending',
        index: true,
    },
    reviewedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'HierarchyMember',
    },
    reviewedAt: { type: Date },
}, { timestamps: true });

const PriceChangeRequest = mongoose.model('PriceChangeRequest', priceChangeRequestSchema);

module.exports = PriceChangeRequest;
