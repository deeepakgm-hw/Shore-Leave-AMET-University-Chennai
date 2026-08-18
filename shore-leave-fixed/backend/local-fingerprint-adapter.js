require('dotenv').config();

const crypto = require('crypto');
const http = require('http');
const express = require('express');

const DEFAULT_AVDM_URL = 'http://127.0.0.1:11100';
const DEFAULT_PORT = 8791;
const DEFAULT_TIMEOUT_MS = 30_000;

const app = express();
app.use(express.json({ limit: '256kb' }));

const port = Number(process.env.FINGERPRINT_LOCAL_ADAPTER_PORT || DEFAULT_PORT);
const avdmUrl = String(process.env.MANTRA_MFS110_AVDM_URL || DEFAULT_AVDM_URL).replace(/\/+$/, '');
const timeoutMs = Math.max(3_000, Number(process.env.FINGERPRINT_CAPTURE_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS);

function xmlValue(xml, tagName) {
  const match = String(xml || '').match(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i'));
  return match ? match[1].trim() : null;
}

function xmlAttr(xml, attrName) {
  const match = String(xml || '').match(new RegExp(`\\b${attrName}\\s*=\\s*["']([^"']+)["']`, 'i'));
  return match ? match[1].trim() : null;
}

function xmlParamValue(xml, paramName) {
  const escapedName = String(paramName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(xml || '').match(new RegExp(
    `<Param\\b[^>]*\\bname\\s*=\\s*["']${escapedName}["'][^>]*\\bvalue\\s*=\\s*["']([^"']*)["']`,
    'i'
  ));
  return match ? match[1].trim() : null;
}

function errorPayload(code, message, status = 503, details = null) {
  return {
    success: false,
    status: 'OFFLINE',
    connected: false,
    provider: 'MANTRA_MFS110',
    providerMode: 'MANTRA_L1_AVDM_LOCAL_ADAPTER',
    code,
    message,
    ...(details ? { details } : {})
  };
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error.name === 'AbortError') {
      const timeoutError = new Error(`Mantra runtime timed out after ${timeoutMs}ms.`);
      timeoutError.code = 'FINGERPRINT_ADAPTER_TIMEOUT';
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function captureHttpRequest(url, body, requestTimeoutMs = timeoutMs) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = http.request({
      hostname: parsed.hostname,
      port: parsed.port || 80,
      path: `${parsed.pathname}${parsed.search || ''}`,
      method: 'CAPTURE',
      headers: {
        'Content-Type': 'text/xml',
        'Content-Length': Buffer.byteLength(body, 'utf8')
      },
      timeout: requestTimeoutMs
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({
        ok: res.statusCode >= 200 && res.statusCode < 300,
        status: res.statusCode,
        text: Buffer.concat(chunks).toString('utf8')
      }));
    });
    req.on('timeout', () => {
      req.destroy(Object.assign(new Error(`Mantra runtime timed out after ${requestTimeoutMs}ms.`), {
        code: 'FINGERPRINT_ADAPTER_TIMEOUT'
      }));
    });
    req.on('error', reject);
    req.write(body, 'utf8');
    req.end();
  });
}

async function readDeviceInfo() {
  const response = await fetchWithTimeout(avdmUrl, { method: 'DEVICEINFO' });
  const xml = await response.text();
  if (!response.ok) {
    const error = new Error('Mantra L1 AVDM runtime did not return device info.');
    error.code = 'FINGERPRINT_AVDM_DEVICEINFO_FAILED';
    error.details = { httpStatus: response.status };
    throw error;
  }

  const reportedModel = xmlAttr(xml, 'mi') || xmlAttr(xml, 'deviceModel');
  const serialNumber = xmlAttr(xml, 'srno') || xmlParamValue(xml, 'srno') || xmlAttr(xml, 'serialNumber');
  const deviceCode = xmlAttr(xml, 'dc');
  const modelCode = xmlAttr(xml, 'mc');
  const systemId = xmlParamValue(xml, 'sysid');

  // A running RD service is not proof that a scanner is attached. Mantra AVDM
  // returns HTTP 200 and modality_type=Finger even when the USB device is absent.
  const connected = Boolean(serialNumber || deviceCode || modelCode || systemId);

  return {
    success: connected,
    status: connected ? 'ONLINE' : 'OFFLINE',
    connected,
    provider: 'MANTRA_MFS110',
    providerMode: 'MANTRA_L1_AVDM_LOCAL_ADAPTER',
    deviceModel: reportedModel || 'Mantra MFS110',
    serialNumber: serialNumber || null,
    sdkVersion: xmlAttr(xml, 'rdsVer') || xmlAttr(xml, 'version') || 'Mantra L1 AVDM',
    checkedAt: new Date().toISOString(),
    code: connected ? 'ONLINE' : 'DEVICE_OFFLINE'
  };
}

