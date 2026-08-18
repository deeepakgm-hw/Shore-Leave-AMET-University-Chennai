const XP_VALUES = {
  ON_TIME_RETURN: 50,
  EARLY_RETURN: 75,
  PERFECT_WEEK: 200,
  STREAK_7_DAYS: 300,
  STREAK_30_DAYS: 1000,
  STREAK_90_DAYS: 3000,
  FACE_ENROLLED: 100,
  FIRST_SHORE_LEAVE: 50,
  PWA_DAILY_LOGIN: 10,
  ZERO_OVERDUE_MONTH: 500,
  LATE_RETURN: -30,
  OVERDUE: -100
};

const ONCE_ONLY_ACTIONS = new Set([
  'FACE_ENROLLED',
  'FIRST_SHORE_LEAVE'
]);

const DAILY_ACTIONS = new Set([
  'PWA_DAILY_LOGIN'
]);

const LEVELS = [
  { level: 7, xp: 12000, title: 'Maritime Legend' },
  { level: 6, xp: 8000, title: 'Maritime Elite' },
  { level: 5, xp: 5000, title: 'Maritime Pro' },
  { level: 4, xp: 3000, title: 'Senior Voyager' },
  { level: 3, xp: 1500, title: 'Deck Specialist' },
  { level: 2, xp: 500, title: 'Harbor Cadet' },
  { level: 1, xp: 0, title: 'New Cadet' }
];

function getLevelForXp(xp) {
  return LEVELS.find(item => xp >= item.xp) || LEVELS[LEVELS.length - 1];
}

function startOfDay(date = new Date()) {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value;
}

function createXpService({ Cadet, CadetXpLog, sendPushToCadet, emitCadetEvent }) {
  function cadetLookup(cadetId) {
    const clauses = [{ roll: String(cadetId) }];
    if (cadetId && typeof cadetId === 'object') clauses.push({ _id: cadetId });
    if (typeof cadetId === 'string' && /^[a-f\d]{24}$/i.test(cadetId)) clauses.push({ _id: cadetId });
    return { $or: clauses };
  }

  async function awardXP(cadetId, action, note = '') {
    const xpDelta = XP_VALUES[action];
    if (typeof xpDelta !== 'number') throw new Error(`Unknown XP action: ${action}`);

    const cadet = await Cadet.findOne(cadetLookup(cadetId));
    if (!cadet) return null;

    if (ONCE_ONLY_ACTIONS.has(action)) {
      const exists = await CadetXpLog.exists({ cadetId: String(cadet._id), action });
      if (exists) return { skipped: true, reason: 'already_awarded', cadet };
    }

    if (DAILY_ACTIONS.has(action)) {
      const exists = await CadetXpLog.exists({
        cadetId: String(cadet._id),
        action,
        timestamp: { $gte: startOfDay() }
      });
      if (exists) return { skipped: true, reason: 'daily_limit', cadet };
    }

    const oldXp = Number(cadet.xp || 0);
    const oldCrateMilestone = Math.floor(oldXp / 500);
    const nextXp = Math.max(0, oldXp + xpDelta);
    const nextCrateMilestone = Math.floor(nextXp / 500);
    const cratesEarned = Math.max(0, nextCrateMilestone - oldCrateMilestone);
    const levelInfo = getLevelForXp(nextXp);

    cadet.xp = nextXp;
    cadet.level = levelInfo.level;
    if (cratesEarned) cadet.cratesAvailable = Number(cadet.cratesAvailable || 0) + cratesEarned;
    await cadet.save();

    const log = await CadetXpLog.create({
      cadetId: String(cadet._id),
      roll: cadet.roll,
      action,
      xp: xpDelta,
      timestamp: new Date(),
      note
    });

    emitCadetEvent(cadet, 'xp:earned', {
      action,
      xp: xpDelta,
      totalXp: cadet.xp,
      level: cadet.level,
      cratesAvailable: cadet.cratesAvailable,
      note
    });

    if (cratesEarned) {
      await sendPushToCadet(cadet.roll, {
        title: 'You earned a loot crate!',
        body: 'Open it now in Rewards.',
        url: '/cadet-dashboard.html#rewards'
      }).catch(() => {});
      emitCadetEvent(cadet, 'crate:available', { cratesAvailable: cadet.cratesAvailable, cratesEarned });
    }

    return { cadet, log, xp: xpDelta, cratesEarned };
  }

  return {
    XP_VALUES,
    LEVELS,
    getLevelForXp,
    awardXP
  };
}

module.exports = { XP_VALUES, LEVELS, getLevelForXp, createXpService };
