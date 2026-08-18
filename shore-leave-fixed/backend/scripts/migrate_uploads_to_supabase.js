require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs/promises');
const path = require('path');
const mongoose = require('mongoose');
const { uploadBuffer, verifyObjectExists } = require('../services/supabaseStorage');

const uploadsDir = path.join(__dirname, '..', 'uploads');

function targetFor(filename) {
  const lower = filename.toLowerCase();
  if (lower.startsWith('face_')) return { bucket: 'face-images', folder: 'enrollments' };
  if (lower.startsWith('leave_doc_')) return { bucket: 'verification-images', folder: 'leave-documents' };
  if (/_bulk_in\./i.test(filename)) return { bucket: 'verification-images', folder: 'bulk-check-in' };
  if (/_out\./i.test(filename)) return { bucket: 'verification-images', folder: 'check-out' };
  return { bucket: 'verification-images', folder: 'check-in' };
}

function contentTypeFor(filename) {
  const extension = path.extname(filename).toLowerCase();
  if (extension === '.png') return 'image/png';
  if (extension === '.webp') return 'image/webp';
  if (extension === '.pdf') return 'application/pdf';
  return 'image/jpeg';
}

async function replaceMongoUrls(db, localUrl, publicUrl) {
  const cadets = db.collection('cadets');
  const leaveRecords = db.collection('leaverecords');
  await Promise.all([
    cadets.updateMany({ photoUrl: localUrl }, { $set: { photoUrl: publicUrl } }),
    cadets.updateMany({ 'faceImages.front': localUrl }, { $set: { 'faceImages.front': publicUrl } }),
    cadets.updateMany({ 'faceImages.left': localUrl }, { $set: { 'faceImages.left': publicUrl } }),
    cadets.updateMany({ 'faceImages.right': localUrl }, { $set: { 'faceImages.right': publicUrl } }),
    cadets.updateMany({ 'pendingLeave.documentUrl': localUrl }, { $set: { 'pendingLeave.documentUrl': publicUrl } }),
    leaveRecords.updateMany({ checkOutPhotoUrl: localUrl }, { $set: { checkOutPhotoUrl: publicUrl } }),
    leaveRecords.updateMany({ checkInPhotoUrl: localUrl }, { $set: { checkInPhotoUrl: publicUrl } }),
    leaveRecords.updateMany({ leaveDocumentUrl: localUrl }, { $set: { leaveDocumentUrl: publicUrl } })
  ]);
}

async function main() {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) throw new Error('MONGODB_URI is required');
  await mongoose.connect(mongoUri);
  const files = await fs.readdir(uploadsDir).catch(error => error.code === 'ENOENT' ? [] : Promise.reject(error));
  let migrated = 0;

  for (const filename of files) {
    const filePath = path.join(uploadsDir, filename);
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) continue;
    const target = targetFor(filename);
    const objectPath = `legacy/${target.folder}/${filename}`;
    const uploaded = await uploadBuffer({
      bucket: target.bucket,
      objectPath,
      buffer: await fs.readFile(filePath),
      contentType: contentTypeFor(filename)
    });
    if (!await verifyObjectExists(uploaded.bucket, uploaded.path)) {
      throw new Error(`Could not verify ${uploaded.bucket}/${uploaded.path}`);
    }
    await replaceMongoUrls(mongoose.connection.db, `/uploads/${filename}`, uploaded.publicUrl);
    if (process.env.DELETE_LOCAL_AFTER_MIGRATION === 'true') await fs.unlink(filePath);
    migrated += 1;
    console.log('[MIGRATION] File uploaded and database references updated.');
  }

  console.log(`[MIGRATION] Completed ${migrated} file(s)`);
  await mongoose.disconnect();
}

main().catch(async error => {
  console.error('[MIGRATION] Failed.', { code: error?.code || 'MIGRATION_FAILED' });
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});
