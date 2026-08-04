const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { countriesMatch, normalizeCountry } = require('../lib/country');

assert.strictEqual(normalizeCountry('USA'), 'united states');
assert.strictEqual(normalizeCountry('United States of America'), 'united states');
assert.strictEqual(normalizeCountry('U.K.'), 'united kingdom');
assert.ok(countriesMatch('USA', 'United States of America'));
assert.ok(countriesMatch('UK', 'United Kingdom'));
assert.ok(!countriesMatch('Canada', 'United States'));
assert.ok(!countriesMatch('', 'Canada'));

const root = path.join(__dirname, '..');
const api = fs.readFileSync(path.join(root, 'routes', 'api.js'), 'utf8');
const signup = fs.readFileSync(path.join(root, 'views', 'pages', 'signup-seeker.ejs'), 'utf8');
const account = fs.readFileSync(path.join(root, 'views', 'pages', 'account-signup-info.ejs'), 'utf8');

assert.match(api, /if \(team && !countriesMatch\(country, team\.country\)\)/);
assert.match(api, /You can only apply to teams in your country\./);
assert.match(signup, /name="country"[^\n]+required/);
assert.match(account, /name="country"[^\n]+required/);

console.log('country application checks passed');
