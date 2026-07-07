const mongoose = require('mongoose');

/**
 * Visit log — tracks field visits by sales team members to customers.
 * Used for visit target tracking.
 */
const visitSchema = new mongoose.Schema({
    memberId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'HierarchyMember',
        required: true,
        index: true,
    },
    customerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Customer',
        required: true,
    },
    visitDate: {
        type: Date,
        required: true,
        default: Date.now,
    },
    notes: { type: String },
}, { timestamps: true });

visitSchema.index({ memberId: 1, visitDate: -1 });

const Visit = mongoose.model('Visit', visitSchema);

module.exports = Visit;
