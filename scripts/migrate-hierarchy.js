/**
 * One-time migration for three-level admin hierarchy.
 * Run from backend folder: node scripts/migrate-hierarchy.js
 *
 * Set MAIN_ADMIN_CONTACT in .env or pass as first CLI arg to pick main admin.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const Admin = require('../models/Admin.model');
const User = require('../models/User.model');
const CartOrder = require('../models/Orders.model');

const MAIN_ADMIN_CONTACT = process.argv[2] || process.env.MAIN_ADMIN_CONTACT;

async function migrate() {
    if (!process.env.MONGODB_URI) {
        console.error('MONGODB_URI is missing in .env');
        process.exit(1);
    }

    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    const admins = await Admin.find().select('+password');
    if (admins.length === 0) {
        console.log('No admins found. Nothing to migrate.');
        await mongoose.disconnect();
        return;
    }

    let mainAdmin = null;
    if (MAIN_ADMIN_CONTACT) {
        mainAdmin = admins.find((a) => a.contactNumber === MAIN_ADMIN_CONTACT);
        if (!mainAdmin) {
            console.error(`Admin with contact ${MAIN_ADMIN_CONTACT} not found.`);
            process.exit(1);
        }
    } else {
        mainAdmin = admins[0];
        console.log(`No MAIN_ADMIN_CONTACT set. Using first admin: ${mainAdmin.contactNumber}`);
    }

    await Admin.updateOne(
        { _id: mainAdmin._id },
        {
            $set: {
                role: 'main_admin',
                name: mainAdmin.name || 'Main Admin',
                isActive: true,
            },
            $unset: { stockistCode: '' },
        }
    );
    console.log(`Main admin: ${mainAdmin.contactNumber}`);

    let stockistIndex = 1;
    let defaultSuperStockist = null;

    for (const admin of admins) {
        if (admin._id.toString() === mainAdmin._id.toString()) continue;

        admin.role = 'super_stockist';
        admin.name = admin.name || `Super Stockist S${stockistIndex}`;
        admin.stockistCode = admin.stockistCode || `S${stockistIndex}-BAGIRAA`;
        admin.isActive = admin.isActive !== false;
        await admin.save();
        console.log(`Super stockist: ${admin.name} (${admin.stockistCode})`);

        if (!defaultSuperStockist) {
            defaultSuperStockist = admin;
        }
        stockistIndex++;
    }

    if (!defaultSuperStockist) {
        defaultSuperStockist = await Admin.create({
            name: 'Default Super Stockist',
            contactNumber: `9${Date.now().toString().slice(-9)}`,
            password: 'ChangeMe@123',
            role: 'super_stockist',
            stockistCode: 'S1-BAGIRAA',
            isActive: true,
        });
        console.log('Created default super stockist for orphan users');
    }

    const usersWithoutStockist = await User.find({
        $or: [{ superStockistId: { $exists: false } }, { superStockistId: null }],
    });

    for (const user of usersWithoutStockist) {
        user.superStockistId = defaultSuperStockist._id;
        await user.save();
    }
    console.log(`Assigned ${usersWithoutStockist.length} users to ${defaultSuperStockist.stockistCode}`);

    const orders = await CartOrder.find({
        $or: [{ superStockistId: { $exists: false } }, { superStockistId: null }],
    });

    for (const order of orders) {
        const user = await User.findById(order.userId);
        if (user?.superStockistId) {
            order.superStockistId = user.superStockistId;
            await order.save();
        }
    }
    console.log(`Backfilled superStockistId on ${orders.length} orders`);

    console.log('Migration complete.');
    await mongoose.disconnect();
}

migrate().catch((err) => {
    console.error(err);
    process.exit(1);
});
