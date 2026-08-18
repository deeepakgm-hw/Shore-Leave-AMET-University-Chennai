const { FingerprintProvider } = require('./FingerprintProvider');
const { FingerprintError } = require('../utils');

const DEFAULT_TIMEOUT_MS = 30_000;

class BridgeFingerprintProvider extends FingerprintProvider {
  constructor({ logger = console } = {}) {
    super({ logger });
    this.baseUrl = String(process.env.MANTRA_MFS110_BRIDGE_URL || '').replace(/\/+$/, '');
    this.deviceType = String(process.env.FINGERPRINT_DEVICE_TYPE || 'MANTRA_MFS110').trim();
    this.deviceLabel = String(process.env.FINGERPRINT_DEVICE_LABEL || 'Mantra MFS110').trim();
    this.bridgeToken = String(process.env.FINGERPRINT_BRIDGE_TOKEN || '').trim();
    this.timeoutMs = Math.max(3_000, Number(process.env.FINGERPRINT_CAPTURE_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS);
    this.lastStatus = {
      connected: false,
      configured: !!this.baseUrl,
      provider: this.deviceType,
      providerMode: 'BRIDGE',
      deviceModel: this.deviceLabel,
      serialNumber: null,
      sdkVersion: null,
      checkedAt: null,
      code: this.baseUrl ? 'DEVICE_OFFLINE' : 'BRIDGE_NOT_CONFIGURED'
    };
  }

  endpoint(name, fallback) {
    return process.env[name] || `${this.baseUrl}${fallback}`;
  }

  async request(url, options = {}) {
    if (!this.baseUrl) {
      throw new FingerprintError('Mantra fingerprint bridge is not configured.', {
        code: 'FINGERPRINT_BRIDGE_NOT_CONFIGURED',
        statusCode: 503
      });
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          'content-type': 'application/json',
          ...(this.bridgeToken ? { authorization: `Bearer ${this.bridgeToken}` } : {}),
          ...(options.headers || {})
        },
        signal: controller.signal
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new FingerprintError(payload.message || 'Fingerprint device request failed.', {
          code: payload.code || 'FINGERPRINT_DEVICE_ERROR',
          statusCode: response.status >= 500 ? 503 : response.status
        });
      }
      return payload;
    } catch (error) {
      if (error instanceof FingerprintError) throw error;
      const timedOut = error.name === 'AbortError';
      throw new FingerprintError(
        timedOut ? 'Fingerprint capture timed out.' : 'Fingerprint scanner is unavailable.',
        {
          code: timedOut ? 'FINGERPRINT_CAPTURE_TIMEOUT' : 'FINGERPRINT_DEVICE_UNAVAILABLE',
          statusCode: 503
        }
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async status() {
    if (!this.baseUrl) return this.lastStatus;
    try {
      const payload = await this.request(this.endpoint('MANTRA_STATUS_ENDPOINT', '/status'), { method: 'GET' });
      const connected = payload.connected === true && String(payload.status || '').toUpperCase() === 'ONLINE';
      this.lastStatus = {
        connected,
        configured: true,
        provider: payload.provider || this.deviceType,
        providerMode: 'BRIDGE',
        deviceModel: payload.deviceModel || payload.device || this.deviceLabel,
        serialNumber: payload.serialNumber || payload.serial || null,
        sdkVersion: payload.sdkVersion || payload.version || null,
        checkedAt: new Date().toISOString(),
        code: connected ? 'ONLINE' : 'DEVICE_OFFLINE'
      };
    } catch (error) {
      this.lastStatus = {
        ...this.lastStatus,
        connected: false,
        checkedAt: new Date().toISOString(),
        code: error.code || 'DEVICE_OFFLINE'
      };
    }
    return this.lastStatus;
  }

  async capture() {
    const payload = await this.request(this.endpoint('MANTRA_CAPTURE_ENDPOINT', '/capture'), {
      method: 'POST',
      body: JSON.stringify({
        deviceType: this.deviceType,
        device: 'MFS110',
        format: 'ISO_TEMPLATE',
        timeoutMs: this.timeoutMs,
        includeImage: false
      })
    });
    const template = payload.template || payload.isoTemplate || payload.templateData;
    if (!template || typeof template !== 'string') {
      throw new FingerprintError('Scanner did not return a fingerprint template.', {
        code: 'FINGERPRINT_TEMPLATE_MISSING',
        statusCode: 422
      });
    }
    return {
      template,
      quality: Number(payload.quality) || null,
      templateVersion: payload.templateVersion || payload.format || 'ISO',
      provider: payload.provider || this.deviceType,
      providerMode: 'BRIDGE',
      deviceModel: payload.deviceModel || this.deviceLabel,
      deviceSerial: payload.serialNumber || payload.deviceSerial || null,
      sdkVersion: payload.sdkVersion || null
    };
  }

  async match(storedTemplate, liveTemplate) {
    const payload = await this.request(this.endpoint('MANTRA_MATCH_ENDPOINT', '/match'), {
      method: 'POST',
      body: JSON.stringify({
        deviceType: this.deviceType,
        device: 'MFS110',
        storedTemplate,
        liveTemplate
      })
    });
    return {
      matched: payload.matched === true || payload.match === true,
      score: Number(payload.score) || 0,
      threshold: Number(payload.threshold) || Number(process.env.FINGERPRINT_MATCH_THRESHOLD) || null
    };
  }
}

module.exports = { BridgeFingerprintProvider };
