const BADGE_DEFINITIONS = [
  { id: 'first_leave', name: 'First Shore Leave', icon: 'anchor', condition: 'Took first shore leave' },
  { id: 'early_bird', name: 'Early Bird', icon: 'sunrise', condition: 'Returned before 17:00' },
  { id: 'perfect_month', name: 'Perfect Month', icon: 'star', condition: 'Zero late returns in a month' },
  { id: 'clean_record', name: 'Clean Record', icon: 'shield', condition: 'Never overdue' },
  { id: 'explorer', name: 'Explorer', icon: 'compass', condition: '10 shore leaves taken' },
  { id: 'night_owl', name: 'Night Owl', icon: 'moon', condition: 'Applied after 16:00' },
  { id: 'comeback_kid', name: 'Comeback Kid', icon: 'flame', condition: 'Rebuilt streak after break' },
  { id: 'veteran', name: 'Veteran', icon: 'medal', condition: '1 year on platform' },
  { id: 'streak_7', name: '7 Day Streak', icon: 'fire', condition: '7 consecutive on-time returns' },
  { id: 'streak_30', name: '30 Day Streak', icon: 'trophy', condition: '30 consecutive on-time returns' },
  { id: 'maritime_legend', name: 'Maritime Legend', icon: 'crown', condition: '90 consecutive on-time returns' }
];

function createBadgeService({ Cadet, sendPushToCadet, emitCadetEvent }) {
  const definitionsById = new Map(BADGE_DEFINITIONS.map(badge => [badge.id, badge]));

  function cadetLookup(cadetId) {
    const clauses = [{ roll: String(cadetId) }];
    if (cadetId && typeof cadetId === 'object') clauses.push({ _id: cadetId });
    if (typeof cadetId === 'string' && /^[a-f\d]{24}$/i.test(cadetId)) clauses.push({ _id: cadetId });
    return { $or: clauses };
  }

  async function awardBadge(cadetId, badgeId) {
    const definition = definitionsById.get(badgeId);
    if (!definition) throw new Error(`Unknown badge: ${badgeId}`);

    const cadet = await Cadet.findOne(cadetLookup(cadetId));
    if (!cadet) return null;

    const alreadyEarned = (cadet.badges || []).some(badge => badge.id === badgeId);
    if (alreadyEarned) return null;

    const badge = {
      id: definition.id,
      name: definition.name,
      icon: definition.icon,
      earnedAt: new Date()
    };
    cadet.badges = [...(cadet.badges || []), badge];
    await cadet.save();

    await sendPushToCadet(cadet.roll, {
      title: 'New badge earned!',
      body: `New badge: ${definition.name}`,
      url: '/cadet-dashboard.html'
    }).catch(() => {});
    emitCadetEvent(cadet, 'badge:earned', badge);
    return badge;
  }

  return {
    BADGE_DEFINITIONS,
    awardBadge
  };
}

module.exports = { BADGE_DEFINITIONS, createBadgeService };
