require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const mongoose = require('mongoose');

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('MONGODB_URI is not configured');

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  const db = mongoose.connection.db;
  const collections = ['otps', 'gate_otps', 'nfctokens', 'sessions'];

  for (const name of collections) {
    const exists = await db.listCollections({ name }).hasNext();
    if (!exists) {
      console.log(`${name}: collection missing`);
      continue;
    }
    const indexes = await db.collection(name).indexes();
    const expiresAt = indexes.find(index => index.name === 'expiresAt_1' || JSON.stringify(index.key) === JSON.stringify({ expiresAt: 1 }));
    if (!expiresAt) {
      console.log(`${name}: expiresAt_1 missing`);
      continue;
    }
    console.log(`${name}: ${JSON.stringify({
      name: expiresAt.name,
      key: expiresAt.key,
      expireAfterSeconds: expiresAt.expireAfterSeconds,
      unique: expiresAt.unique,
      sparse: expiresAt.sparse
    })}`);
  }
}

main()
  .catch(error => {
    console.error('Index inspection failed.', { code: error?.code || 'INDEX_INSPECTION_FAILED' });
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });
