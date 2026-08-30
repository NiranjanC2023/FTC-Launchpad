const countryRegionData = require('country-region-data');
const { UNITED_NATIONS_COUNTRIES, countriesMatch, normalizeCountry } = require('./country');

const NOT_APPLICABLE_REGION = 'Not applicable';

const DATA_COUNTRY_NAMES = new Map([
  ['brunei', 'Brunei Darussalam'],
  ['cabo verde', 'Cape Verde'],
  ["cote d ivoire", "Côte d'Ivoire, Republic of"],
  ['czechia', 'Czech Republic'],
  ['democratic republic of the congo', 'Congo, the Democratic Republic of the (Kinshasa)'],
  ['gambia', 'Gambia, The'],
  ['holy see', 'Holy See (Vatican City)'],
  ['iran', 'Iran, Islamic Republic of'],
  ['micronesia', 'Micronesia, Federated States of'],
  ['north korea', "Korea, Democratic People's Republic of"],
  ['north macedonia', 'Macedonia, Republic of'],
  ['state of palestine', 'Palestine, State of'],
  ['republic of the congo', 'Congo, Republic of the (Brazzaville)'],
  ['russia', 'Russian Federation'],
  ['south korea', 'Korea, Republic of'],
  ['syria', 'Syrian Arab Republic'],
  ['tanzania', 'Tanzania, United Republic of'],
  ['venezuela', 'Venezuela, Bolivarian Republic of']
]);

function normalizeRegion(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function getCanonicalUnitedNationsCountry(country) {
  return UNITED_NATIONS_COUNTRIES.find(countryName => countriesMatch(country, countryName)) || '';
}

function findCountryData(country) {
  const canonicalCountry = getCanonicalUnitedNationsCountry(country);
  if (!canonicalCountry) return null;
  const dataName = DATA_COUNTRY_NAMES.get(normalizeCountry(canonicalCountry)) || canonicalCountry;
  return countryRegionData.find(entry => entry.countryName === dataName) || null;
}

function getCountryRegions(country) {
  const countryData = findCountryData(country);
  if (!countryData) return [];
  const regions = countryData && Array.isArray(countryData.regions)
    ? countryData.regions.map(region => region.name).filter(Boolean)
    : [];
  return regions.length ? regions : [NOT_APPLICABLE_REGION];
}

function canonicalizeCountryRegion(country, region) {
  const submittedRegion = normalizeRegion(region);
  if (!submittedRegion) return '';
  const countryData = findCountryData(country);
  const regions = countryData && Array.isArray(countryData.regions) ? countryData.regions : [];
  if (!regions.length) {
    return submittedRegion === normalizeRegion(NOT_APPLICABLE_REGION) ? NOT_APPLICABLE_REGION : '';
  }
  const match = regions.find(item => (
    normalizeRegion(item.name) === submittedRegion
    || normalizeRegion(item.shortCode) === submittedRegion
  ));
  return match ? match.name : '';
}

function isValidCountryRegion(country, region) {
  return Boolean(getCanonicalUnitedNationsCountry(country) && canonicalizeCountryRegion(country, region));
}

module.exports = {
  NOT_APPLICABLE_REGION,
  canonicalizeCountryRegion,
  getCanonicalUnitedNationsCountry,
  getCountryRegions,
  isValidCountryRegion
};
