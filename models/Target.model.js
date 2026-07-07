const mongoose = require('mongoose');

/**
 * Target model — supports revenue, order, and visit targets
 * with daily, weekly, and monthly durations.
 */
const targetSchema = new mongoose.Schema({
    assignedTo: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'HierarchyMember',
        required: true,
        index: true,
    },
    assignedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'HierarchyMember',
        required: true,
    },
    targetType: {
        type: String,
        enum: ['revenue', 'orders', 'visits'],
        required: true,
    },
    duration: {
        type: String,
        enum: ['daily', 'weekly', 'monthly'],
        required: true,
    },
    targetValue: {
        type: Number,
        required: true,
        min: 0,
    },
    achieved: {
        type: Number,
        default: 0,
        min: 0,
    },
    periodStart: {
        type: Date,
        required: true,
    },
    periodEnd: {
        type: Date,
        required: true,
    },
}, { timestamps: true });

// Compound index for efficient queries
targetSchema.index({ assignedTo: 1, duration: 1, periodStart: 1 });
targetSchema.index({ assignedBy: 1 });

const Target = mongoose.model('Target', targetSchema);

module.exports = Target;
