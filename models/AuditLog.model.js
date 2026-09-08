const mongoose = require('mongoose');

/**
 * AuditLog — immutable record of every significant action in the system.
 *
 * action values:
 *   'add_member'        — An admin added a new member to the hierarchy
 *   'change_password'   — An admin changed a member's password
 *   'change_level'      — An admin changed a member's hierarchy level
 *   'deactivate_member' — A member account was deactivated
 *   'set_price'         — A Director set a product price for a member
 *   'approve_price'     — A Director approved a Manager's price change request
 *   'reject_price'      — A Director rejected a Manager's price change request
 *   'login'             — A member logged in (optional, for security tracking)
 */
const auditLogSchema = new mongoose.Schema(
    {
        // What type of action was performed
        action: {
            type: String,
            required: true,
            enum: [
                'add_member',
                'change_password',
                'change_level',
                'deactivate_member',
                'set_price',
                'approve_price',
                'reject_price',
                'login',
            ],
            index: true,
        },

        // Who performed the action
        performedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'HierarchyMember',
            required: true,
            index: true,
        },

        // Snapshot of performer's info at the time (so logs remain readable even if name changes)
        performedByName: { type: String },
        performedByLevel: { type: Number },
        performedByRole: { type: String },

        // Who was affected (optional — e.g. the member whose password was changed)
        targetMember: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'HierarchyMember',
            default: null,
            index: true,
        },
        targetMemberName: { type: String, default: null },

        // Free-form structured details about the change
        // Examples:
        //   add_member:      { newMemberName, newMemberLevel, newMemberContact, placedUnder }
        //   change_password: { memberName }
        //   change_level:    { oldLevel, newLevel, memberName }
        //   set_price:       { productId, memberId, oldPrice, newPrice }
        //   approve_price:   { productId, requestId, oldPrice, newPrice }
        details: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },

        // IP address of the requester (if available)
        ipAddress: { type: String, default: null },
    },
    {
        timestamps: true,   // createdAt is the canonical log timestamp
        versionKey: false,
    }
);

// Indexes for common query patterns
auditLogSchema.index({ createdAt: -1 });                    // latest first
auditLogSchema.index({ performedBy: 1, createdAt: -1 });    // filter by performer
auditLogSchema.index({ targetMember: 1, createdAt: -1 });   // filter by target
auditLogSchema.index({ action: 1, createdAt: -1 });         // filter by action type

const AuditLog = mongoose.model('AuditLog', auditLogSchema);

module.exports = AuditLog;
