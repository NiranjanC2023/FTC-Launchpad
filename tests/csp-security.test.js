const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('app.js', 'utf8');
const styleSource = source.match(/`style-src ([^`]+)`/);

assert.ok(styleSource, 'style-src directive must be configured');
assert.ok(!styleSource[1].includes("'unsafe-inline'"), 'style-src must not allow arbitrary inline CSS');
assert.ok(styleSource[1].includes("'nonce-${nonce}'"), 'style-src must require the per-request nonce');
assert.match(source, /html\.replace\(\/<style\(\?!\[\^>\]\*\\bnonce=/, 'rendered style blocks must receive the nonce');

console.log('CSP security regression tests passed.');
