const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { hasGlobalPrivacyControl } = require('../lib/gpc');

assert.strictEqual(hasGlobalPrivacyControl('1'), true);
assert.strictEqual(hasGlobalPrivacyControl('0'), false);
assert.strictEqual(hasGlobalPrivacyControl(''), false);
assert.strictEqual(hasGlobalPrivacyControl('0, 1'), true);
assert.strictEqual(hasGlobalPrivacyControl('10'), false);

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const web = fs.readFileSync(path.join(root, 'routes', 'web.js'), 'utf8');
const terms = fs.readFileSync(path.join(root, 'views', 'pages', 'terms.ejs'), 'utf8');
const policy = fs.readFileSync(path.join(root, 'views', 'partial', 'privacy-policy.html'), 'utf8');

assert.match(app, /req\.globalPrivacyControl = hasGlobalPrivacyControl\(req\.get\("Sec-GPC"\)\)/);
assert.match(app, /app\.get\("\/\.well-known\/gpc\.json"/);
assert.match(app, /gpc: true/);
assert.match(web, /if \(req\.globalPrivacyControl\) return next\(\);/);
assert.match(terms, /<%- policyHtml %>/);
assert.match(policy, /Global Privacy Control \(GPC\)/);

console.log('GPC checks passed');
