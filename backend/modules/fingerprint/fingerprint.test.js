const test = require('node:test');
const assert = require('node:assert/strict');

process.env.FINGERPRINT_ENCRYPTION_KEY =
  process.env.FINGERPRINT_ENCRYPTION_KEY || require('crypto').randomBytes(32).toString('hex');

const {
  FingerprintError,
  encryptTemplate,
  decryptTemplate
} = require('./utils');
const { cadetLookup, direction } = require('./validator');
const { MantraMfs110Sdk } = require('./sdk');
const { createRateLimit } = require('./middleware');

test('fingerprint template encryption round-trips without storing plaintext', () => {
  const template = Buffer.from('ISO-FINGERPRINT-TEMPLATE').toString('base64');
  const encrypted = encryptTemplate(template);

  assert.notEqual(encrypted.encryptedTemplate, template);
  assert.equal(decryptTemplate(encrypted), template);
  assert.match(encrypted.templateHash, /^[a-f0-9]{64}$/);
});

test('cadet lookup accepts roll numbers and rejects missing identifiers', () => {
  assert.deepEqual(cadetLookup('AMETUG/2026/10001').query, {
    $or: [
      { roll: 'AMETUG/2026/10001' },
      { studentId: 'AMETUG/2026/10001' }
    ]
  });
  assert.throws(
    () => cadetLookup(''),
    (error) => error instanceof FingerprintError
      && error.code === 'VALIDATION_ERROR'
      && error.details?.field === 'cadetId'
  );
});

test('gate direction validation is strict and normalized', () => {
  assert.equal(direction('check_in'), 'CHECK_IN');
  assert.equal(direction('CHECK_OUT'), 'CHECK_OUT');
  assert.equal(direction(undefined), null);
  assert.throws(
    () => direction('sideways'),
    (error) => error instanceof FingerprintError
      && error.code === 'VALIDATION_ERROR'
      && error.details?.field === 'direction'
  );
});

test('Mantra adapter captures templates and matches only through backend bridge', async (t) => {
  const previousFetch = global.fetch;
  const previousBridge = process.env.MANTRA_MFS110_BRIDGE_URL;
  const previousToken = process.env.FINGERPRINT_BRIDGE_TOKEN;
  process.env.MANTRA_MFS110_BRIDGE_URL = 'http://127.0.0.1:11111';
  process.env.FINGERPRINT_BRIDGE_TOKEN = 'bridge-test-token';

  const requests = [];
  global.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (String(url).endsWith('/capture')) {
      return new Response(JSON.stringify({
        success: true,
        template: Buffer.from('capture-template').toString('base64'),
        templateVersion: 'ISO-19794-2',
        quality: 82,
        deviceModel: 'Mantra MFS110',
        deviceSerial: 'TEST-001',
        sdkVersion: 'test'
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (String(url).endsWith('/match')) {
      return new Response(JSON.stringify({
        success: true,
        matched: true,
        score: 91,
        threshold: 70
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({ connected: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };

  t.after(() => {
    global.fetch = previousFetch;
    if (previousBridge === undefined) delete process.env.MANTRA_MFS110_BRIDGE_URL;
    else process.env.MANTRA_MFS110_BRIDGE_URL = previousBridge;
    if (previousToken === undefined) delete process.env.FINGERPRINT_BRIDGE_TOKEN;
    else process.env.FINGERPRINT_BRIDGE_TOKEN = previousToken;
  });

  const sdk = new MantraMfs110Sdk();
  const capture = await sdk.capture();
  const match = await sdk.match(capture.template, capture.template);

  assert.equal(capture.deviceModel, 'Mantra MFS110');
  assert.equal(capture.quality, 82);
  assert.equal(match.matched, true);
  assert.equal(match.score, 91);
  assert.equal(requests[0].options.headers.authorization, 'Bearer bridge-test-token');
  assert.equal(JSON.parse(requests[0].options.body).includeImage, false);
  assert.equal(Object.hasOwn(capture, 'image'), false);
});

test('capture fails closed when no backend hardware bridge is configured', async (t) => {
  const previousBridge = process.env.MANTRA_MFS110_BRIDGE_URL;
  delete process.env.MANTRA_MFS110_BRIDGE_URL;
  t.after(() => {
    if (previousBridge !== undefined) process.env.MANTRA_MFS110_BRIDGE_URL = previousBridge;
  });

  const sdk = new MantraMfs110Sdk();
  await assert.rejects(
    () => sdk.capture(),
    (error) => error instanceof FingerprintError && error.code === 'FINGERPRINT_BRIDGE_NOT_CONFIGURED'
  );
});

test('fingerprint rate limiter isolates actors and returns retry metadata', () => {
  const middleware = createRateLimit({ windowMs: 60_000, max: 1 });
  const req = { originalUrl: '/api/fingerprint/enroll', user: { username: 'admin' }, ip: '127.0.0.1' };
  const first = {
    headers: {},
    statusCode: 200,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json() {}
  };
  let payload = null;
  const second = {
    headers: {},
    statusCode: 200,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { payload = value; }
  };

  let nextCalls = 0;
  middleware(req, first, () => { nextCalls += 1; });
  middleware(req, second, () => { nextCalls += 1; });

  assert.equal(nextCalls, 1);
  assert.equal(second.statusCode, 429);
  assert.equal(payload.code, 'FINGERPRINT_RATE_LIMITED');
  assert.ok(payload.retryAfter > 0);
  assert.equal(second.headers['Retry-After'], String(payload.retryAfter));
});
