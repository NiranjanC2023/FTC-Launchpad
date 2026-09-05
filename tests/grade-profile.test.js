const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ejs = require('ejs');
const path = require('node:path');

// Exercise the actual profile save handler without a database or email side effects.
const source = fs.readFileSync(path.join(__dirname, '../routes/web.js'), 'utf8');
const start = source.indexOf("router.post('/account/signup-info'");
const end = source.indexOf("router.get('/login'", start);
assert(start >= 0 && end > start);
let handler;
let savedAccount;
const student = { async save() {} };
const query = value => ({ lean() { return this; }, exec: async () => value });
vm.runInNewContext(source.slice(start, end), {
  router: { post(_url, _auth, callback) { handler = callback; } },
  ensureAuthenticated() {},
  isDatabaseConnected: () => true,
  getSignupInfoBackTarget: () => 'account',
  getSignupInfoBackUrl: () => '/account',
  validatePhoneNumber: phone => ({ valid: true, normalized: phone }),
  normalizeEmail: email => email.trim().toLowerCase(),
  canonicalizeCountryRegion: (_country, state) => state,
  User: {
    findById: () => query({ email: 'student@example.test' }),
    findOne: () => query(null),
    findByIdAndUpdate(_id, values) { savedAccount = values; return query(values); }
  },
  Student: { findOne: () => query(student) },
  console
});

(async () => {
  for (const grade of ['Grade 8', 'Grade 9']) {
    let result;
    await handler({ session: { userId: 'test-user' }, body: {
      name: 'Test Student', country: 'United States', state: 'California',
      email: 'student@example.test', currentGrade: grade
    } }, { render(view, values) { result = { view, ...values }; } });
    assert.equal(result.error, null);
    assert.equal(savedAccount.currentGrade, grade);
    assert.equal(student.currentGrade, grade);
    assert.equal(result.values.currentGrade, grade, 'Saved grade must remain selected in the response');
    const html = await ejs.renderFile(path.join(__dirname, '../views/pages/account-signup-info.ejs'), {
      ...result, unitedNationsCountries: [], countriesMatch: () => false,
      countryRegionsFor: () => [], canonicalizeCountryRegion: () => ''
    });
    assert(html.includes(`<option value="${grade}" selected>`), 'Rendered form must select the saved grade');
  }
  console.log('Recruitment profile saves and displays grade changes correctly.');
})().catch(error => { console.error(error); process.exitCode = 1; });
