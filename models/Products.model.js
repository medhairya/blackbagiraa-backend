const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
    name: { type: String, required: true },
    image: { type: String, required: true },
    MRP: { type: Number, required: true },
    boxQuantity:{ type: Number },
    retailPrice: { type: Number, required: true },
    scheme: { type: String },
    category: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});

const Product = mongoose.model('Product', productSchema);

module.exports = Product;
