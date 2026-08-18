const mongoose = require('mongoose');
const { FingerprintError } = require('./utils');

function requiredString(value, field, maxLength = 160) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw new FingerprintError(`${field} is required.`, {
      code: 'VALIDATION_ERROR',
      statusCode: 400,
      details: { field }
    });
  }
  if (normalized.length > maxLength) {
    throw new FingerprintError(`${field} is too long.`, {
      code: 'VALIDATION_ERROR',
      statusCode: 400,
      details: { field }
    });
  }
  return normalized;
}

function cadetLookup(value) {
  const cadetId = requiredString(value, 'cadetId', 180);
  const clauses = [{ roll: cadetId.toUpperCase() }, { studentId: cadetId }];
  if (mongoose.isValidObjectId(cadetId)) clauses.push({ _id: cadetId });
  return { cadetId, query: { $or: clauses } };
}

function direction(value) {
  if (value == null || value === '') return null;
  const normalized = String(value).trim().toUpperCase();
  if (!['CHECK_IN', 'CHECK_OUT'].includes(normalized)) {
    throw new FingerprintError('direction must be CHECK_IN or CHECK_OUT.', {
      code: 'VALIDATION_ERROR',
      statusCode: 400,
      details: { field: 'direction' }
    });
  }
  return normalized;
}

module.exports = { requiredString, cadetLookup, direction };
