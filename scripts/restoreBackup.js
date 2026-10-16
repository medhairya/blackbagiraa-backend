/**
 * Restore collections from a backup made by scripts/clearTestData.js.
 *
 * For each <collection>.json in the folder, the collection is REPLACED with the
 * backed-up documents (ObjectIds and dates preserved).
 *
 * RUN (from the backend folder):
 *   node scripts/restoreBackup.js "<backup folder>"                         → dry run
 *   node scripts/restoreBackup.js "<backup folder>" --confirm               → restore all
 *   node scripts/restoreBackup.js "<backup folder>" --only=cartorders,carts --confirm
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const { EJSON } = mongoose.mongo.BSON;

async function run() {
    const dir = process.argv[2];
    const confirm = process.argv.includes('--confirm');
    const onlyArg = process.argv.find((a) => a.startsWith('--only='));
    const only = onlyArg ? onlyArg.slice(7).split(',').map((s) => s.trim()) : null;

    if (!dir || !fs.existsSync(dir)) {
        console.error('❌ Give the backup folder path, e.g. node scripts/restoreBackup.js "../../../Documents/db-backups/test_..."');
        process.exit(1);
    }

    await mongoose.connect(process.env.MONGODB_URI);
    const db = mongoose.connection.db;
    console.log(`✅ Connected to database "${db.databaseName}"`);
    console.log(confirm ? '♻️  Restoring:' : '🔍 DRY RUN — would restore (nothing changed):');

    try {
        const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
        for (const file of files) {
            const name = file.slice(0, -5);
            if (only && !only.includes(name)) continue;
            const docs = EJSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'), { relaxed: false });
            if (confirm) {
                await db.collection(name).deleteMany({});
                if (docs.length > 0) await db.collection(name).insertMany(docs);
            }
            console.log(`   ${name.padEnd(24)} ${String(docs.length).padStart(5)} docs`);
        }
        if (!confirm) console.log('\nRe-run with --confirm to restore.');
    } finally {
        await mongoose.disconnect();
    }
}

run().catch((err) => {
    console.error('❌ Failed:', err.message);
    process.exit(1);
});
