const mongoose = require('mongoose');

const deviceConfigSchema = new mongoose.Schema({
  deviceId: { type: String, required: true, unique: true, default: 'gate-1' },
  deviceName: { type: String, required: true, default: 'Gate-1' },
  reader: { type: String, required: true, default: 'ACS ACR122U' },
  location: { type: String, required: true, default: 'Main Gate' },
  enabled: { type: Boolean, default: true },
  mode: {
    type: String,
    enum: ['REGISTRATION', 'ATTENDANCE', 'GATE_ENTRY', 'VERIFICATION'],
    default: 'GATE_ENTRY'
  },
  updatedBy: String
}, { timestamps: true, collection: 'device_configs' });

module.exports = mongoose.models.DeviceConfig || mongoose.model('DeviceConfig', deviceConfigSchema);
