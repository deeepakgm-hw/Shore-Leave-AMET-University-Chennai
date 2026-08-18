function createStreakService({ Cadet, xpService, badgeService, emitCadetEvent }) {
  function cadetLookup(cadetId) {
    const clauses = [{ roll: String(cadetId) }];
    if (cadetId && typeof cadetId === 'object') clauses.push({ _id: cadetId });
    if (typeof cadetId === 'string' && /^[a-f\d]{24}$/i.test(cadetId)) clauses.push({ _id: cadetId });
    return { $or: clauses };
  }

  async function updateStreak(cadetId, returnStatus) {
    const cadet = await Cadet.findOne(cadetLookup(cadetId));
    if (!cadet) return null;

    const wasBroken = Number(cadet.currentStreak || 0) === 0;
    const positiveReturn = returnStatus === 'onTime' || returnStatus === 'early';

    if (positiveReturn) {
      cadet.currentStreak = Number(cadet.currentStreak || 0) + 1;
      cadet.longestStreak = Math.max(Number(cadet.longestStreak || 0), cadet.currentStreak);
      cadet.lastReturnDate = new Date();
      await cadet.save();

      if (wasBroken && cadet.currentStreak >= 2) {
        await badgeService.awardBadge(cadet._id, 'comeback_kid').catch(() => {});
      }

      if (cadet.currentStreak === 7) {
        await xpService.awardXP(cadet._id, 'STREAK_7_DAYS', '7 day streak').catch(() => {});
        await badgeService.awardBadge(cadet._id, 'streak_7').catch(() => {});
      } else if (cadet.currentStreak === 30) {
        await xpService.awardXP(cadet._id, 'STREAK_30_DAYS', '30 day streak').catch(() => {});
        await badgeService.awardBadge(cadet._id, 'streak_30').catch(() => {});
      } else if (cadet.currentStreak === 90) {
        await xpService.awardXP(cadet._id, 'STREAK_90_DAYS', '90 day streak').catch(() => {});
        await badgeService.awardBadge(cadet._id, 'maritime_legend').catch(() => {});
      }
    } else {
      cadet.currentStreak = 0;
      cadet.lastReturnDate = new Date();
      await cadet.save();
    }

    emitCadetEvent(cadet, 'streak:updated', {
      currentStreak: cadet.currentStreak,
      longestStreak: cadet.longestStreak,
      returnStatus,
      broken: !positiveReturn
    });
    return cadet;
  }

  async function resetMonthlyTokens() {
    const now = new Date();
    const result = await Cadet.updateMany(
      {},
      [
        {
          $set: {
            leaveTokens: { $min: [{ $add: [{ $ifNull: ['$leaveTokens', 4] }, 4] }, 8] },
            monthlyTokenReset: now
          }
        }
      ]
    );
    return result;
  }

  return {
    updateStreak,
    resetMonthlyTokens
  };
}

module.exports = { createStreakService };
