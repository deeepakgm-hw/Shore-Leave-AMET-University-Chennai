const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

let client;
const retryQueue = [];

class SupabaseStorageError extends Error {
  constructor(operation, context, cause) {
    super(`Supabase ${operation} failed`);
    this.name = 'SupabaseStorageError';
    this.operation = operation;
    this.bucket = context.bucket || null;
    this.objectPath = context.objectPath || null;
    this.code = cause?.code || cause?.error || null;
    this.status = cause?.statusCode || cause?.status || null;
    this.cause = cause;
  }
}

function getConfigurationDiagnostics() {
  const url = String(process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  let keyType = 'unknown';
  if (key.startsWith('sb_secret_')) keyType = 'sb_secret';
  else if (key.startsWith('sb_publishable_')) keyType = 'publishable';
  else if (key.split('.').length === 3) keyType = 'legacy_jwt';

  return {
    projectUrl: url || null,
    serviceRoleKeyExists: Boolean(key),
    keyType,
    fallbackKeysPresent: {
      serviceKey: Boolean(process.env.SUPABASE_SERVICE_KEY),
      anonKey: Boolean(process.env.SUPABASE_ANON_KEY),
      publishableKey: Boolean(process.env.SUPABASE_PUBLISHABLE_KEY)
    }
  };
}

function getClient() {
  if (client) return client;
  const url = String(process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !serviceRoleKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  }
  client = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
  return client;
}

function safePathPart(value, fallback = 'file') {
  return String(value || fallback)
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '') || fallback;
}

function normalizeObjectPath(objectPath) {
  const normalized = String(objectPath || '').replace(/^\/+/, '');
  if (!normalized || normalized.includes('..')) throw new Error('A safe Supabase object path is required');
  return normalized;
}

function parseDataUrl(dataUrl) {
  const match = /^data:([\w/+.-]+);base64,([\s\S]+)$/.exec(String(dataUrl || ''));
  if (!match) throw new Error('A valid base64 data URL is required');
  const contentType = match[1].toLowerCase();
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length) throw new Error('Uploaded file is empty');
  const extensions = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'application/pdf': 'pdf',
    'image/svg+xml': 'svg'
  };
  return { buffer, contentType, extension: extensions[contentType] || 'bin' };
}

function logStorageError(error) {
  console.error('[SUPABASE] Storage operation failed', {
    operation: error.operation,
    bucket: error.bucket,
    objectPath: error.objectPath ? '[REDACTED]' : null,
    code: error.code,
    message: '[REDACTED]',
    httpStatus: error.status
  });
}

function getPublicUrl(bucket, objectPath) {
  const normalizedPath = normalizeObjectPath(objectPath);
  const { data } = getClient().storage.from(bucket).getPublicUrl(normalizedPath);
  if (!data?.publicUrl) {
    throw new SupabaseStorageError('public URL lookup', { bucket, objectPath: normalizedPath }, new Error('Public URL was not returned'));
  }
  return data.publicUrl;
}

async function uploadBuffer({ bucket, objectPath, buffer, contentType, upsert = true, attempts = 3 }) {
  if (!bucket) throw new Error('Supabase bucket is required');
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('Upload buffer is empty');
  const normalizedPath = normalizeObjectPath(objectPath);
  const supabase = getClient();
  let lastError;

  for (let attempt = 1; attempt <= Math.max(1, attempts); attempt += 1) {
    const { error } = await supabase.storage.from(bucket).upload(normalizedPath, buffer, {
      contentType,
      upsert,
      cacheControl: '3600'
    });
    if (!error) {
      const { data: downloaded, error: downloadError } = await supabase.storage
        .from(bucket)
        .download(normalizedPath);
      if (downloadError || !downloaded) {
        lastError = downloadError || new Error('Uploaded object could not be downloaded for verification');
        if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, attempt * 500));
        continue;
      }

      const downloadedBuffer = Buffer.from(await downloaded.arrayBuffer());
      if (downloadedBuffer.length !== buffer.length) {
        lastError = new Error(`Uploaded object size mismatch (${downloadedBuffer.length} !== ${buffer.length})`);
        if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, attempt * 500));
        continue;
      }

      const publicUrl = getPublicUrl(bucket, normalizedPath);
      const { data: signedData, error: signedError } = await supabase.storage
        .from(bucket)
        .createSignedUrl(normalizedPath, 60 * 60 * 24 * 7);
      if (signedError || !signedData?.signedUrl) {
        lastError = signedError || new Error('Signed URL was not returned');
        if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, attempt * 500));
        continue;
      }

      const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
      const uploadedAt = new Date();
      console.info('[SUPABASE] Upload verified', {
        bucket,
        objectPath: '[REDACTED]',
        size: buffer.length
      });
      return {
        bucket,
        path: normalizedPath,
        publicUrl,
        signedUrl: signedData.signedUrl,
        contentType,
        size: buffer.length,
        sha256,
        uploaded: true,
        verified: true,
        uploadedAt
      };
    }
    lastError = error;
    if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, attempt * 500));
  }

  const wrapped = new SupabaseStorageError('upload', { bucket, objectPath: normalizedPath }, lastError);
  logStorageError(wrapped);
  throw wrapped;
}

