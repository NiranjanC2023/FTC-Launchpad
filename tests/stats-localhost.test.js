const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const web = fs.readFileSync(path.join(root, 'routes', 'web.js'), 'utf8');
const siteVisitModel = fs.readFileSync(path.join(root, 'models', 'siteVisit.js'), 'utf8');

assert.ok(web.includes("const LOCALHOST_HOST_PATTERN = /^(localhost|127(?:\\.\\d{1,3}){3}|\\[?::1\\]?)(?::\\d+)?$/i;"));
assert.match(web, /if \(isLocalhostHost\(req\.hostname \|\| req\.get\('host'\)\)\) return next\(\);/);
assert.match(web, /host: String\(req\.hostname \|\| req\.get\('host'\) \|\| ''\)\.trim\(\) \|\| undefined/);
assert.match(siteVisitModel, /host: \{ type: String, trim: true, index: true \}/);

console.log('localhost traffic checks passed');
