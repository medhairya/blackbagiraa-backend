const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const userRoutes = require('./routes/User.routes');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const categoriesRoutes = require('./routes/Categories.routes');
const productsRoutes = require('./routes/Products.routes');
const path = require('path');
require('dotenv').config();

const app = express();

app.use(cors(
    {
        origin: process.env.FRONTEND_URL, 
        credentials: true,
    }
));
app.use('/images',express.static(path.join(__dirname,'uploads/images')))
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
    cookie: { 
        secure: false, //set true in production
        sameSite:'strict'
    }
}));
app.use('/api/user', userRoutes);
app.use('/api/category', categoriesRoutes);
app.use('/api/products', productsRoutes);

app.get('/', (req, res) => {
    res.json({ status: 'OK' });
});

module.exports = app;


