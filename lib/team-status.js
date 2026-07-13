function normalizeRecruitingValue(value) {
  if (value === false || value === 0) return false;

  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return true;

  if (['false', '0', 'off', 'no', 'n', 'inactive', 'not recruiting'].includes(normalized)) {
    return false;
  }

  return true;
}

function isRecruitingTeam(team) {
  if (!team || typeof team !== 'object') return true;
  return normalizeRecruitingValue(team.recruiting);
}

module.exports = {
  isRecruitingTeam,
  normalizeRecruitingValue
};
