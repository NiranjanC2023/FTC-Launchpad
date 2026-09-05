const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');
const { jsonToBase64 } = require('../lib/html-data');

const attack = {
    name: '</script><script>globalThis.xss = true</script>',
    unicode: 'Robotics ✓'
};
const encoded = jsonToBase64(attack);

assert.match(encoded, /^[A-Za-z0-9+/]*={0,2}$/);
assert.deepEqual(JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')), attack);
assert.ok(!encoded.includes('<'));
assert.ok(!encoded.includes('>'));

const rendered = ejs.render(
    '<script data-json-base64="<%= jsonToBase64(value) %>"></script>',
    { jsonToBase64, value: attack }
);
assert.ok(rendered.includes(`data-json-base64="${encoded}"`));
assert.ok(!rendered.includes(attack.name));
assert.equal((rendered.match(/<script/g) || []).length, 1);

const flaggedTemplates = [
    'views/index.ejs',
    'views/pages/manage-team.ejs',
    'views/pages/my-applications.ejs',
    'views/pages/teams-nearby.ejs'
];
const sources = flaggedTemplates.map(file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8'));

assert.ok(!sources.some(source => /<%-\s*JSON\.stringify/.test(source)));
assert.ok(!sources.some(source => /<%-\s*index\s*>=\s*2/.test(source)));
assert.equal((sources.join('\n').match(/jsonToBase64\(/g) || []).length, 6);

console.log('EJS XSS regression tests passed.');
