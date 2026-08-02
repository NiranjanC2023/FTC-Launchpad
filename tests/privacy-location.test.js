const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const client = fs.readFileSync(path.join(root, 'assets', 'js', 'main.js'), 'utf8');
const homeClient = fs.readFileSync(path.join(root, 'assets', 'js', 'first-start.js'), 'utf8');
const api = fs.readFileSync(path.join(root, 'routes', 'api.js'), 'utf8');
const web = fs.readFileSync(path.join(root, 'routes', 'web.js'), 'utf8');

assert.match(app, /Permissions-Policy[^\n]+geolocation=\(self\)/);
assert.doesNotMatch(client, /getCurrentPosition\s*\(/);
assert.match(homeClient, /navigator\.geolocation\.getCurrentPosition\s*\(/);
assert.doesNotMatch(homeClient, /localStorage|sessionStorage|document\.cookie/);
assert.doesNotMatch(homeClient, /fetch\s*\([^)]*(?:latitude|longitude|coords)/);
assert.doesNotMatch(client, /setItem\(STUDENT_KEY/);
assert.match(client, /sessionStorage\.removeItem\(STUDENT_KEY\)/);
assert.match(client, /localStorage\.removeItem\(STUDENT_KEY\)/);
assert.doesNotMatch(api, /privacyOffsetCoords/);
assert.match(api, /Math\.round\(lat \* 10\) \/ 10/);
assert.match(web, /address: values\.address\.trim\(\)/);
assert.match(web, /lat: Math\.round\(coords\.lat \* 10\) \/ 10/);

console.log('location privacy checks passed');
