/**
 * Script to add a Level 6 Manager to the Black Bagiraa hierarchy database.
 * 
 * EDIT values inside the config block below.
 * RUN using: node scripts/addManager.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const HierarchyMember = require('../models/HierarchyMember.model');

// ─── EDIT MANAGER DETAILS HERE ────────────────────────────────────────────────
const MANAGER_CONFIG = {
    name: "Keyur Bhai",
    contactNumber: "7861889212",              // Mobile number used for login
    password: "keyur@1999",            // Password in plain text (will be hashed automatically)
    inviteCode: "MGR-KEYUR",                  // Unique code for subordinates to register under them
    address: {
        line1: "123 Office Road",
        city: "Vadodara",
        state: "Gujarat",
        pincode: "390001"
    }
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
        // Check if manager already exists
        const existing = await HierarchyMember.findOne({ contactNumber: MANAGER_CONFIG.contactNumber });
        if (existing) {
            console.error(`❌ Error: A member with contact number ${MANAGER_CONFIG.contactNumber} already exists (${existing.name}).`);
            await mongoose.disconnect();
            return;
        }

        // Find the Director (Level 7) to link as the parent
        const director = await HierarchyMember.findOne({ level: 7 });
        if (!director) {
            console.warn('⚠️ Warning: No Director (Level 7) found in the database. Creating manager with no parent.');
        }

        const hashedPassword = await bcrypt.hash(MANAGER_CONFIG.password, 10);

        const manager = new HierarchyMember({
            name: MANAGER_CONFIG.name,
            contactNumber: MANAGER_CONFIG.contactNumber,
            password: hashedPassword,
            level: 6, // Manager Level
            roleName: "manager",
            parentId: director ? director._id : null,
            ancestorIds: director ? [director._id] : [],
            inviteCode: MANAGER_CONFIG.inviteCode.toUpperCase(),
            isActive: true,
            address: MANAGER_CONFIG.address
        });

        manager.$__skipPasswordHash = true; // Skip double hashing since we hashed it above
        await manager.save();
        console.log(`\n🎉 Manager successfully added!`);
        console.log(`- Name: ${manager.name}`);
        console.log(`- Login Contact: ${manager.contactNumber}`);
        console.log(`- Level: ${manager.level} (${manager.roleName})`);
        console.log(`- Parent (Director): ${director ? director.name : 'None'}`);
        console.log(`- Invite Code: ${manager.inviteCode}`);
    } catch (err) {
        console.error('❌ Failed to create manager:', err.message);
    } finally {
        await mongoose.disconnect();
        console.log('🔌 Disconnected from MongoDB.');
    }
}

run();