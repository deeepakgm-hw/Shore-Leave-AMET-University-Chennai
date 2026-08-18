require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { uploadBuffer, verifyObjectExists } = require('../services/supabaseStorage');

async function main() {
  const objectPath = `verification/storage-check-${Date.now()}.png`;
  const onePixelPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64'
  );
  const uploaded = await uploadBuffer({
    bucket: 'face-images',
    objectPath,
    buffer: onePixelPng,
    contentType: 'image/png',
    upsert: false
  });
  const exists = await verifyObjectExists(uploaded.bucket, uploaded.path);
  if (!exists) throw new Error('Uploaded object could not be found in Supabase Storage');
  console.log(JSON.stringify({ success: true, bucket: uploaded.bucket, verified: true }));
}

main().catch(error => {
  console.error('[SUPABASE] Storage verification failed.', {
    code: error?.code || 'STORAGE_VERIFICATION_FAILED',
    status: error?.status || null
  });
  process.exitCode = 1;
});
