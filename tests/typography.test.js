const assert = require('assert');
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '..', 'assets', 'css', 'main.css'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

assert.match(css, /html\s*\{[\s\S]*?-webkit-text-size-adjust:\s*100%;[\s\S]*?text-size-adjust:\s*100%;[\s\S]*?\}/);
assert.match(css, /body\s*\{[\s\S]*?font-size:\s*16px;[\s\S]*?line-height:\s*1\.55;[\s\S]*?\}/);
assert.match(css, /h1,\s*\n\.hero-card h1\s*\{[\s\S]*?font-size:\s*clamp\(2\.25rem, 4\.5vw, 3\.5rem\);/);
assert.match(css, /\.subtitle,\s*\n\.hero-card \.subtitle\s*\{[\s\S]*?font-size:\s*clamp\(1rem, 1\.25vw, 1\.15rem\);/);
assert.match(app, /const MAIN_CSS_VERSION = "35";/);

console.log('typography checks passed');
