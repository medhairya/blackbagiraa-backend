/**
 * Script to change the password of any HierarchyMember in the database.
 * 
 * EDIT values in CONFIG below.
 * RUN using: node scripts/changePassword.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const HierarchyMember = require('../models/HierarchyMember.model');

// ─── EDIT CREDENTIALS HERE ───────────────────────────────────────────────────
const CONFIG = {
    contactNumber: "9662447873",       // Mobile number of the account to update
    newPassword: "dhairya4252"          // The new password
};
// ─────────────────────────────────────────────────────────────────────────────

async function run() {
    const dbUri = process.env.MONGODB_URI;
    if (!dbUri) {
        console.error('❌ MONGODB_URI is missing in backend/.env');
        process.exit(1);
    }

    console.log('⏳ Connecting to MongoDB...');
    await mongoose.connect(dbUri);
    console.log('✅ Connected to MongoDB.');

    try {
        const member = await HierarchyMember.findOne({ contactNumber: CONFIG.contactNumber });
        if (!member) {
            console.error(`❌ Error: No user found with contact number "${CONFIG.contactNumber}".`);
            return;
        }

        const hashedPassword = await bcrypt.hash(CONFIG.newPassword, 10);
        
        await HierarchyMember.updateOne(
            { contactNumber: CONFIG.contactNumber },
            { $set: { password: hashedPassword } }
        );

        console.log(`\n🎉 Password successfully updated!`);
        console.log(`- User Name:  ${member.name}`);
        console.log(`- Contact:    ${member.contactNumber}`);
        console.log(`- New Pass:   ${CONFIG.newPassword}`);
    } catch (err) {
        console.error('❌ Failed to update password:', err.message);
    } finally {
        await mongoose.disconnect();
        console.log('🔌 Disconnected from MongoDB.');
    }
}

run();
