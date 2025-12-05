const Category = require("../models/Category");
const { getIo } = require("../socket");
const Product = require("../models/Products.model");
const { bufferToBase64 } = require("../utils/uplode");

module.exports.getCategories = async (req, res) => {
    try {
        const categories = await Category.find();
        if (!categories) {
            return res.status(404).json({ success: false, message: "No categories found" });
        }
        
        // Images are stored as Base64 data URLs, so return them directly
        return res.status(200).json({ success: true, categories });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
}



module.exports.addCategory = async (req, res) => {
    try {
        const data = req.body
        const image = req.file
        
        if (!image) {
            return res.status(400).json({ success: false, message: "Image is required" });
        }

        // Convert image buffer to Base64 data URL
        const imageBase64 = bufferToBase64(image.buffer, image.mimetype);

        const category = new Category({
            name: data.name,
            count: data.count,
            image: imageBase64
        })
        await category.save()
        getIo().emit('categoryAdded', category)

        return res.status(200).json({ success: true, message: "Category added successfully" });

    } catch (error) {
        console.log(error);
        return res.status(500).json({ success: false, message: error.message });
    }
}


module.exports.deleteCategory = async (req, res) => {
    try {
        const { id } = req.params

        const category = await Category.findById(id)
        if (!category) {
            return res.status(404).json({ success: false, message: "Category not found" });
        }
        
        // No need to delete files from filesystem since images are stored in MongoDB
        await Category.findByIdAndDelete(id)
        getIo().emit('categoryDeleted', id)
        return res.status(200).json({ success: true, message: "Category deleted successfully" });

    } catch (error) {
        console.log(error);
        return res.status(500).json({ success: false, message: error.message });

    }
}

module.exports.updateCategory = async (req, res) => {
    try {
        const { id } = req.body
        const category = await Category.findById(id)
        if (!category) {
            return res.status(404).json({ success: false, message: "Category not found" });
        }
        const image = req.file || null
        if(image){
            // Convert image buffer to Base64 data URL
            const imageBase64 = bufferToBase64(image.buffer, image.mimetype);
            category.image = imageBase64
        }
        if(req.body.name){

            const product = await Product.find({category:category.name})
            if(product.length > 0){
                 product.forEach(async (pro)=>{
                    pro.category = req.body.name
                    await pro.save()
                 })
            }
            category.name = req.body.name

        }
        if(req.body.count){
            category.count = req.body.count
        }
        await category.save()
        getIo().emit('categoryUpdated', category)
        return res.status(200).json({ success: true, message: "Category updated successfully", category });
    } catch (error) {
        console.log(error);
        return res.status(500).json({ success: false, message: error.message });
    }
}

