const NFCCounter = require('../models/NFCCounter');

async function generateNFCCode() {
  const year = new Date().getFullYear();
  const counter = await NFCCounter.findOneAndUpdate(
    { year },
    { $inc: { counter: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return `AMET-CDT-${String(year).slice(-2)}-${String(counter.counter).padStart(4, '0')}`;
}

module.exports = { generateNFCCode };
