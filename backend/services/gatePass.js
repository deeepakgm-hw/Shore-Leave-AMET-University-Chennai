const PDFDocument = require('pdfkit');
const crypto = require('crypto');
const { safePathPart, uploadBuffer } = require('./supabaseStorage');

function formatDate(dateValue) {
  if (!dateValue) return '-';
  return new Date(dateValue).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getEmergencyCode(pass) {
  return pass.emergencyVerificationCode || pass.emergencyCode || pass.passVerificationToken || '-';
}

function renderGatePassEmailHtml(pass) {
  const gatePassPdfUrl = escapeHtml(pass.gatePassPdfSignedUrl || pass.gatePassPdfUrl || pass.gatePassUrl || '#');
  const emergencyCode = escapeHtml(getEmergencyCode(pass));

  return `
    <div style="font-family:Inter,Arial,sans-serif;background:#f5f7fb;padding:24px;color:#10214d;">
      <div style="max-width:680px;margin:0 auto;background:#ffffff;border:1px solid #d9e2f1;border-radius:20px;overflow:hidden;">
        <div style="padding:26px 28px;background:#10214d;color:#ffffff;">
          <div style="font-size:13px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;opacity:0.78;">AMET Campus Leave System</div>
          <div style="margin-top:8px;font-size:28px;font-weight:800;">Gate Pass Approved</div>
          <div style="margin-top:8px;font-size:16px;opacity:0.88;">Safe Journey</div>
        </div>
        <div style="padding:26px 28px;">
          <p style="margin:0 0 18px;font-size:15px;line-height:1.65;">
            Your leave request has been approved by the Duty Officer. Your gate pass PDF is attached to this email.
            Primary gate authentication is fingerprint verification. Face verification is available as fallback.
          </p>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:18px;">
            <div style="padding:14px 16px;border-radius:14px;background:#f8fafc;border:1px solid #e2e8f0;">
              <div style="font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#64748b;">Cadet</div>
              <div style="margin-top:6px;font-size:18px;font-weight:800;color:#10214d;">${escapeHtml(pass.name)}</div>
              <div style="margin-top:4px;font-size:13px;color:#475569;">${escapeHtml(pass.roll)}</div>
            </div>
            <div style="padding:14px 16px;border-radius:14px;background:#f8fafc;border:1px solid #e2e8f0;">
              <div style="font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#64748b;">Pass Number</div>
              <div style="margin-top:6px;font-size:18px;font-weight:800;color:#10214d;">${escapeHtml(pass.passId)}</div>
              <div style="margin-top:4px;font-size:13px;color:#475569;">${escapeHtml(pass.leaveType)}</div>
            </div>
          </div>
          <div style="padding:18px;border-radius:18px;background:#fff7ed;border:1px solid #fed7aa;margin-bottom:18px;">
            <div style="font-size:11px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:#9a3412;">Emergency Verification Code</div>
            <div style="margin-top:8px;font-size:24px;font-weight:900;letter-spacing:1px;color:#10214d;">${emergencyCode}</div>
            <div style="margin-top:8px;font-size:13px;line-height:1.5;color:#475569;">
              This code is for gate officer emergency use only when fingerprint and face verification cannot be completed.
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:18px;">
            <div style="padding:14px 16px;border-radius:14px;background:#f8fafc;border:1px solid #e2e8f0;">
              <div style="font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#64748b;">From</div>
              <div style="margin-top:6px;font-size:16px;font-weight:800;color:#10214d;">${escapeHtml(formatDate(pass.fromDate))}</div>
            </div>
            <div style="padding:14px 16px;border-radius:14px;background:#f8fafc;border:1px solid #e2e8f0;">
              <div style="font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#64748b;">To</div>
              <div style="margin-top:6px;font-size:16px;font-weight:800;color:#10214d;">${escapeHtml(formatDate(pass.toDate))}</div>
            </div>
          </div>
          <div style="margin-top:22px;text-align:center;">
            <a href="${gatePassPdfUrl}" style="display:inline-block;padding:14px 22px;border-radius:999px;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:700;">Download Gate Pass PDF</a>
          </div>
        </div>
      </div>
    </div>`;
}

async function createGatePassAssets(pass) {
  const generatedAt = pass.generatedAt ? new Date(pass.generatedAt) : new Date();
  const year = String(generatedAt.getUTCFullYear());
  const month = String(generatedAt.getUTCMonth() + 1).padStart(2, '0');
  const safePassId = safePathPart(pass.passId, 'gate-pass');
  const pdfObjectPath = `${year}/${month}/${safePassId}.pdf`;

  const pdfBuffer = await createGatePassPdf(pass);
  if (pdfBuffer.length < 100 || pdfBuffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw new Error('Generated gate pass PDF is invalid or empty');
  }

  const pdfUpload = await uploadBuffer({
    bucket: 'gate-passes',
    objectPath: pdfObjectPath,
    buffer: pdfBuffer,
    contentType: 'application/pdf'
  });

  return {
    gatePassPdfUrl: pdfUpload.publicUrl,
    gatePassPdfSignedUrl: pdfUpload.signedUrl,
    pdfBuffer,
    gatePass: {
      ...pdfUpload,
      sha256: crypto.createHash('sha256').update(pdfBuffer).digest('hex'),
      emergencyVerificationCode: getEmergencyCode(pass),
      uploaded: true
    },
    gatePassEmailHtml: renderGatePassEmailHtml({
      ...pass,
      gatePassPdfUrl: pdfUpload.publicUrl,
      gatePassPdfSignedUrl: pdfUpload.signedUrl
    })
  };
}

function createGatePassPdf(pass) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: `Gate Pass ${pass.passId}` } });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const emergencyCode = getEmergencyCode(pass);

    doc.rect(24, 24, 547, 794).lineWidth(2).stroke('#10214d');
    doc.fillColor('#10214d').fontSize(22).font('Helvetica-Bold').text('AMET CAMPUS LEAVE PASS', { align: 'center' });
    doc.moveDown(0.4).fontSize(11).font('Helvetica').text('Duty Officer Approved Campus Exit Pass', { align: 'center' });
    doc.moveDown(1.2);

    const rows = [
      ['Pass Number', pass.passId],
      ['Emergency Code', emergencyCode],
      ['Cadet Name', pass.name],
      ['Registration No.', pass.roll],
      ['Cadet ID', pass.studentId || pass.idNo || pass.roll],
      ['Course', pass.course || pass.batch || '-'],
      ['Leave Type', pass.leaveType || '-'],
      ['Reason', pass.reason || 'Not specified'],
      ['From', formatDate(pass.fromDate)],
      ['To', formatDate(pass.toDate)],
      ['Approved By', pass.issuedBy || 'Duty Officer'],
      ['Status', pass.passStatusText || 'ACTIVE']
    ];

    rows.forEach(([label, value]) => {
      doc.font('Helvetica-Bold').fontSize(11).text(`${label}:`, { continued: true, width: 150 });
      doc.font('Helvetica').text(` ${String(value || '-')}`);
      doc.moveDown(0.42);
    });

    doc.moveDown(0.8);
    doc.roundedRect(48, doc.y, 499, 92, 12).fillAndStroke('#fff7ed', '#fed7aa');
    doc.fillColor('#9a3412').font('Helvetica-Bold').fontSize(10).text('EMERGENCY VERIFICATION CODE', 68, doc.y + 18);
    doc.fillColor('#10214d').fontSize(22).text(emergencyCode, 68, doc.y + 4);
    doc.fillColor('#475569').font('Helvetica').fontSize(9).text(
      'For officer use only when fingerprint verification and face fallback are unavailable. Officer must record a reason before using this code.',
      68,
      doc.y + 6,
      { width: 460 }
    );

    doc.moveDown(4.2);
    doc.fillColor('#10214d').font('Helvetica-Bold').fontSize(12).text('Authentication hierarchy');
    doc.moveDown(0.4);
    doc.font('Helvetica').fontSize(10).text('1. Fingerprint verification is the primary gate method.');
    doc.text('2. Face verification is the fallback method.');
    doc.text('3. Emergency verification code is used only by an authorized officer with a recorded reason.');
    doc.moveDown(0.7);
    doc.font('Helvetica-Bold').fontSize(12).text('Instructions');
    doc.moveDown(0.4);
    doc.font('Helvetica').fontSize(10).text('Carry this pass with your student ID whenever you exit or re-enter campus.');
    doc.text('Return within the approved window. Late returns are logged and reported.');
    doc.text('This pass is valid only for the dates and purpose mentioned above.');

    doc.end();
  });
}

module.exports = {
  createGatePassAssets,
  formatDate
};
