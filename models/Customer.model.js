const mongoose = require('mongoose');

/**
 * Customer registered by field staff for customer management.
 */
const customerSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true,
    },
    gstNumber: {
        type: String,
        trim: true,
    },
    mobileNumber: {
        type: String,
        required: true,
    },
    address: {
        line1: { type: String, required: true },
        city: { type: String, required: true },
        state: { type: String, required: true },
        pincode: { type: String, required: true },
    },
    registeredBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'HierarchyMember',
        required: true,
        index: true,
    },
}, { timestamps: true });

customerSchema.index({ registeredBy: 1 });
customerSchema.index({ mobileNumber: 1 });

const Customer = mongoose.model('Customer', customerSchema);

module.exports = Customer;
