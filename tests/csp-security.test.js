const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('app.js', 'utf8');
const styleSource = source.match(/`style-src ([^`]+)`/);

assert.match(source, /"default-src 'none'"/, 'CSP fallback must deny resources by default');
assert.ok(styleSource, 'style-src directive must be configured');
assert.ok(!styleSource[1].includes("'unsafe-inline'"), 'style-src must not allow arbitrary inline CSS');
assert.ok(styleSource[1].includes("'nonce-${nonce}'"), 'style-src must require the per-request nonce');
assert.match(source, /html\.replace\(\/<style\(\?!\[\^>\]\*\\bnonce=/, 'rendered style blocks must receive the nonce');
assert.match(source, /strictTransportSecurity:\s*\{[\s\S]*?maxAge:\s*31536000,[\s\S]*?includeSubDomains:\s*true,[\s\S]*?preload:\s*true[\s\S]*?\}/,
    'HSTS must meet browser preload requirements');
assert.match(source, /crossOriginEmbedderPolicy:\s*\{\s*policy:\s*["']credentialless["']\s*\}/,
    'cross-origin embedder policy must isolate cross-origin resources');

console.log('CSP security regression tests passed.');
