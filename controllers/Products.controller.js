const Cart = require('../models/Cart.model');
const Product = require('../models/Products.model');
const { placeOrder } = require('../services/Product.service');
const User = require('../models/User.model');
const CartOrder = require('../models/Orders.model');
const { getIo } = require('../socket');
const Category = require('../models/Category');
const fs = require('fs');
const path = require('path');

module.exports.fetchProducts = async (req, res) => {
    try {
        const products = await Product.find();
        if (!products) {
            return res.status(404).json({ success: false, message: "No products found" });
        }
        res.status(200).json({ success: true, products });
    } catch (error) {
        res.status(500).json({ success: false, message: "Internal server error" });
    }
}

module.exports.saveCart = async (req, res) => {
    try {
        const { cart } = req.body;
        console.log(cart);
        if (!cart) {
            return res.status(400).json({ success: false, message: "Cart is required" });
        }
        const userId = req.user._id;
        const hashMap = new Map(Object.entries(cart));
        let cartData = await Cart.findOne({ userId });
        if (!cartData) {
            cartData = new Cart({ userId, items: hashMap });
        } else {
            cartData.items = new Map([...cartData.items, ...hashMap]);
        }
        await cartData.save();
        res.status(200).json({ success: true, message: "Cart Updated successfully" });
    } catch (error) {
        console.log(error);
        res.status(500).json({ success: false, message: "Internal server error" });
    }
}


try {
        const userId = req.user._id;
        const cartData = await Cart.findOne({ userId });
        res.status(200).json({ success: true, cartData });
    } catch (error) {
        res.status(500).json({ success: false, message: "Internal server error" });
    }


module.exports.placeOrder = async (req, res) => {
    try {
        const { items, totalAmount, paymentMethod } = req.body;
        // console.log(items,totalAmount,paymentMethod);
        const itemsData = new Map(Object.entries(items));
        // console.log(itemsData);

        const userId = req.user._id;
        const userData = await User.findById(userId);
        if (!userData) {
            return res.status(404).json({ success: false, message: "User not found" });
        }
        const shippingAddress = {
            addressLine1: userData.addressLine1,
            city: userData.city,
            state: userData.state,
            pincode: userData.pincode,
            shopName: userData.shopName,
            customerName: userData.customerName,
        }
        const order = await placeOrder({ userId, items: itemsData, totalAmount, paymentMethod, shippingAddress });
        if (!order) {
            return res.status(400).json({ success: false, message: "Failed to place order" });
        }
        if (order.success) {
            await Cart.deleteMany({ userId });
            setTimeout(() => {

                getIo().emit('orderPlaced', { success: true, message: "Order placed successfully", order });
            }, 2000);
        }
        res.status(200).json({ success: true, order });
    } catch (error) {
        console.log(error);

        res.status(500).json({ success: false, message: "Internal server error" });
    }
}

module.exports.fetchOrders = async (req, res) => {
    try {
        const userId = req.user._id;
        const orders = await CartOrder.find({ userId });
        if (!orders) {
            return res.status(404).json({ success: false, message: "No orders found" });
        }
        res.status(200).json({ success: true, orders });
    } catch (error) {
        console.log(error);
        res.status(500).json({ success: false, message: "Internal server error" });
    }
}

module.exports.adminFetchOrders = async (req, res) => {
    try {
        if (!req.user.id) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }
        console.log(req.user);
        const orders = await CartOrder.find();
        if (!orders) {
            return res.status(404).json({ success: false, message: "No orders found" });
        }
        console.log(orders)
        res.status(200).json({ success: true, orders });
    } catch (error) {
        console.log(error);
        res.status(500).json({ success: false, message: "Internal server error" });
    }

}

module.exports.adminUpdateOrderStatus = async (req, res) => {
    try {
        const { orderId } = req.params;
        const { status } = req.body;
        const order = await CartOrder.findByIdAndUpdate(
            orderId,
            { status: status },
            { new: true }
        );
        if (!order) {
            return res.status(404).json({ success: false, message: "Order not found" });
        }
        getIo().emit('orderStatusUpdated', { success: true, message: "Order status updated successfully", order });
        res.status(200).json({ success: true, message: "Order status updated successfully" });
    } catch (error) {
        console.log(error);
        res.status(500).json({ success: false, message: "Internal server error" });
    }
}
module.exports.adminUpdatePaymentStatus = async (req, res) => {
    try {
        const { orderId } = req.params;
        const { paymentStatus } = req.body;
        const order = await CartOrder.findByIdAndUpdate(orderId, { paymentStatus: paymentStatus },
            { new: true }
        );
        if (!order) {
            return res.status(404).json({ success: false, message: "Order not found" });
        }
        getIo().emit('paymentStatusUpdated', { success: true, message: "Payment status updated successfully", order })
        res.status(200).json({ success: true, message: "Payment status updated successfully" });

    } catch (error) {
        console.log(error);
        res.status(500).json({ success: false, message: "Internal server error" });

    }
}
module.exports.adminFetchStatsData = async (req, res) => {
    try {
        const orders = await CartOrder.find();
        const totalOrders = orders.length;
        const pendingOrders = orders.filter(order => order.status === "pending").length;
        const completedOrders = orders.filter(order => order.status === "delivered").length;
        const totalSales = orders.reduce((acc, order) => acc + order.totalAmount, 0);
        const totalProducts = await Product.countDocuments();
        const totalShopkeepers = await User.countDocuments();
        res.status(200).json({ success: true, stats: { totalOrders, pendingOrders, completedOrders, totalSales, totalProducts, totalShopkeepers } });
    } catch (error) {
        console.log(error);
        res.status(500).json({ success: false, message: "Internal server error" });
    }
}
module.exports.adminFetchMonthlySalesData = async (req, res) => {
    try {
        const salesData = await CartOrder.aggregate([
            {
                $match: {
                    status: { $ne: 'cancelled' },
                    paymentStatus: 'paid'
                }
            },
            {
                $group: {
                    _id: {
                        $month: "$createdAt"
                    },
                    totalSales: { $sum: "$totalAmount" }
                }
            },
            {
                $sort: {
                    _id: 1
                }
            }
        ])
        const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const formattedSalesData = months.map((name, index) => {
            const found = salesData.find(item => item._id === index + 1);
            return {
                name,
                sales: found ? found.totalSales : 0
            };
        });
        res.status(200).json({ success: true, salesData: formattedSalesData });
    } catch (error) {
        console.log(error);
        res.status(500).json({ success: false, message: "Internal server error" });
    }
}

