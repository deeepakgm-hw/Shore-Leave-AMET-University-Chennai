const mongoose = require('mongoose');

const FingerprintTemplateSchema = new mongoose.Schema({
  cadetId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Cadet',
    required: true,
    unique: true,
    index: true
  },
  roll: { type: String, required: true, index: true },
  encryptedTemplate: { type: String, required: true, select: false },
  encryptionIv: { type: String, required: true, select: false },
  encryptionTag: { type: String, required: true, select: false },
  templateHash: { type: String, required: true, select: false },
  templateVersion: { type: String, default: 'MFS110' },
  deviceModel: { type: String, default: 'Mantra MFS110' },
  deviceSerial: String,
  sdkVersion: String,
  captureQuality: Number,
  enrolledBy: { type: String, required: true },
  enrolledAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  lastVerifiedAt: Date,
  verificationCount: { type: Number, default: 0 },
  failedVerificationCount: { type: Number, default: 0 },
  status: {
    type: String,
    enum: ['ACTIVE', 'REMOVED'],
    default: 'ACTIVE',
    index: true
  }
}, {
  collection: 'fingerprint_templates',
  versionKey: false
});

FingerprintTemplateSchema.index({ roll: 1, status: 1 });

module.exports = mongoose.models.FingerprintTemplate
  || mongoose.model('FingerprintTemplate', FingerprintTemplateSchema);
