require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const mongoose = require('mongoose');

async function main() {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) {
    throw new Error('MONGODB_URI (or legacy MONGO_URI) is required');
  }
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 10000 });

  const collection = mongoose.connection.db.collection('face_embeddings');
  const duplicateGroups = await collection.aggregate([
    {
      $group: {
        _id: '$cadetId',
        count: { $sum: 1 },
        docs: {
          $push: {
            _id: '$_id',
            enrolledAt: '$enrolledAt'
          }
        }
      }
    },
    { $match: { _id: { $ne: null }, count: { $gt: 1 } } }
  ]).toArray();

  let kept = 0;
  let deleted = 0;

  for (const group of duplicateGroups) {
    const sorted = group.docs.sort((a, b) => {
      const aTime = a.enrolledAt ? new Date(a.enrolledAt).getTime() : 0;
      const bTime = b.enrolledAt ? new Date(b.enrolledAt).getTime() : 0;
      return bTime - aTime;
    });
    const [latest, ...older] = sorted;
    const olderIds = older.map(doc => doc._id);
    if (!latest || olderIds.length === 0) continue;

    const result = await collection.deleteMany({ _id: { $in: olderIds } });
    kept += 1;
    deleted += result.deletedCount || 0;
    console.log(`[FACE CLEANUP] Processed one duplicate group; deleted ${result.deletedCount || 0} old record(s)`);
  }

  await collection.createIndex(
    { cadetId: 1 },
    { unique: true, partialFilterExpression: { cadetId: { $type: 'string' } } }
  );
  const total = await collection.countDocuments();

  console.log(`[FACE CLEANUP] Found ${duplicateGroups.length} duplicate cadetId group(s)`);
  console.log(`[FACE CLEANUP] Kept ${kept} most recent document(s)`);
  console.log(`[FACE CLEANUP] Deleted ${deleted} old duplicate document(s)`);
  console.log(`[FACE CLEANUP] face_embeddings count after cleanup: ${total}`);
}

main()
  .catch((error) => {
    console.error('[FACE CLEANUP] Failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });
