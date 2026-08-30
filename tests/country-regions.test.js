const assert = require('assert');
const { UNITED_NATIONS_COUNTRIES } = require('../lib/country');
const {
  canonicalizeCountryRegion,
  getCountryRegions,
  isValidCountryRegion
} = require('../lib/country-regions');

UNITED_NATIONS_COUNTRIES.forEach((country) => {
  assert.ok(getCountryRegions(country).length > 0, `${country} must have a selectable region`);
});

assert.strictEqual(canonicalizeCountryRegion('United States', 'CA'), 'California');
assert.strictEqual(canonicalizeCountryRegion('Canada', 'Ontario'), 'Ontario');
assert.strictEqual(canonicalizeCountryRegion('United States', 'Ontario'), '');
assert.strictEqual(isValidCountryRegion('United States', 'California'), true);
assert.strictEqual(isValidCountryRegion('United States', 'Ontario'), false);
assert.strictEqual(isValidCountryRegion('Not a country', 'California'), false);

console.log('Country-region validation tests passed.');
