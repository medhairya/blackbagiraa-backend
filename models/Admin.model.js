const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const adminSchema = new mongoose.Schema({
    contactNumber: {
        type: String,
        required: true,
        unique: true,
    },
    password: {
        type: String,
        required: true,
        select: false,
    },
    role: {
        type: String,
        enum: ['main_admin', 'super_stockist'],
        required: true,
        default: 'super_stockist',
    },
    name: {
        type: String,
        required: true,
    },
    stockistCode: {
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
    createdAt: {
        type: Date,
        default: Date.now,
    },
    updatedAt: {
        type: Date,
        default: Date.now,
    },
});

adminSchema.pre('save', async function (next) {
    if (this.isModified('password')) {
        this.password = await bcrypt.hash(this.password, 10);
    }
    if (this.isModified('stockistCode') && this.stockistCode) {
        this.stockistCode = this.stockistCode.toUpperCase().trim();
    }
    this.updatedAt = Date.now();
    next();
});

adminSchema.methods.generateToken = function () {
    return jwt.sign(
        { id: this._id, contactNumber: this.contactNumber, role: this.role },
        process.env.JWT_SECRET,
        { expiresIn: '12h' }
    );
};

const Admin = mongoose.model('Admin', adminSchema);

module.exports = Admin;
