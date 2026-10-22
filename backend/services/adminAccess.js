/**
 * Resolve effective administrative role and active temporary grants for an officer.
 * Permanent roles stored in the database are never mutated.
 */
function getOfficerAccess(officer, now = new Date()) {
  const permanentRole = officer?.role || 'duty_officer';
  const grant = officer?.temporaryAdminGrant;
  const startsAt = grant?.startsAt ? new Date(grant.startsAt).getTime() : NaN;
  const expiresAt = grant?.expiresAt ? new Date(grant.expiresAt).getTime() : NaN;
  const activeGrant = permanentRole !== 'admin' && grant && !grant.revokedAt &&
    Number.isFinite(startsAt) && Number.isFinite(expiresAt) && startsAt <= now.getTime() && now.getTime() < expiresAt;
  return {
    isPermanentAdmin: permanentRole === 'admin',
    temporaryAdmin: Boolean(activeGrant),
    effectiveRole: permanentRole === 'admin' || activeGrant ? 'admin' : permanentRole,
    grant: grant || null
  };
}

module.exports = { getOfficerAccess };
