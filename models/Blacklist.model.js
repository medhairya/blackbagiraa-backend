const mongoose = require('mongoose');

const blacklistSchema = new mongoose.Schema({
    token: {
        type: String,
        required: true,
        unique: true,
    },
    reason: {
        type: String,
        required: true,
    },
    // Entry is removed once the token itself would have expired.
    // Kept separate from the old `createdAt` TTL (12h) so long-lived
    // "Stay logged in" tokens stay blocked for their full lifetime.
    expiresAt: {
        type: Date,
        required: true,
        expires: 0,
    },
});

const Blacklist = mongoose.model('Blacklist', blacklistSchema);

module.exports = Blacklist;
