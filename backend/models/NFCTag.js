const mongoose = require('mongoose');

const previousTagSchema = new mongoose.Schema({
  uid: String,
  assignedAt: Date,
  assignedBy: String,
  deactivatedAt: Date,
  reason: String,
  status: { type: String, enum: ['REPLACED', 'LOST', 'DISABLED'], default: 'REPLACED' }
}, { _id: false });

const nfcTagSchema = new mongoose.Schema({
  uid: { type: String, required: true, unique: true, trim: true, lowercase: true },
  nfcCode: { type: String, required: true, unique: true },
  cadetId: { type: String, required: true, unique: true, index: true },
  cadetName: String,
  rollNumber: { type: String, index: true },
  active: { type: Boolean, default: true, index: true },
  enrolledAt: { type: Date, default: Date.now },
  enrolledBy: String,
  lastUsed: Date,
  useCount: { type: Number, default: 0 },
  previousTags: { type: [previousTagSchema], default: [] }
}, { timestamps: true, collection: 'nfc_tags' });

module.exports = mongoose.models.NFCTag || mongoose.model('NFCTag', nfcTagSchema);
