const multer = require('multer');
const path = require('path');

// Use memory storage to store files in memory as Buffer
const storage = multer.memoryStorage();

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

// Helper function to convert buffer to Base64 data URL
const bufferToBase64 = (buffer, mimetype) => {
    const base64 = buffer.toString('base64');
    return `data:${mimetype};base64,${base64}`;
}

module.exports = {
    getUploader,
    bufferToBase64
}


