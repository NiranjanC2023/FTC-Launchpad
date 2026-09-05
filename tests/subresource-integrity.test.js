const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
    INTEGRITY_ASSETS,
    buildIntegrityMap,
    addSubresourceIntegrity
} = require('../lib/subresource-integrity');

const projectRoot = path.join(__dirname, '..');
const integrityMap = buildIntegrityMap(projectRoot);

for (const assetUrl of INTEGRITY_ASSETS) {
    const filePath = path.join(projectRoot, ...assetUrl.split('/').filter(Boolean));
    const expected = `sha384-${crypto.createHash('sha384').update(fs.readFileSync(filePath)).digest('base64')}`;
    assert.equal(integrityMap.get(assetUrl), expected);
}

const rendered = addSubresourceIntegrity(`
    <link rel="stylesheet" href="/assets/css/main.min.css?v=91">
    <script nonce="test" src="/assets/js/main.min.js?v=99"></script>
    <script async src="https://maps.googleapis.com/maps/api/js?v=weekly"></script>
`, integrityMap);

assert.match(rendered, /href="\/assets\/css\/main\.min\.css\?v=91"[^>]+integrity="sha384-/);
assert.match(rendered, /src="\/assets\/js\/main\.min\.js\?v=99"[^>]+integrity="sha384-/);
assert.equal((rendered.match(/crossorigin="anonymous"/g) || []).length, 2);
assert.ok(!rendered.match(/maps\.googleapis\.com[^>]+integrity=/));

console.log('Subresource integrity regression tests passed.');