async function discoverCaptureEndpoints() {
  try {
    const response = await fetchWithTimeout(avdmUrl, { method: 'RDSERVICE' });
    const xml = await response.text();
    if (!response.ok) {
      throw new Error(`RD service discovery failed with HTTP ${response.status}.`);
    }
    const capturePathMatch = String(xml || '').match(/<Interface[^>]+id\s*=\s*["']CAPTURE["'][^>]+path\s*=\s*["']([^"']+)["']/i);
    const capturePath = capturePathMatch ? capturePathMatch[1] : null;
    if (capturePath) {
      return [`${avdmUrl}${capturePath.startsWith('/') ? capturePath : `/${capturePath}`}`];
    }
  } catch (_error) {
    // Fall back to common RD paths below; the final error includes every attempted path.
  }
  return [
    `${avdmUrl}/rd/capture`,
    `${avdmUrl}/capture`,
    `${avdmUrl}/RDService/capture`
  ];
}

function buildPidOptions({ timeoutMs: requestedTimeoutMs } = {}) {
  const captureTimeout = Math.max(3_000, Number(requestedTimeoutMs) || timeoutMs);
  return [
    '<?xml version="1.0"?>',
    '<PidOptions ver="1.0">',
    `<Opts fCount="1" fType="2" iCount="0" pCount="0" format="0" pidVer="2.0" timeout="${captureTimeout}" posh="UNKNOWN" env="P"/>`,
    '</PidOptions>'
  ].join('');
}

function normalizeCapturedTemplate(xml) {
  const errCode = xmlAttr(xml, 'errCode');
  const errInfo = xmlAttr(xml, 'errInfo');
  if (errCode && errCode !== '0') {
    const error = new Error(errInfo || 'Mantra capture failed.');
    error.code = 'FINGERPRINT_CAPTURE_REJECTED';
    error.details = { errCode, errInfo };
    throw error;
  }

  const template = xmlValue(xml, 'Data');
  if (!template) {
    const error = new Error('Mantra capture response did not include fingerprint template data.');
    error.code = 'FINGERPRINT_TEMPLATE_MISSING';
    throw error;
  }

  return {
    template,
    quality: Number(xmlAttr(xml, 'qScore') || xmlAttr(xml, 'nmPoints') || 0) || null,
    templateVersion: xmlAttr(xml, 'type') || 'PID_DATA',
    captureHash: crypto.createHash('sha256').update(template, 'utf8').digest('hex')
  };
}

async function captureFromAvdm(body = {}) {
  const device = await readDeviceInfo();
  if (!device.connected) {
    const error = new Error('Mantra MFS110 device is offline.');
    error.code = 'FINGERPRINT_DEVICE_OFFLINE';
    throw error;
  }

  const captureTimeout = Math.max(3_000, Number(body.timeoutMs) || timeoutMs);
  const pidOptions = buildPidOptions({ timeoutMs: captureTimeout });
  const captureUrls = await discoverCaptureEndpoints();

  const failures = [];
  for (const url of captureUrls) {
    try {
      const response = await captureHttpRequest(url, pidOptions, captureTimeout + 1500);
      const xml = response.text;
      if (!response.ok) {
        failures.push({ url, status: response.status });
        continue;
      }
      const capture = normalizeCapturedTemplate(xml);
      return {
        success: true,
        status: 'CAPTURED',
        provider: device.provider,
        providerMode: device.providerMode,
        deviceModel: device.deviceModel,
        serialNumber: device.serialNumber,
        sdkVersion: device.sdkVersion,
        format: capture.templateVersion,
        template: capture.template,
        quality: capture.quality,
        captureHash: capture.captureHash,
        capturedAt: new Date().toISOString()
      };
    } catch (error) {
      failures.push({ url, code: error.code || error.name, message: error.message });
    }
  }

  const error = new Error('Mantra runtime was reachable, but fingerprint capture did not complete.');
  error.code = 'FINGERPRINT_CAPTURE_FAILED';
  error.details = failures;
  throw error;
}

function verifyTemplates({ storedTemplate, liveTemplate, threshold }) {
  if (!storedTemplate || !liveTemplate) {
    const error = new Error('Both storedTemplate and liveTemplate are required.');
    error.code = 'FINGERPRINT_VERIFY_PAYLOAD_INVALID';
    error.statusCode = 400;
    throw error;
  }

  const expected = crypto.createHash('sha256').update(String(storedTemplate), 'utf8').digest();
  const actual = crypto.createHash('sha256').update(String(liveTemplate), 'utf8').digest();
  const matched = expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  const score = matched ? 100 : 0;
  const effectiveThreshold = Number(threshold) || Number(process.env.FINGERPRINT_MATCH_THRESHOLD) || 70;

  return {
    success: true,
    matched,
    score,
    threshold: effectiveThreshold,
    provider: 'MANTRA_MFS110',
    providerMode: 'MANTRA_L1_AVDM_LOCAL_ADAPTER',
    verifiedAt: new Date().toISOString()
  };
}

function asyncRoute(handler) {
  return (req, res) => {
    Promise.resolve(handler(req, res)).catch((error) => {
      const status = error.statusCode || (error.code === 'FINGERPRINT_VERIFY_PAYLOAD_INVALID' ? 400 : 503);
      res.status(status).json(errorPayload(
        error.code || 'FINGERPRINT_ADAPTER_ERROR',
        error.message || 'Fingerprint adapter request failed.',
        status,
        error.details || null
      ));
    });
  };
}

app.get('/status', asyncRoute(async (_req, res) => {
  res.json(await readDeviceInfo());
}));

app.post('/capture', asyncRoute(async (req, res) => {
  res.json(await captureFromAvdm(req.body || {}));
}));

app.post('/verify', asyncRoute(async (req, res) => {
  res.json(verifyTemplates(req.body || {}));
}));

app.listen(port, '127.0.0.1', () => {
  console.log(`[FingerprintAdapter] Listening on http://127.0.0.1:${port}`);
  console.log(`[FingerprintAdapter] Mantra AVDM URL: ${avdmUrl}`);
});
