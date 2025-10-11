const multer = require('multer');
const path = require('path');
const fs = require('fs');


const storage = multer.diskStorage({

   
    destination: function(req,file,cb){
        const uploadPath = path.join(__dirname,`../uploads/images/${file.fieldname}/`)
        console.log(file.fieldname);
        
        fs.mkdirSync(uploadPath, { recursive: true })
        cb(null,uploadPath)
    },
    filename: function(req,file,cb){
        const ext = path.extname(file.originalname)
        const baseName = path.basename(file.originalname,ext)
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9)
        cb(null,`${baseName}-${uniqueSuffix}${ext}`)
       
    }

})
const fileFilter = (req,file,cb)=>{
    const allowedTypes = /jpeg|jpg|png|gif|svg|webp/
    const isValid = allowedTypes.test(path.extname(file.originalname).toLowerCase()) &&
                  allowedTypes.test(file.mimetype)
    if(!isValid){
        return cb(new Error('Invalid file type'),false)
    }
    cb(null,true)
}


const getUploader = (fieldname)=>{
    return multer({
        storage:storage,
        fileFilter:fileFilter,
        limits:{
            fileSize:1024*1024*5, //5MB
            fieldNameSize:200
        }
    }).single(fieldname)
}

module.exports = {
    getUploader
}


