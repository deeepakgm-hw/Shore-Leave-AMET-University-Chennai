const crypto = require('crypto');

class FingerprintError extends Error {
  constructor(message, { code = 'FINGERPRINT_ERROR', statusCode = 500, details = null } = {}) {
    super(message);
    this.name = 'FingerprintError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

function getEncryptionKey() {
  const secret = String(process.env.FINGERPRINT_ENCRYPTION_KEY || '');
  if (secret.length < 32) {
    throw new FingerprintError(
      'Fingerprint encryption is not configured.',
      { code: 'FINGERPRINT_ENCRYPTION_NOT_CONFIGURED', statusCode: 503 }
    );
  }
  return crypto.createHash('sha256').update(secret, 'utf8').digest();
}

function isEncryptionConfigured() {
  return String(process.env.FINGERPRINT_ENCRYPTION_KEY || '').length >= 32;
}

function encryptTemplate(template) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(String(template), 'utf8'),
    cipher.final()
  ]);
  return {
    encryptedTemplate: encrypted.toString('base64'),
    encryptionIv: iv.toString('base64'),
    encryptionTag: cipher.getAuthTag().toString('base64'),
    templateHash: crypto.createHash('sha256').update(String(template), 'utf8').digest('hex')
  };
}

function decryptTemplate(record) {
  try {
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      getEncryptionKey(),
      Buffer.from(record.encryptionIv, 'base64')
    );
    decipher.setAuthTag(Buffer.from(record.encryptionTag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(record.encryptedTemplate, 'base64')),
      decipher.final()
    ]).toString('utf8');
  } catch (error) {
    throw new FingerprintError(
      'Stored fingerprint credential could not be decrypted.',
      { code: 'FINGERPRINT_CREDENTIAL_INVALID', statusCode: 500 }
    );
  }
}

function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '')
    .split(',')[0]
    .trim();
}

function publicError(error) {
  const safeServiceMessages = {
    FINGERPRINT_ADAPTER_OFFLINE: 'Fingerprint adapter is offline. Restart the backend and retry.',
    FINGERPRINT_ADAPTER_TIMEOUT: 'Fingerprint adapter timed out. Please retry the capture.',
    FINGERPRINT_DEVICE_OFFLINE: 'Fingerprint scanner is disconnected. Reconnect it and press Refresh.',
    DEVICE_OFFLINE: 'Fingerprint scanner is disconnected. Reconnect it and press Refresh.',
    FINGERPRINT_CAPTURE_REJECTED: 'Fingerprint capture was rejected by the scanner. Clean the sensor and place the finger again.',
    FINGERPRINT_CAPTURE_FAILED: 'Fingerprint capture did not complete. Place the finger firmly on the sensor and retry.',
    FINGERPRINT_TEMPLATE_MISSING: 'The scanner did not return a fingerprint template. Please retry.'
  };
  return {
    success: false,
    code: error.code || 'FINGERPRINT_ERROR',
    message: safeServiceMessages[error.code]
      || (error.statusCode && error.statusCode < 500
        ? error.message
        : 'Fingerprint service could not complete the request.'),
    ...(error.details ? { details: error.details } : {})
  };
}

module.exports = {
  FingerprintError,
  isEncryptionConfigured,
  encryptTemplate,
  decryptTemplate,
  clientIp,
  publicError
};
