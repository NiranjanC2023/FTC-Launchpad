const assert = require('assert');
const fs = require('fs');
const path = require('path');
const User = require('../models/user');
const Student = require('../models/student');

function userWithAge(age) {
  return new User({ name: 'Test', email: `age-${age}@example.test`, passwordHash: 'test', age });
}

function studentWithAge(age) {
  return new Student({ name: 'Test', age });
}

for (const age of [-10, -1, 0, 1, 2, 2.5, 121]) {
  assert.ok(userWithAge(age).validateSync()?.errors.age, `user age ${age} must be rejected`);
  assert.ok(studentWithAge(age).validateSync()?.errors.age, `student age ${age} must be rejected`);
}

for (const age of [3, 4, 18, 98, 120]) {
  assert.strictEqual(userWithAge(age).validateSync(), undefined, `user age ${age} must be accepted`);
  assert.strictEqual(studentWithAge(age).validateSync(), undefined, `student age ${age} must be accepted`);
}

const root = path.join(__dirname, '..');
const api = fs.readFileSync(path.join(root, 'routes', 'api.js'), 'utf8');
const web = fs.readFileSync(path.join(root, 'routes', 'web.js'), 'utf8');
const signup = fs.readFileSync(path.join(root, 'views', 'pages', 'signup-seeker.ejs'), 'utf8');

assert.match(api, /Number\.isInteger\(number\) && number >= 3 && number <= 120/);
assert.match(web, /numericAge < 3 \|\| numericAge > 120/);
assert.match(signup, /name="age"[^\n]+min="3" max="120" step="1"[^\n]+required/);

console.log('age validation checks passed');
