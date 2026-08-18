const mongoose = require('mongoose');

const nfcCounterSchema = new mongoose.Schema({
  year: { type: Number, required: true, unique: true },
  counter: { type: Number, default: 0 }
}, { collection: 'nfc_counters' });

module.exports = mongoose.models.NFCCounter || mongoose.model('NFCCounter', nfcCounterSchema);
