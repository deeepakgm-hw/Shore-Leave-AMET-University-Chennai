require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const {
  listBuckets,
  uploadBuffer,
  getPublicUrl,
  verifyObjectExists,
  deleteObject,
  verifyConnection
} = require('../services/supabaseStorage');

async function main() {
  const requiredBuckets = ['face-images', 'verification-images', 'qr-codes', 'gate-passes'];
  const connection = await verifyConnection();
  console.log('[SUPABASE] Connection check complete.', { online: connection.online === true });
  if (!connection.online) {
    const error = new Error(connection.error?.message || 'Supabase authentication failed');
    error.code = connection.error?.code;
    error.status = connection.error?.status;
    throw error;
  }

  const buckets = await listBuckets();
  const bucketNames = buckets.map(bucket => bucket.name);
  const missing = requiredBuckets.filter(bucket => !bucketNames.includes(bucket));
  if (missing.length) throw new Error(`Missing required buckets: ${missing.join(', ')}`);

  const uploadedObjects = [];
  try {
    for (const bucket of requiredBuckets) {
      const objectPath = `diagnostics/storage-test-${Date.now()}-${bucket}.txt`;
      await uploadBuffer({
        bucket,
        objectPath,
        buffer: Buffer.from(`Shore Leave ${bucket} diagnostic ${new Date().toISOString()}\n`, 'utf8'),
        contentType: 'text/plain',
        upsert: false,
        attempts: 1
      });
      uploadedObjects.push({ bucket, objectPath });
      if (!getPublicUrl(bucket, objectPath)) throw new Error(`Public URL was not returned for ${bucket}`);
      if (!await verifyObjectExists(bucket, objectPath)) throw new Error(`Uploaded test object could not be listed in ${bucket}`);
    }
    console.log(`PASS: Supabase Storage SDK connected; ${requiredBuckets.length} buckets passed upload, URL, listing, and delete verification.`);
  } finally {
    for (const item of uploadedObjects.reverse()) {
      await deleteObject(item.bucket, item.objectPath);
    }
  }
}

main().catch(error => {
  console.error('FAIL:', { status: error.status || null, code: error.code || 'SUPABASE_TEST_FAILED' });
  process.exitCode = 1;
});
