const crypto = require('crypto');
const { FingerprintProvider } = require('./FingerprintProvider');
const { FingerprintError } = require('../utils');

const DEFAULT_AVDM_URL = 'http://127.0.0.1:11100';
const DEFAULT_TIMEOUT_MS = 30_000;

function xmlValue(xml, tagName) {
  const match = String(xml || '').match(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i'));
  return match ? match[1].trim() : null;
}

function xmlAttr(xml, attrName) {
  const match = String(xml || '').match(new RegExp(`\\b${attrName}\\s*=\\s*["']([^"']+)["']`, 'i'));
  return match ? match[1].trim() : null;
}

function stableTemplate(seed) {
  return Buffer.from(
    crypto.createHash('sha256').update(String(seed || 'shoreleave-fingerprint-template')).digest('hex'),
    'utf8'
  ).toString('base64');
}

class MantraAvdmProvider extends FingerprintProvider {
  constructor({ logger = console } = {}) {
    super({ logger });
    this.avdmUrl = String(process.env.MANTRA_MFS110_AVDM_URL || DEFAULT_AVDM_URL).replace(/\/+$/, '');
    this.adapterUrl = String(
      process.env.MANTRA_MFS110_LOCAL_ADAPTER_URL
      || process.env.MANTRA_MFS110_BRIDGE_URL
      || ''
    ).replace(/\/+$/, '');
    this.deviceType = String(process.env.FINGERPRINT_DEVICE_TYPE || 'MANTRA_MFS110').trim();
    this.deviceLabel = String(process.env.FINGERPRINT_DEVICE_LABEL || 'Mantra MFS110').trim();
    this.timeoutMs = Math.max(3_000, Number(process.env.FINGERPRINT_CAPTURE_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS);
    this.nodeEnv = String(process.env.NODE_ENV || 'development').trim().toLowerCase();
    this.isProduction = this.nodeEnv === 'production';
    this.allowWorkflowAdapter = !this.isProduction
      && ['1', 'true', 'yes'].includes(String(process.env.FINGERPRINT_ALLOW_WORKFLOW_ADAPTER || 'false').toLowerCase());
    this.lastStatus = {
      connected: false,
      configured: true,
      provider: this.deviceType,
      providerMode: 'MANTRA_L1_AVDM',
      deviceModel: this.deviceLabel,
      serialNumber: null,
      sdkVersion: null,
      checkedAt: null,
      code: 'DEVICE_OFFLINE'
    };
  }

  async fetchWithTimeout(url, options = {}, requestTimeoutMs = this.timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  async adapterRequest(path, body) {
    if (!this.adapterUrl) {
      throw new FingerprintError('Fingerprint local adapter is not configured.', {
        code: 'FINGERPRINT_ADAPTER_NOT_CONFIGURED',
        statusCode: 503
      });
    }
    const adapterTimeoutMs = path === '/capture' ? this.timeoutMs + 3_000 : this.timeoutMs;
    let response;
    try {
      response = await this.fetchWithTimeout(`${this.adapterUrl}${path}`, {
        method: body ? 'POST' : 'GET',
        headers: { 'content-type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined
      }, adapterTimeoutMs);
    } catch (error) {
      const timedOut = error?.name === 'AbortError';
      throw new FingerprintError(
        timedOut
          ? 'Fingerprint adapter timed out. Please retry the capture.'
          : 'Fingerprint adapter is offline. Restart the backend and retry.',
        {
          code: timedOut ? 'FINGERPRINT_ADAPTER_TIMEOUT' : 'FINGERPRINT_ADAPTER_OFFLINE',
          statusCode: timedOut ? 504 : 503
        }
      );
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new FingerprintError(payload.message || 'Fingerprint local adapter request failed.', {
        code: payload.code || 'FINGERPRINT_ADAPTER_ERROR',
        statusCode: response.status >= 500 ? 503 : response.status,
        details: payload.details || null
      });
    }
    return payload;
  }

  async readAvdmDeviceInfo() {
    const response = await this.fetchWithTimeout(this.avdmUrl, { method: 'DEVICEINFO' });
    const xml = await response.text();
    if (!response.ok) {
      throw new FingerprintError('Mantra L1 AVDM service is not available.', {
        code: 'FINGERPRINT_AVDM_OFFLINE',
        statusCode: 503
      });
    }
    const status = xmlAttr(xml, 'dc') || xmlValue(xml, 'Resp') || xmlAttr(xml, 'status');
    const modality = xmlAttr(xml, 'mi') || xmlAttr(xml, 'modality') || xmlValue(xml, 'DeviceInfo');
    return {
      xml,
      status,
      modality,
      serialNumber: xmlAttr(xml, 'srno') || xmlAttr(xml, 'serialNumber') || null,
      sdkVersion: xmlAttr(xml, 'rdsVer') || xmlAttr(xml, 'version') || 'Mantra L1 AVDM',
      deviceModel: xmlAttr(xml, 'mi') || xmlAttr(xml, 'deviceModel') || this.deviceLabel
    };
  }

  async status() {
    // When configured, the local adapter is the capture authority. A running RD
    // service alone does not prove that HarborOS can capture a fingerprint.
    if (this.adapterUrl) {
      try {
        const payload = await this.adapterRequest('/status');
        const connected = payload.connected === true
          && String(payload.status || '').toUpperCase() === 'ONLINE';
        this.lastStatus = {
          connected,
          configured: true,
          provider: payload.provider || this.deviceType,
          providerMode: payload.providerMode || 'LOCAL_ADAPTER_WITH_AVDM',
          deviceModel: payload.deviceModel || this.deviceLabel,
          serialNumber: payload.serialNumber || null,
          sdkVersion: payload.sdkVersion || null,
          checkedAt: new Date().toISOString(),
          code: connected ? 'ONLINE' : (payload.code || 'DEVICE_OFFLINE'),
          adapter: { configured: true, online: true, code: payload.code || null }
        };
      } catch (error) {
        this.lastStatus = {
          ...this.lastStatus,
          connected: false,
          configured: true,
          checkedAt: new Date().toISOString(),
          code: error.code || 'FINGERPRINT_ADAPTER_OFFLINE',
          adapter: { configured: true, online: false, code: error.code || null }
        };
      }
      return this.lastStatus;
    }

    try {
      const avdm = await this.readAvdmDeviceInfo();
      const connected = Boolean(avdm.serialNumber || xmlAttr(avdm.xml, 'dc') || xmlAttr(avdm.xml, 'mc'));
      this.lastStatus = {
        connected,
        configured: true,
        provider: this.deviceType,
        providerMode: 'MANTRA_L1_AVDM',
        deviceModel: avdm.deviceModel || this.deviceLabel,
        serialNumber: avdm.serialNumber || null,
        sdkVersion: avdm.sdkVersion || null,
        checkedAt: new Date().toISOString(),
        code: connected ? 'ONLINE' : 'DEVICE_OFFLINE',
        adapter: { configured: false, online: null, code: null }
      };
    } catch (error) {
      this.lastStatus = {
        ...this.lastStatus,
        connected: false,
        checkedAt: new Date().toISOString(),
        code: error.code || 'DEVICE_OFFLINE',
        adapter: { configured: false, online: null, code: null }
      };
    }
    return this.lastStatus;
  }

  async capture() {
    if (this.adapterUrl) {
      const payload = await this.adapterRequest('/capture', {
        deviceType: this.deviceType,
        device: 'MFS110',
        format: 'ISO_TEMPLATE',
        timeoutMs: this.timeoutMs,
        includeImage: false
      });
      const template = payload.template || payload.isoTemplate || payload.templateData;
      if (!template || typeof template !== 'string') {
        throw new FingerprintError('Local adapter did not return a fingerprint template.', {
          code: 'FINGERPRINT_TEMPLATE_MISSING',
          statusCode: 422
        });
      }
      return {
        template,
        quality: Number(payload.quality) || null,
        templateVersion: payload.templateVersion || payload.format || 'ISO',
        provider: payload.provider || this.deviceType,
        providerMode: 'LOCAL_ADAPTER',
        deviceModel: payload.deviceModel || this.deviceLabel,
        deviceSerial: payload.serialNumber || payload.deviceSerial || null,
        sdkVersion: payload.sdkVersion || null
      };
    }

    const device = await this.status();
    if (!device.connected) {
      throw new FingerprintError('Fingerprint device is offline.', {
        code: 'FINGERPRINT_DEVICE_OFFLINE',
        statusCode: 503
      });
    }
    if (!this.allowWorkflowAdapter) {
      throw new FingerprintError(
        'Mantra L1 AVDM is online, but template capture requires the local adapter or official SDK.',
        { code: 'FINGERPRINT_CAPTURE_PROVIDER_REQUIRED', statusCode: 503 }
      );
    }

    const seed = process.env.FINGERPRINT_WORKFLOW_ADAPTER_TEMPLATE
      || `${this.deviceType}:${device.serialNumber || device.deviceModel || 'local-workflow'}`;
    return {
      template: stableTemplate(seed),
      quality: 80,
      templateVersion: 'WORKFLOW_ADAPTER_V1',
      provider: this.deviceType,
      providerMode: 'LOCAL_WORKFLOW_ADAPTER',
      deviceModel: device.deviceModel || this.deviceLabel,
      deviceSerial: device.serialNumber || null,
      sdkVersion: 'HarborOS-Workflow-Adapter'
    };
  }

  async match(storedTemplate, liveTemplate) {
    if (this.adapterUrl) {
      const payload = await this.adapterRequest('/verify', {
        deviceType: this.deviceType,
        device: 'MFS110',
        storedTemplate,
        liveTemplate
      });
      return {
        matched: payload.matched === true || payload.match === true,
        score: Number(payload.score) || 0,
        threshold: Number(payload.threshold) || Number(process.env.FINGERPRINT_MATCH_THRESHOLD) || 70
      };
    }

    const threshold = Number(process.env.FINGERPRINT_MATCH_THRESHOLD) || 70;
    const matched = String(storedTemplate || '') === String(liveTemplate || '');
    return {
      matched,
      score: matched ? 100 : 0,
      threshold
    };
  }
}

module.exports = { MantraAvdmProvider };
