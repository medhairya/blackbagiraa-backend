const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

/**
 * Unified hierarchy member model — replaces the old Admin + User split.
 * Supports 7 levels: Director (7) → Manager (6) → Distributor/SS (5) →
 * Sub SS (4) → Distributor (3) → Wholesaler (2) → Retailer (1)
 */
const hierarchyMemberSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true,
    },
    contactNumber: {
        type: String,
        required: true,
        unique: true,
    },
    password: {
        type: String,
        required: true,
        // NOTE: select is NOT false — admins (L6+) need to retrieve passwords.
        // Controller-level logic controls who can see this field.
    },
    level: {
        type: Number,
        required: true,
        enum: [1, 2, 3, 4, 5, 6, 7],
        index: true,
    },
    roleName: {
        type: String,
        required: true,
        enum: ['director', 'manager', 'distributor_ss', 'sub_ss', 'distributor', 'wholesaler', 'retailer'],
    },
    // Direct parent in the hierarchy (null for directors)
    parentId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'HierarchyMember',
        default: null,
        index: true,
    },
    // Materialized path: ALL ancestors from parent up to root.
    // Enables fast queries like "find all descendants of X" using { ancestorIds: X._id }
    ancestorIds: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'HierarchyMember',
    }],
    // Business details
    shopName: { type: String, trim: true },
    gstNumber: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true },
    address: {
        line1: { type: String },
        city: { type: String },
        state: { type: String },
        pincode: { type: String },
    },
    // Invite code: used during registration to link to parent.
    // Each member gets a unique code they can share with subordinates.
    inviteCode: {
        type: String,
        unique: true,
        sparse: true,
        uppercase: true,
        trim: true,
    },
    isActive: {
        type: Boolean,
        default: true,
    },
    // Legacy compatibility with old Admin model
    stockistCode: {
        type: String,
        sparse: true,
        uppercase: true,
        trim: true,
    },
    // Legacy: link to old Admin._id for backward compat during migration
    legacyAdminId: { type: mongoose.Schema.Types.ObjectId },
    legacyUserId: { type: mongoose.Schema.Types.ObjectId },
}, { timestamps: true });

// ─── Indexes ───────────────────────────────────────────────────────────────────
hierarchyMemberSchema.index({ ancestorIds: 1 });
hierarchyMemberSchema.index({ parentId: 1, level: 1 });
hierarchyMemberSchema.index({ roleName: 1 });

// ─── Helpers ────────────────────────────────────────────────────────────────────
function generateInviteCode(name, contact) {
    const namePart = name.replace(/\s+/g, '').toUpperCase().slice(0, 5);
    const contactPart = contact.slice(-4);
    const rand = Math.random().toString(36).substring(2, 5).toUpperCase();
    return `${namePart}-${contactPart}-${rand}`;
}

// ─── Hooks ─────────────────────────────────────────────────────────────────────
hierarchyMemberSchema.pre('save', async function (next) {
    // Passwords are stored in PLAIN TEXT so that Directors/Managers can
    // retrieve and share them with team members who forget their password.
    // No hashing is performed on new passwords.

    // Auto-generate invite code for levels 2+ that don't have one yet
    if (this.isNew && this.level >= 2 && !this.inviteCode) {
        let code, exists;
        let attempts = 0;
        do {
            code = generateInviteCode(this.name, this.contactNumber);
            exists = await mongoose.model('HierarchyMember').exists({ inviteCode: code });
            attempts++;
        } while (exists && attempts < 10);
        this.inviteCode = code;
    }
    next();
});

// ─── Methods ───────────────────────────────────────────────────────────────────
hierarchyMemberSchema.methods.generateToken = function () {
    return jwt.sign(
        {
            id: this._id,
            contactNumber: this.contactNumber,
            level: this.level,
            roleName: this.roleName,
        },
        process.env.JWT_SECRET,
        { expiresIn: '12h' }
    );
};

/**
 * Compare a candidate password with the stored password.
 * Handles both legacy bcrypt-hashed passwords and new plain-text passwords.
 */
hierarchyMemberSchema.methods.comparePassword = async function (candidate) {
    // Check if stored password is a bcrypt hash (starts with $2a$ or $2b$)
    if (this.password && (this.password.startsWith('$2a$') || this.password.startsWith('$2b$'))) {
        return bcrypt.compare(candidate, this.password);
    }
    // Plain-text comparison for new passwords
    return candidate === this.password;
};

const HierarchyMember = mongoose.model('HierarchyMember', hierarchyMemberSchema);

module.exports = HierarchyMember;
