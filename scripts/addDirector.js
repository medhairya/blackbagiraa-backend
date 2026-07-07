/**
 * Script to add a Level 7 Director to the Black Bagiraa hierarchy database.
 *
 * EDIT values in DIRECTOR_CONFIG below.
 * RUN using: node scripts/addDirector.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const HierarchyMember = require('../models/HierarchyMember.model');

// ─── EDIT DIRECTOR DETAILS HERE ───────────────────────────────────────────────
const DIRECTOR_CONFIG = {
    name: "Black Bagiraa Director",
    contactNumber: "9662447873",          // Mobile number used for login
    password: "dhairya4252",               // Password (will be hashed automatically)
    inviteCode: "ITHelp",           // Invite code (share with Managers to link under you)
    shopName: "Black Bagiraa HQ",
    address: {
        line1: "Black Bagiraa Factory",
        city: "Vadodara",
        state: "Gujarat",
        pincode: "390001"
    }
};
// ──────────────────────────────────────────────────────────────────────────────

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
        // Check if a director already exists
        const existing = await HierarchyMember.findOne({ contactNumber: DIRECTOR_CONFIG.contactNumber });
        if (existing) {
            console.error(`❌ Error: A member with contact number ${DIRECTOR_CONFIG.contactNumber} already exists (${existing.name}).`);
            await mongoose.disconnect();
            return;
        }

        const existingDir = await HierarchyMember.findOne({ level: 7 });
        if (existingDir) {
            console.warn(`⚠️  Warning: A Director already exists: ${existingDir.name} (${existingDir.contactNumber}). Add only one Director.`);
        }

        const hashedPassword = await bcrypt.hash(DIRECTOR_CONFIG.password, 10);

        const director = new HierarchyMember({
            name: DIRECTOR_CONFIG.name,
            contactNumber: DIRECTOR_CONFIG.contactNumber,
            password: hashedPassword,
            level: 7,               // Director
            roleName: 'director',
            parentId: null,         // Directors have no parent
            ancestorIds: [],
            inviteCode: DIRECTOR_CONFIG.inviteCode.toUpperCase(),
            shopName: DIRECTOR_CONFIG.shopName,
            isActive: true,
            address: DIRECTOR_CONFIG.address,
        });

        // We already hashed above, skip pre-save double hash
        HierarchyMember.schema.pre('save', function (next) { next(); });

        await HierarchyMember.collection.insertOne({
            ...director.toObject(),
            password: hashedPassword,   // ensure raw hash is persisted
        });

        console.log(`\n🎉 Director successfully added!`);
        console.log(`   Name:         ${DIRECTOR_CONFIG.name}`);
        console.log(`   Contact:      ${DIRECTOR_CONFIG.contactNumber}`);
        console.log(`   Password:     ${DIRECTOR_CONFIG.password}`);
        console.log(`   Level:        7 (director)`);
        console.log(`   Invite Code:  ${DIRECTOR_CONFIG.inviteCode.toUpperCase()}`);
        console.log(`\n👉 You can now log in on the app using the contact and password above.`);
    } catch (err) {
        console.error('❌ Failed to create Director:', err.message);
    } finally {
        await mongoose.disconnect();
        console.log('🔌 Disconnected from MongoDB.');
    }
}

run();