async function deleteObject(bucket, objectPath) {
  const normalizedPath = normalizeObjectPath(objectPath);
  const { error } = await getClient().storage.from(bucket).remove([normalizedPath]);
  if (error) {
    const wrapped = new SupabaseStorageError('delete', { bucket, objectPath: normalizedPath }, error);
    logStorageError(wrapped);
    throw wrapped;
  }
  console.info('[SUPABASE] Object deleted', {
    bucket,
    objectPath: '[REDACTED]'
  });
  return { bucket, path: normalizedPath };
}

async function listBuckets() {
  const { data, error } = await getClient().storage.listBuckets();
  if (error) {
    const wrapped = new SupabaseStorageError('bucket listing', {}, error);
    logStorageError(wrapped);
    throw wrapped;
  }
  return data || [];
}

async function verifyConnection() {
  const diagnostics = getConfigurationDiagnostics();
  try {
    const buckets = await listBuckets();
    return { online: true, buckets: buckets.map(bucket => bucket.name), diagnostics, error: null };
  } catch (error) {
    return {
      online: false,
      buckets: [],
      diagnostics,
      error: {
        code: error.code || null,
        message: 'Supabase Storage connection verification failed',
        status: error.status || null
      }
    };
  }
}

async function uploadDataUrl({ bucket, folder, filename, dataUrl, upsert = true }) {
  const parsed = parseDataUrl(dataUrl);
  const safeFilename = safePathPart(filename, 'image').replace(/\.[^.]+$/, '');
  const safeFolder = String(folder || '')
    .split('/')
    .filter(Boolean)
    .map(part => safePathPart(part))
    .join('/');
  const objectPath = `${safeFolder ? `${safeFolder}/` : ''}${safeFilename}.${parsed.extension}`;
  return uploadBuffer({ bucket, objectPath, buffer: parsed.buffer, contentType: parsed.contentType, upsert });
}

async function verifyObjectExists(bucket, objectPath) {
  const normalizedPath = normalizeObjectPath(objectPath);
  const slash = normalizedPath.lastIndexOf('/');
  const folder = slash >= 0 ? normalizedPath.slice(0, slash) : '';
  const filename = slash >= 0 ? normalizedPath.slice(slash + 1) : normalizedPath;
  const { data, error } = await getClient().storage.from(bucket).list(folder, { search: filename, limit: 10 });
  if (error) throw new SupabaseStorageError('object verification', { bucket, objectPath: normalizedPath }, error);
  return Array.isArray(data) && data.some(item => item.name === filename);
}

// Compatibility hooks for the existing retry architecture. Jobs remain explicit
// so callers can attach their MongoDB update after a successful retry.
function queueSupabaseRetry(job) {
  if (!job || typeof job !== 'object') throw new Error('A Supabase retry job is required');
  retryQueue.push({ ...job, queuedAt: new Date(), attempts: Number(job.attempts || 0) });
  return retryQueue.length;
}

async function retrySupabaseUploads() {
  const results = [];
  const pending = retryQueue.splice(0);
  for (const job of pending) {
    try {
      const uploaded = await uploadBuffer({ ...job, attempts: 1 });
      if (typeof job.onSuccess === 'function') await job.onSuccess(uploaded);
      results.push({ success: true, uploaded });
    } catch (error) {
      const nextJob = { ...job, attempts: Number(job.attempts || 0) + 1 };
      retryQueue.push(nextJob);
      results.push({ success: false, error });
    }
  }
  return results;
}

module.exports = {
  SupabaseStorageError,
  getClient,
  getSupabaseClient: getClient,
  getConfigurationDiagnostics,
  safePathPart,
  uploadBuffer,
  uploadDataUrl,
  deleteObject,
  getPublicUrl,
  listBuckets,
  verifyConnection,
  verifyObjectExists,
  queueSupabaseRetry,
  retrySupabaseUploads
};
