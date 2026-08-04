const COUNTRY_ALIASES = new Map([
  ['us', 'united states'],
  ['u s', 'united states'],
  ['usa', 'united states'],
  ['u s a', 'united states'],
  ['united states of america', 'united states'],
  ['uk', 'united kingdom'],
  ['u k', 'united kingdom'],
  ['gb', 'united kingdom'],
  ['great britain', 'united kingdom'],
  ['uae', 'united arab emirates'],
  ['u a e', 'united arab emirates']
]);

function normalizeCountry(value) {
  const normalized = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');

  return COUNTRY_ALIASES.get(normalized) || normalized;
}

function countriesMatch(left, right) {
  const normalizedLeft = normalizeCountry(left);
  const normalizedRight = normalizeCountry(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

module.exports = { countriesMatch, normalizeCountry };
