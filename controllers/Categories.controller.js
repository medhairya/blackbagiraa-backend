const path = require("path");
const Category = require("../models/Category");
const { getIo } = require("../socket");
const fs = require('fs');
const Product = require("../models/Products.model");



module.exports.getCategories = async (req, res) => {
    try {
        const categories = await Category.find();
        if (!categories) {
            return res.status(404).json({ success: false, message: "No categories found" });
        }
        return res.status(200).json({ success: true, categories });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
}



module.exports.addCategory = async (req, res) => {
    try {
        //log the data and send response
        const data = req.body
        const image = req.file
        const imagePath = `${process.env.BASE_URL}/images/categoryImage/${image.filename}`

        const category = new Category({
            name: data.name,
            count: data.count,
            image: imagePath
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
        const imgUrlPath = path.join(__dirname, '../uploads/', category.image.replace('http://localhost:4000/', ''));
        if (fs.existsSync(imgUrlPath)) {
            fs.unlink(imgUrlPath, (err) => {
                console.log(err);
            })
        }
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
            const imgUrlPath = path.join(__dirname, '../uploads/', category.image.replace('http://localhost:4000/', ''));
            if (fs.existsSync(imgUrlPath)) {
                fs.unlink(imgUrlPath, (err) => {
                    console.log(err);
                })
            }
            const imagePath = `${process.env.BASE_URL}/images/categoryImage/${image.filename}`
            category.image = imagePath
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

