const { BridgeFingerprintProvider } = require('./BridgeFingerprintProvider');
const { MantraAvdmProvider } = require('./MantraAvdmProvider');
const { FingerprintError } = require('../utils');

function createFingerprintProvider(options = {}) {
  const explicit = String(process.env.FINGERPRINT_PROVIDER || '').trim().toLowerCase();
  const hasBridge = !!String(process.env.MANTRA_MFS110_BRIDGE_URL || '').trim();

  if (explicit === 'bridge' || hasBridge) {
    return new BridgeFingerprintProvider(options);
  }

  if (explicit === 'mantra-avdm' || explicit === 'local-adapter' || explicit === 'current' || !explicit) {
    return new MantraAvdmProvider(options);
  }

  throw new FingerprintError(`Unsupported fingerprint provider: ${process.env.FINGERPRINT_PROVIDER}`, {
    code: 'FINGERPRINT_PROVIDER_UNSUPPORTED',
    statusCode: 503
  });
}

module.exports = {
  createFingerprintProvider,
  BridgeFingerprintProvider,
  MantraAvdmProvider
};
