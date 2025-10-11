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

// CORS Configuration
const corsOptions = {
    origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);
        
        // List of allowed origins
        const allowedOrigins = [
            process.env.FRONTEND_URL,
            'http://localhost:5173',
            'http://localhost:3000',
            'https://your-frontend-domain.com' // Add your production frontend URL here
        ];
        
        if (allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            console.log('CORS blocked origin:', origin);
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cookie'],
    optionsSuccessStatus: 200 // Some legacy browsers choke on 204
};

app.use(cors(corsOptions));

// Log CORS requests for debugging
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path} - Origin: ${req.get('Origin') || 'No Origin'}`);
    next();
});

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
    res.json({ 
        status: 'OK',
        message: 'Black Bagiraa Backend API',
        cors: 'Enabled',
        allowedOrigins: [
            process.env.FRONTEND_URL,
            'http://localhost:5173',
            'http://localhost:3000'
        ]
    });
});

// CORS test endpoint
app.get('/api/cors-test', (req, res) => {
    res.json({
        success: true,
        message: 'CORS is working correctly!',
        origin: req.get('Origin') || 'No Origin Header',
        timestamp: new Date().toISOString()
    });
});

// Global error handler for CORS and other errors
app.use((err, req, res, next) => {
    if (err.message === 'Not allowed by CORS') {
        return res.status(403).json({
            success: false,
            message: 'CORS Error: Origin not allowed',
            error: 'Access denied from this origin'
        });
    }
    
    console.error('Server Error:', err);
    res.status(500).json({
        success: false,
        message: 'Internal Server Error',
        error: process.env.NODE_ENV === 'production' ? 'Something went wrong' : err.message
    });
});

module.exports = app;


