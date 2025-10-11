const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const adminSchema = new mongoose.Schema({
    contactNumber: {
        type: String,
        required: true,
        unique: true, // Optional: ensures no duplicate numbers
    },
    password: {
        type: String,
        required: true,
        select: false, // Will exclude password by default when querying
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

// Pre-save hook to hash password
adminSchema.pre('save', async function(next) {
    if (this.isModified('password')) {
        this.password = await bcrypt.hash(this.password, 10);
    }
    next();
});



// Method to generate JWT token
adminSchema.methods.generateToken = function () {
    return jwt.sign(
        { id: this._id, contactNumber: this.contactNumber },
        process.env.JWT_SECRET,
        { expiresIn: '12h' }
    );
};

const Admin = mongoose.model('Admin', adminSchema);

module.exports = Admin;
