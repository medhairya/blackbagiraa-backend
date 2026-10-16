/**
 * Clear test data before going live.
 *
 * Deletes ALL documents in: orders, carts, targets, price change requests,
 * product-pricing history and the audit log. Keeps everything else
 * (members, products, categories, custom prices, customers, …).
 *
 * Safety:
 *   1. Every collection in the database is backed up first to
 *      Documents/db-backups/<timestamp>/ as Extended JSON (ObjectIds and dates preserved).
 *   2. Without --confirm it is a DRY RUN: it backs up and shows what would be deleted.
 *
 * RUN (from the backend folder):
 *   node scripts/clearTestData.js            → backup + dry run (nothing deleted)
 *   node scripts/clearTestData.js --confirm  → backup + delete
 * RESTORE:  node scripts/restoreBackup.js <backup folder> --confirm
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const { EJSON } = mongoose.mongo.BSON;

// Collections to empty (MongoDB collection names)
const CLEAR = [
    'cartorders',           // orders
    'carts',                // saved carts
    'targets',              // targets (progress is recalculated from orders)
    'pricechangerequests',  // Manager → Director price requests
    'productpricingaudits', // pricing history log
    'auditlogs',            // general audit log
];

const BACKUP_ROOT = path.join(__dirname, '..', '..', '..', '..', 'Documents', 'db-backups');

async function run() {
    const confirm = process.argv.includes('--confirm');
    if (!process.env.MONGODB_URI) {
        console.error('❌ MONGODB_URI is missing in backend/.env');
        process.exit(1);
    }

    await mongoose.connect(process.env.MONGODB_URI);
    const db = mongoose.connection.db;
    console.log(`✅ Connected to database "${db.databaseName}"`);

    try {
        // ── 1. Back up every collection ──────────────────────────────────────
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const dir = path.join(BACKUP_ROOT, `${db.databaseName}_${stamp}`);
        fs.mkdirSync(dir, { recursive: true });

        const collections = (await db.listCollections().toArray()).map((c) => c.name).sort();
        for (const name of collections) {
            const docs = await db.collection(name).find({}).toArray();
            const file = path.join(dir, `${name}.json`);
            fs.writeFileSync(file, EJSON.stringify(docs, { relaxed: false }));
            // Verify the file reads back to the same number of documents
            const readBack = EJSON.parse(fs.readFileSync(file, 'utf8'), { relaxed: false }).length;
            if (readBack !== docs.length) throw new Error(`Backup check failed for ${name}`);
            console.log(`   💾 ${name.padEnd(24)} ${String(docs.length).padStart(5)} docs`);
        }
        console.log(`✅ Backup written to ${dir}\n`);

        // ── 2. Show / delete ─────────────────────────────────────────────────
        console.log(confirm ? '🗑️  Deleting:' : '🔍 DRY RUN — would delete (nothing changed):');
        for (const name of CLEAR) {
            if (!collections.includes(name)) {
                console.log(`   ${name.padEnd(24)} (collection not present)`);
                continue;
            }
            const before = await db.collection(name).countDocuments();
            if (confirm) {
                const { deletedCount } = await db.collection(name).deleteMany({});
                console.log(`   ${name.padEnd(24)} ${String(deletedCount).padStart(5)} deleted`);
            } else {
                console.log(`   ${name.padEnd(24)} ${String(before).padStart(5)} docs`);
            }
        }

        const kept = collections.filter((c) => !CLEAR.includes(c));
        console.log(`\nKept untouched: ${kept.join(', ')}`);
        if (!confirm) console.log('\nRe-run with --confirm to delete.');
    } finally {
        await mongoose.disconnect();
    }
}

run().catch((err) => {
    console.error('❌ Failed:', err.message);
    process.exit(1);
});
