const jwt = require('jsonwebtoken');
const Blacklist = require('../models/Blacklist.model'); // Import the Blacklist model

const authMiddleware = async (req, res, next) => {
    const token = req.cookies.token || req.headers.authorization.split(' ')[1]; 
    if (!token) {
        return res.status(401).json({ authenticate: false, message: 'Unauthorized' });
    }
    const isBlacklisted = await Blacklist.findOne({ token });
    if (isBlacklisted) {
        return res.status(401).json({ authenticate: false, message: 'Token is blacklisted' });
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
        if (err) {
            return res.status(401).json({ authenticate: false, message: 'Unauthorized' });
        }
        req.user = decoded; 
        next();
    });
};

module.exports = authMiddleware;
