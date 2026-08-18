const PRIZE_POOL = [
  {
    tier: 'COMMON',
    chance: 50,
    color: '#8b6f47',
    prizes: ['+1 bonus leave token', 'Shore Leave sticker pack', 'Good Cadet certificate PDF', 'Custom profile theme unlock']
  },
  {
    tier: 'RARE',
    chance: 30,
    color: '#3b82f6',
    prizes: ['Find It branded pen', 'Find It keychain', '+2 bonus leave tokens', 'Priority leave processing']
  },
  {
    tier: 'EPIC',
    chance: 15,
    color: '#8b5cf6',
    prizes: ['Find It branded cap', '+3 bonus leave tokens', 'Skip queue privilege', 'Gold profile frame']
  },
  {
    tier: 'LEGENDARY',
    chance: 4,
    color: '#f59e0b',
    prizes: ['Find It T-shirt', 'Extra shore leave day', 'Maritime Legend frame', 'HOD commendation letter']
  },
  {
    tier: 'MYTHIC',
    chance: 1,
    color: '#f8fafc',
    prizes: ['Find It hoodie', '2 extra shore leave days', 'VIP semester status', 'Principal certificate']
  }
];

const PHYSICAL_PRIZE_PATTERNS = [/pen/i, /keychain/i, /cap/i, /t-?shirt/i, /hoodie/i];

function isPhysicalPrize(prize) {
  return PHYSICAL_PRIZE_PATTERNS.some(pattern => pattern.test(prize));
}

function rollPrize() {
  const roll = Math.random() * 100;
  let cursor = 0;
  const tier = PRIZE_POOL.find(item => {
    cursor += item.chance;
    return roll <= cursor;
  }) || PRIZE_POOL[0];
  const prize = tier.prizes[Math.floor(Math.random() * tier.prizes.length)];
  return {
    tier: tier.tier,
    prize,
    color: tier.color,
    physical: isPhysicalPrize(prize),
    earnedAt: new Date(),
    collected: false,
    collectedAt: null
  };
}

function tokenBonusForPrize(prize) {
  const match = String(prize || '').match(/\+(\d+) bonus leave token/i);
  if (match) return Number(match[1]);
  if (/extra shore leave day/i.test(prize)) return 1;
  if (/2 extra shore leave days/i.test(prize)) return 2;
  return 0;
}

function createLootService({ Cadet, sendPushToCadet, emitCadetEvent, emitAdminEvent }) {
  function cadetLookup(cadetId) {
    const clauses = [{ roll: String(cadetId) }];
    if (cadetId && typeof cadetId === 'object') clauses.push({ _id: cadetId });
    if (typeof cadetId === 'string' && /^[a-f\d]{24}$/i.test(cadetId)) clauses.push({ _id: cadetId });
    return { $or: clauses };
  }

  async function openCrate(cadetId) {
    const cadet = await Cadet.findOne(cadetLookup(cadetId));
    if (!cadet) {
      const error = new Error('Cadet not found');
      error.status = 404;
      throw error;
    }
    if (Number(cadet.cratesAvailable || 0) <= 0) {
      const error = new Error('No crates available');
      error.status = 400;
      throw error;
    }

    const prize = rollPrize();
    cadet.cratesAvailable = Math.max(0, Number(cadet.cratesAvailable || 0) - 1);
    cadet.totalCratesOpened = Number(cadet.totalCratesOpened || 0) + 1;
    cadet.prizes = [...(cadet.prizes || []), prize];

    const tokenBonus = tokenBonusForPrize(prize.prize);
    if (tokenBonus) cadet.leaveTokens = Math.min(8, Number(cadet.leaveTokens || 0) + tokenBonus);
    if (/profile theme/i.test(prize.prize)) cadet.profileTheme = 'custom';
    if (/gold profile frame/i.test(prize.prize)) cadet.profileTheme = 'gold';
    if (/Maritime Legend frame/i.test(prize.prize)) cadet.profileTheme = 'legend';

    await cadet.save();

    if (prize.physical) {
      emitAdminEvent('prize:physical', {
        cadetId: String(cadet._id),
        cadetName: cadet.name || cadet.roll,
        roll: cadet.roll,
        prize: prize.prize,
        tier: prize.tier,
        earnedAt: prize.earnedAt
      });
      await sendPushToCadet(cadet.roll, {
        title: 'Physical prize ready',
        body: `Your ${prize.prize} is ready to collect from the admin office!`,
        url: '/cadet-dashboard.html#rewards'
      }).catch(() => {});
    }

    emitCadetEvent(cadet, 'crate:opened', {
      prize,
      cratesAvailable: cadet.cratesAvailable,
      leaveTokens: cadet.leaveTokens
    });

    return {
      prize,
      cratesAvailable: cadet.cratesAvailable,
      totalCratesOpened: cadet.totalCratesOpened,
      leaveTokens: cadet.leaveTokens
    };
  }

  return {
    PRIZE_POOL,
    openCrate
  };
}

module.exports = { PRIZE_POOL, createLootService, isPhysicalPrize };
