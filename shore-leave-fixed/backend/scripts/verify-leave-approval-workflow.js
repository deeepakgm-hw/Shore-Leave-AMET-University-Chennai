require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const crypto = require('crypto');
const mongoose = require('mongoose');
const nodemailer = require('nodemailer');
const { createGatePassAssets } = require('../services/gatePass');
const { getClient, verifyObjectExists } = require('../services/supabaseStorage');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function maskEmail(value) {
  const [name, domain] = String(value || '').split('@');
  if (!domain) return '(not configured)';
  return `${name.slice(0, 2)}***@${domain}`;
}

function buildTransporter() {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) return null;
  if (process.env.SMTP_HOST) {
    const port = Number(process.env.SMTP_PORT || 587);
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });
  }
  return nodemailer.createTransport({
    service: process.env.SMTP_SERVICE || 'gmail',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
}

async function verifyRemoteObject(asset, expectedBuffer) {
  assert(await verifyObjectExists(asset.bucket, asset.path), `${asset.bucket}/${asset.path} was not listed`);
  const { data, error } = await getClient().storage.from(asset.bucket).download(asset.path);
  assert(!error && data, `Could not download ${asset.bucket}/${asset.path}`);
  const downloaded = Buffer.from(await data.arrayBuffer());
  assert(downloaded.length === expectedBuffer.length, `Downloaded size mismatch for ${asset.path}`);
  assert(
    crypto.createHash('sha256').update(downloaded).digest('hex') === asset.sha256,
    `Downloaded checksum mismatch for ${asset.path}`
  );
  const response = await fetch(asset.signedUrl, { method: 'GET' });
  assert(response.ok, `Signed URL returned HTTP ${response.status} for ${asset.path}`);
}

async function main() {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const passId = `SL-TEST-${stamp}`;
  const emergencyVerificationCode = `AMET-SL-TEST-${stamp.slice(-6)}`;
  const pass = {
    passId,
    emergencyVerificationCode,
    name: 'Workflow Verification Cadet',
    roll: 'WORKFLOW-TEST',
    studentId: 'WORKFLOW-TEST',
    rank: 'CADET',
    course: 'SYSTEM VERIFICATION',
    leaveType: 'Shore Leave',
    reason: 'Automated gate pass workflow verification',
    fromDate: new Date(),
    toDate: new Date(Date.now() + 86400000),
    generatedAt: new Date(),
    issuedBy: 'Workflow Verification',
    passStatusText: 'TEST'
  };

  const assets = await createGatePassAssets(pass);
  assert(Buffer.isBuffer(assets.pdfBuffer), 'PDF buffer is missing');
  assert(assets.pdfBuffer.length > 0, 'PDF buffer is empty');
  assert(assets.pdfBuffer.subarray(0, 5).toString('ascii') === '%PDF-', 'PDF header is invalid');
  assert(assets.gatePass?.bucket === 'gate-passes', 'Gate pass was not uploaded to the gate-passes bucket');
  assert(assets.gatePass?.path, 'Gate pass storage path is missing');
  assert(assets.gatePass?.sha256, 'Gate pass checksum is missing');
  assert(assets.gatePassEmailHtml.includes(emergencyVerificationCode), 'Email HTML does not include the emergency code');
  assert(!/qr/i.test(assets.gatePassEmailHtml), 'Email HTML still references QR');

  await verifyRemoteObject(assets.gatePass, assets.pdfBuffer);

  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  assert(mongoUri, 'MONGODB_URI is not configured');
  await mongoose.connect(mongoUri);
  const testRecord = {
    roll: 'WORKFLOW-TEST',
    name: pass.name,
    email: process.env.TEST_EMAIL_TO || process.env.SMTP_USER,
    leaveType: pass.leaveType,
    leaveReason: pass.reason,
    approvalStatus: 'approved',
    status: 'workflow_test',
    passId,
    emergencyVerificationCode,
    emergencyCodeGeneratedAt: new Date(),
    emergencyCodeExpiresAt: pass.toDate,
    gatePassPdfUrl: assets.gatePassPdfUrl,
    gatePass: assets.gatePass,
    storageStatus: 'uploaded',
    storageUploadedAt: new Date(),
    workflowTest: true
  };
  const inserted = await mongoose.connection.db.collection('leaverecords').insertOne(testRecord);
  const persisted = await mongoose.connection.db.collection('leaverecords').findOne({ _id: inserted.insertedId });
  assert(persisted?.emergencyVerificationCode === emergencyVerificationCode, 'MongoDB emergency code metadata is missing');
  assert(persisted?.gatePass?.verified === true, 'MongoDB PDF metadata verification flag is missing');
  assert(persisted?.gatePass?.sha256 === assets.gatePass.sha256, 'MongoDB PDF checksum metadata mismatch');
  assert(persisted?.storageStatus === 'uploaded', 'MongoDB storage status is not uploaded');

  const recipient = process.env.TEST_EMAIL_TO || process.env.SMTP_USER;
  assert(recipient, 'TEST_EMAIL_TO or SMTP_USER is required for the email test');
  const attachments = [
    { filename: `${passId}.pdf`, content: assets.pdfBuffer, contentType: 'application/pdf' }
  ];
  const pdfAttachment = attachments.find(item => item.contentType === 'application/pdf');
  assert(pdfAttachment, 'Gate pass PDF attachment is missing');
  assert(pdfAttachment.filename === `${passId}.pdf`, 'Gate pass PDF filename is invalid');
  assert(Buffer.isBuffer(pdfAttachment.content) && pdfAttachment.content.length > 0, 'Gate pass PDF attachment is empty');

  const streamTransport = nodemailer.createTransport({ streamTransport: true, buffer: true });
  const mime = await streamTransport.sendMail({
    from: process.env.EMAIL_FROM || process.env.SMTP_USER || 'shoreleave-test@example.com',
    to: recipient,
    subject: `[TEST] Gate Pass ${passId}`,
    html: assets.gatePassEmailHtml,
    attachments
  });
  const mimeText = mime.message.toString('utf8');
  assert(mimeText.includes('Content-Type: application/pdf'), 'Email MIME does not contain a PDF attachment');
  assert(mimeText.includes(pdfAttachment.filename), 'Email MIME does not contain the expected PDF filename');
  assert(mimeText.includes(emergencyVerificationCode), 'Email MIME does not contain the emergency code');

  const transporter = buildTransporter();
  assert(transporter, 'SMTP is not configured for the authorized test email');
  await transporter.verify();
  const sent = await transporter.sendMail({
    from: process.env.EMAIL_FROM || process.env.SMTP_USER,
    to: recipient,
    subject: `[TEST] ShoreLeave Gate Pass ${passId}`,
    text: `Workflow verification gate pass ${passId}. Emergency code: ${emergencyVerificationCode}. PDF link: ${assets.gatePassPdfSignedUrl}`,
    html: assets.gatePassEmailHtml,
    attachments
  });

    console.log(JSON.stringify({
      success: true,
      recipient: maskEmail(recipient),
      gatePassStored: assets.gatePass?.uploaded === true,
      qrCodeStored: assets.qrCode?.uploaded === true,
      metadataPersisted: !!inserted.insertedId,
      pdfReadable: true,
      pdfAttachmentBytes: pdfAttachment.content.length,
    mimePdfAttached: true,
    emailMessageId: sent.messageId
  }, null, 2));
}

const keepAlive = setInterval(() => {}, 1000);

main()
  .catch(error => {
    console.error('[WORKFLOW TEST FAILED]', {
      code: error?.code || 'WORKFLOW_TEST_FAILED',
      status: error?.status || error?.statusCode || null
    });
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState) await mongoose.disconnect();
    clearInterval(keepAlive);
  });
