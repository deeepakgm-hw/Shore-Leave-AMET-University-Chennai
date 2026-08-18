require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs/promises');
const path = require('path');
const mongoose = require('mongoose');

const BACKUP_ROOT = path.join(__dirname, '..', 'backups');
const FACE_BACKUP_ROOT = path.join(BACKUP_ROOT, 'face');
const RETAIN_DAYS = Number(process.env.BACKUP_RETAIN_DAYS || 30);
const FACE_RETAIN_DAYS = Number(process.env.FACE_BACKUP_RETAIN_DAYS || 90);

function stamp() {
  return new Date().toISOString().slice(0, 10);
}

async function pruneOldBackups() {
  const entries = await fs.readdir(BACKUP_ROOT, { withFileTypes: true }).catch(() => []);
  const cutoff = Date.now() - RETAIN_DAYS * 24 * 60 * 60 * 1000;

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === 'face') continue;
    const fullPath = path.join(BACKUP_ROOT, entry.name);
    const stats = await fs.stat(fullPath).catch(() => null);
    if (stats && stats.mtimeMs < cutoff) {
      await fs.rm(fullPath, { recursive: true, force: true });
      console.log(`[BACKUP] Removed old backup ${entry.name}`);
    }
  }
}

async function pruneOldFaceBackups() {
  const entries = await fs.readdir(FACE_BACKUP_ROOT, { withFileTypes: true }).catch(() => []);
  const cutoff = Date.now() - FACE_RETAIN_DAYS * 24 * 60 * 60 * 1000;

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.startsWith('face_backup_') || !entry.name.endsWith('.json')) continue;
    const fullPath = path.join(FACE_BACKUP_ROOT, entry.name);
    const stats = await fs.stat(fullPath).catch(() => null);
    if (stats && stats.mtimeMs < cutoff) {
      await fs.rm(fullPath, { force: true });
      console.log(`[BACKUP] Removed old face backup ${entry.name}`);
    }
  }
}

async function backupFaceEmbeddings(db) {
  await fs.mkdir(FACE_BACKUP_ROOT, { recursive: true });
  const docs = await db.collection('face_embeddings').find({}).toArray();
  const targetFile = path.join(FACE_BACKUP_ROOT, `face_backup_${stamp()}.json`);
  await fs.writeFile(targetFile, JSON.stringify(docs, null, 2), 'utf8');
  console.log(`[BACKUP] face_embeddings dedicated backup: ${docs.length} document(s) -> ${targetFile}`);
  await pruneOldFaceBackups();
}

async function runBackup() {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) {
    throw new Error('MONGODB_URI (or legacy MONGO_URI) is required for backups');
  }
  const targetDir = path.join(BACKUP_ROOT, stamp());
  await fs.mkdir(targetDir, { recursive: true });
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 10000 });

  const collections = await mongoose.connection.db.listCollections().toArray();
  for (const collectionInfo of collections) {
    const name = collectionInfo.name;
    const docs = await mongoose.connection.db.collection(name).find({}).toArray();
    await fs.writeFile(
      path.join(targetDir, `${name}.json`),
      JSON.stringify(docs, null, 2),
      'utf8'
    );
    console.log(`[BACKUP] ${name}: ${docs.length} document(s)`);
  }

  await backupFaceEmbeddings(mongoose.connection.db);
  await pruneOldBackups();
  await mongoose.disconnect();
  console.log(`[BACKUP] Completed at ${targetDir}`);
}

runBackup().catch(async (error) => {
  console.error('[BACKUP] Failed.', { code: error?.code || 'BACKUP_FAILED' });
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});
