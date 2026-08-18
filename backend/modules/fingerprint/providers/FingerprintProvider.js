const { FingerprintError } = require('../utils');

class FingerprintProvider {
  constructor({ logger = console } = {}) {
    this.logger = logger;
  }

  async status() {
    throw new FingerprintError('Fingerprint provider status is not implemented.', {
      code: 'FINGERPRINT_PROVIDER_NOT_IMPLEMENTED',
      statusCode: 501
    });
  }

  async capture() {
    throw new FingerprintError('Fingerprint provider capture is not implemented.', {
      code: 'FINGERPRINT_PROVIDER_NOT_IMPLEMENTED',
      statusCode: 501
    });
  }

  async match() {
    throw new FingerprintError('Fingerprint provider match is not implemented.', {
      code: 'FINGERPRINT_PROVIDER_NOT_IMPLEMENTED',
      statusCode: 501
    });
  }
}

module.exports = { FingerprintProvider };
