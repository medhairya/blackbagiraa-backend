/**
 * One-time migration script: converts existing Admin + User documents
 * into the new unified HierarchyMember collection.
 *
 * Usage: node scripts/migrateToHierarchy.js
 *
 * This is safe to re-run — it skips contactNumbers that already exist
 * in HierarchyMember.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Admin = require('../models/Admin.model');
const User = require('../models/User.model');
const HierarchyMember = require('../models/HierarchyMember.model');
const crypto = require('crypto');

function generateInviteCode() {
    return crypto.randomBytes(4).toString('hex').toUpperCase();
}

async function migrate() {
    const dbUri = process.env.MONGODB_URI || process.env.DB_URL;
    if (!dbUri) {
        console.error('❌ No MONGODB_URI or DB_URL in .env');
        process.exit(1);
    }

    await mongoose.connect(dbUri);
    console.log('✅ Connected to MongoDB');

    // ── Migrate Admins ──────────────────────────────────────────────────
    const admins = await Admin.find().select('+password').lean();
    console.log(`Found ${admins.length} admin(s) to migrate`);

    const adminIdMap = new Map(); // oldAdminId → newMemberId

    for (const admin of admins) {
        const exists = await HierarchyMember.findOne({ contactNumber: admin.contactNumber });
        if (exists) {
            console.log(`  ⏩ Skip (exists): ${admin.name} [${admin.contactNumber}]`);
            adminIdMap.set(admin._id.toString(), exists._id);
            continue;
        }

        const level = admin.role === 'main_admin' ? 7 : 5;
        const roleName = admin.role === 'main_admin' ? 'director' : 'distributor_ss';

        const member = new HierarchyMember({
            name: admin.name,
            contactNumber: admin.contactNumber,
            password: admin.password, // Already hashed
            level,
            roleName,
            parentId: null, // Directors have no parent; SS linked to director below
            ancestorIds: [],
            stockistCode: admin.stockistCode,
            inviteCode: admin.stockistCode || generateInviteCode(),
            isActive: admin.isActive ?? true,
            legacyAdminId: admin._id,
        });

        // Skip the pre-save password hash since it's already hashed
        member.$__skipPasswordHash = true;
        await HierarchyMember.collection.insertOne(member.toObject());
        adminIdMap.set(admin._id.toString(), member._id);
        console.log(`  ✅ Migrated admin: ${admin.name} → Level ${level} (${roleName})`);
    }

    // Link super_stockists to the main_admin (director)
    const directors = await HierarchyMember.find({ level: 7 });
    if (directors.length > 0) {
        const directorId = directors[0]._id;
        await HierarchyMember.updateMany(
            { level: 5, parentId: null },
            { parentId: directorId, ancestorIds: [directorId] }
        );
        console.log(`  🔗 Linked ${await HierarchyMember.countDocuments({ level: 5 })} SS to director`);
    }

    // ── Migrate Users (Shopkeepers → Retailers) ─────────────────────────
    const users = await User.find().select('+password').lean();
    console.log(`Found ${users.length} user(s) to migrate`);

    for (const user of users) {
        const exists = await HierarchyMember.findOne({ contactNumber: user.contactNumber });
        if (exists) {
            console.log(`  ⏩ Skip (exists): ${user.customerName} [${user.contactNumber}]`);
            continue;
        }

        // Resolve parent from old superStockistId
        const parentNewId = user.superStockistId
            ? adminIdMap.get(user.superStockistId.toString())
            : null;

        // Build ancestor chain
        const ancestorIds = [];
        if (parentNewId) {
            const parent = await HierarchyMember.findById(parentNewId).lean();
            if (parent) {
                ancestorIds.push(parentNewId, ...(parent.ancestorIds || []));
            }
        }

        const member = new HierarchyMember({
            name: user.customerName,
            contactNumber: user.contactNumber,
            password: user.password, // Already hashed
            level: 1,
            roleName: 'retailer',
            parentId: parentNewId,
            ancestorIds,
            shopName: user.shopName,
            address: {
                line1: user.addressLine1,
                city: user.city,
                state: user.state,
                pincode: user.pincode,
            },
            inviteCode: generateInviteCode(),
            isActive: true,
            legacyUserId: user._id,
        });

        await HierarchyMember.collection.insertOne(member.toObject());
        console.log(`  ✅ Migrated user: ${user.customerName} → Level 1 (retailer)`);
    }

    const totalMembers = await HierarchyMember.countDocuments();
    console.log(`\n🎉 Migration complete. Total HierarchyMember documents: ${totalMembers}`);
    await mongoose.disconnect();
}

migrate().catch((err) => {
    console.error('❌ Migration failed:', err);
    process.exit(1);
});
