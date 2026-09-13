const FINAL_LEAVE_TYPES = Object.freeze([
  'Home Leave',
  'Medical Leave',
  'Emergency Leave',
  'Personal Leave',
  'Sunday Shore Leave'
]);

const MONTHLY_LEAVE_TOKEN_ALLOWANCE = 28;

const LEAVE_TOKEN_POLICY = Object.freeze({
  monthlyAllowance: MONTHLY_LEAVE_TOKEN_ALLOWANCE,
  noCarryOver: true,
  costs: Object.freeze({
    'Home Leave': { tokensPerChargeableDay: 1 },
    'Medical Leave': { fixedTokens: 0 },
    'Emergency Leave': { fixedTokens: 0 },
    'Personal Leave': { tokensPerChargeableDay: 1 },
    'Sunday Shore Leave': { tokensPerSunday: 1 }
  })
});

function normalizeLeaveType(leaveType) {
  const key = String(leaveType || '').trim().toLowerCase();
  const aliases = {
    home: 'Home Leave',
    'home leave': 'Home Leave',
    medical: 'Medical Leave',
    'medical leave': 'Medical Leave',
    emergency: 'Emergency Leave',
    'emergency leave': 'Emergency Leave',
    personal: 'Personal Leave',
    'personal leave': 'Personal Leave',
    shore: 'Sunday Shore Leave',
    'shore leave': 'Sunday Shore Leave',
    sunday: 'Sunday Shore Leave',
    'sunday shore leave': 'Sunday Shore Leave'
  };
  return aliases[key] || null;
}

function isFinalLeaveType(leaveType) {
  return Boolean(normalizeLeaveType(leaveType));
}

function parseDateValue(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfDay(dateValue) {
  const date = new Date(dateValue);
  date.setHours(0, 0, 0, 0);
  return date;
}

function endOfDay(dateValue) {
  const date = new Date(dateValue);
  date.setHours(23, 59, 59, 999);
  return date;
}

function chargeableDays(fromDate, toDate) {
  const start = parseDateValue(fromDate);
  const end = parseDateValue(toDate);
  if (!start || !end) return 0;
  return Math.max(1, Math.ceil((endOfDay(end) - startOfDay(start)) / (24 * 60 * 60 * 1000)));
}

function eachCalendarDay(fromDate, toDate) {
  const start = parseDateValue(fromDate);
  const end = parseDateValue(toDate);
  if (!start || !end) return [];
  const cursor = startOfDay(start);
  const finalDay = startOfDay(end);
  const days = [];
  while (cursor <= finalDay) {
    days.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function countSundays(fromDate, toDate) {
  return eachCalendarDay(fromDate, toDate).filter((date) => date.getDay() === 0).length;
}

function validateSundayOnly(fromDate, toDate) {
  const days = eachCalendarDay(fromDate, toDate);
  if (!days.length) return { valid: false, message: 'Sunday Shore Leave requires a valid Sunday date.' };
  if (days.some((date) => date.getDay() !== 0)) {
    return { valid: false, message: 'Sunday Shore Leave is available only on Sundays.' };
  }
  return { valid: true, sundays: days.length };
}

function calculateRequiredTokens({ leaveType, fromDate, toDate }) {
  const normalizedType = normalizeLeaveType(leaveType);
  if (!normalizedType) {
    return { valid: false, requiredTokens: 0, message: 'Leave type must be Home Leave, Medical Leave, Emergency Leave, Personal Leave, or Sunday Shore Leave.' };
  }

  if (normalizedType === 'Medical Leave' || normalizedType === 'Emergency Leave') {
    return { valid: true, leaveType: normalizedType, requiredTokens: 0, chargeableDays: chargeableDays(fromDate, toDate) };
  }

  if (normalizedType === 'Sunday Shore Leave') {
    const sundayValidation = validateSundayOnly(fromDate, toDate);
    if (!sundayValidation.valid) return { ...sundayValidation, leaveType: normalizedType, requiredTokens: 0 };
    return {
      valid: true,
      leaveType: normalizedType,
      requiredTokens: sundayValidation.sundays,
      chargeableDays: sundayValidation.sundays
    };
  }

  const days = chargeableDays(fromDate, toDate);
  if (!days) return { valid: false, leaveType: normalizedType, requiredTokens: 0, message: 'Valid leave dates are required for token calculation.' };
  return { valid: true, leaveType: normalizedType, requiredTokens: days, chargeableDays: days };
}

function monthKeyParts(date = new Date()) {
  const value = parseDateValue(date) || new Date();
  return { year: value.getFullYear(), month: value.getMonth() + 1 };
}

function monthLabel(year, month) {
  return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(new Date(year, month - 1, 1));
}

module.exports = {
  FINAL_LEAVE_TYPES,
  LEAVE_TOKEN_POLICY,
  MONTHLY_LEAVE_TOKEN_ALLOWANCE,
  calculateRequiredTokens,
  chargeableDays,
  countSundays,
  isFinalLeaveType,
  monthKeyParts,
  monthLabel,
  normalizeLeaveType,
  validateSundayOnly
};
