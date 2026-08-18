require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('MONGODB_URI is required');
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  const db = mongoose.connection.db;
  const cadets = db.collection('cadets');
  const [total, missingState, assignedCards, stateSummary, gateIndexes] = await Promise.all([
    cadets.countDocuments(),
    cadets.countDocuments({
      $or: [
        { attendanceStatus: { $exists: false } },
        { leaveStatus: { $exists: false } },
        { gateStatus: { $exists: false } }
      ]
    }),
    cadets.countDocuments({ 'nfc.assigned': true, 'nfc.uid': { $type: 'string' } }),
    cadets.aggregate([
      { $group: { _id: { attendance: '$attendanceStatus', leave: '$leaveStatus', gate: '$gateStatus' }, count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]).toArray(),
    db.collection('gate_history').indexes()
  ]);
  console.log(JSON.stringify({ totalCadets: total, cadetsMissingGateState: missingState, assignedCards, stateSummary, gateHistoryIndexes: gateIndexes.map(index => index.name) }, null, 2));
  if (missingState !== 0) process.exitCode = 1;
  await mongoose.disconnect();
}

main().catch(async error => {
  console.error('FAIL: Gate migration verification failed.', { code: error?.code || 'GATE_MIGRATION_TEST_FAILED' });
  process.exitCode = 1;
  await mongoose.disconnect().catch(() => {});
});
