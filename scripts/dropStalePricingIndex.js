/**
 * One-time migration: drop stale MongoDB index on productpricings collection.
 * 
 * Background: The ProductPricing schema was migrated from level-based pricing
 * ({ productId, level } unique) to member-based pricing ({ productId, memberId } unique).
 * The old index `productid_1_level_1` still exists in the database and causes
 * E11000 duplicate key errors when upserting new member-specific prices because
 * the `level` field is always `null` in the new schema.
 *
 * This script runs once on startup and is safe to call repeatedly.
 */
const mongoose = require('mongoose');

async function dropStalePricingIndex() {
    try {
        const collection = mongoose.connection.collection('productpricings');
        const indexes = await collection.indexes();

        const staleIndex = indexes.find(
            (idx) => idx.name === 'productid_1_level_1' || idx.name === 'productId_1_level_1'
        );

        if (staleIndex) {
            await collection.dropIndex(staleIndex.name);
            console.log(`✅ Dropped stale index "${staleIndex.name}" from productpricings`);
        } else {
            console.log('ℹ️  No stale productid_1_level_1 index found — nothing to drop.');
        }
    } catch (error) {
        // Index might have been already dropped — this is fine
        if (error.codeName === 'IndexNotFound') {
            console.log('ℹ️  Index already dropped — skipping.');
        } else {
            console.error('⚠️  Failed to drop stale pricing index:', error.message);
        }
    }
}

module.exports = dropStalePricingIndex;