module.exports.adminFetchOrderStatusData = async (req, res) => {
    try {
        const result = await CartOrder.aggregate([
            {
                $group: {
                    _id: "$status",
                    count: { $sum: 1 }
                }
            }
        ])
        const colorMap = {
            delivered: 'hsl(var(--success))',
            shipped: 'hsl(var(--primary))',
            pending: 'hsl(var(--warning))',
            processing: 'hsl(var(--muted))',
            cancelled: 'hsl(var(--destructive))'
        };
        const orderStatusData = result.map((item) => ({
            name: item._id,
            value: item.count,
            color: colorMap[item._id] || 'hsl(var(--border))'
        }))
        res.status(200).json({ success: true, orderStatusData });
    } catch (error) {
        console.log(error);
        res.status(500).json({ success: false, message: "Internal server error" });
    }
}

module.exports.adminAddProduct = async (req, res) => {

    try {

        const { name, MRP, retailPrice, scheme, category,boxQuantity } = req.body;

        console.log(name, MRP, retailPrice, scheme, category,boxQuantity);
        const productImg = req.file;
        const imagePath = `${process.env.BASE_URL}/images/productImg/${productImg.filename}`
        const categoryDe = await Category.findById(category);
        const newProduct = new Product({
            name: name,
            image: imagePath,
            MRP: MRP,
            retailPrice: retailPrice,
            scheme: scheme ? scheme : '',
            category: categoryDe.name,
            boxQuantity:Number(boxQuantity)
        })
        await newProduct.save();
        getIo().emit('productAdded', newProduct);
        res.status(200).json({ success: true, message: "Product added successfully", newProduct })
    } catch (error) {
        console.log(error);
        res.status(500).json({ success: false, message: "Internal server error" })
    }


}

module.exports.adminDeleteProduct = async (req, res) => {
    try {
        const { productId } = req.params;
        const product = await Product.findById(productId);
        if (!product) {
            return res.status(404).json({ success: false, message: "Product not found" });
        }
        const imgUrlPath = path.join(__dirname, '../uploads/', product.image.replace('http://localhost:4000/', ''));
        if (fs.existsSync(imgUrlPath)) {
            fs.unlink(imgUrlPath, (err) => {
                console.log(err);
            })
        }
        await Product.findByIdAndDelete(productId);
        getIo().emit('productDeleted', productId);
        res.status(200).json({ success: true, message: "Product deleted successfully",productId });

    } catch (error) {
        console.log(error);
        res.status(500).json({ success: false, message: "Internal server error" })
    }
}

module.exports.adminUpdateProduct = async (req, res) => {
    try {
       
       const {productId} = req.body;
       const product = await Product.findById(productId);
       if(!product){
        return res.status(404).json({ success: false, message: "Product not found" });
       }
     
       const image = req.file || null;
       if(image){
        const imgUrlPath = path.join(__dirname, '../uploads/', product.image.replace('http://localhost:4000/', ''));
        
        if(fs.existsSync(imgUrlPath)){
            fs.unlink(imgUrlPath, (err)=>{
                console.log(err);
            })
        }
        const imagePath = `${process.env.BASE_URL}/images/productImg/${image.filename}`
        product.image = imagePath;
       }
       if(req.body.name){
        product.name = req.body.name;
       }
       if(req.body.MRP){
        product.MRP = req.body.MRP;
       }
       if(req.body.boxQuantity){
        product.boxQuantity = req.body.boxQuantity;
       }
       if(req.body.retailPrice){
        product.retailPrice = req.body.retailPrice;
       }
      
        product.scheme = req.body.scheme;
     
       if(req.body.category){
         if(req.body.category !== product.category){
            const categoryDe = await Category.findById(req.body.category);
            product.category = categoryDe.name;
         }
       }    
       await product.save();
       getIo().emit('productUpdated', product);
       res.status(200).json({ success: true, message: "Product updated successfully", product });
        
    } catch (error) {
        console.log(error);
        res.status(500).json({ success: false, message: "Internal server error" })
    }
}
