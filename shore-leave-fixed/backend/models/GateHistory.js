const mongoose = require('mongoose');

const gateHistorySchema = new mongoose.Schema({
  uid: { type: String, required: true, index: true },
  cadetId: { type: String, default: null, index: true },
  cadetName: String,
  gate: { type: String, required: true, default: 'Gate-1', index: true },
  location: String,
  reader: String,
  direction: { type: String, enum: ['ENTRY', 'EXIT', 'UNKNOWN'], default: 'UNKNOWN', index: true },
  decision: { type: String, enum: ['ALLOWED', 'DENIED'], required: true, index: true },
  action: { type: String, enum: ['CHECK_IN', 'CHECK_OUT', 'NONE'], default: 'NONE' },
  reason: { type: String, required: true },
  leaveId: { type: mongoose.Schema.Types.ObjectId, default: null },
  leaveStatus: String,
  attendanceStatus: String,
  metadata: { type: Object, default: {} },
  timestamp: { type: Date, default: Date.now, index: true }
}, { collection: 'gate_history' });

gateHistorySchema.index({ cadetId: 1, timestamp: -1 });
gateHistorySchema.index({ gate: 1, timestamp: -1 });

module.exports = mongoose.models.GateHistory || mongoose.model('GateHistory', gateHistorySchema);
