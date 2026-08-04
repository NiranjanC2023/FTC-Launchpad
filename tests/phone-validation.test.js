const assert = require('assert');
const { validatePhoneNumber } = require('../lib/phone');

const validUs = validatePhoneNumber('(415) 555-2671', { required: true });
assert.strictEqual(validUs.valid, true);
assert.strictEqual(validUs.normalized, '+14155552671');

const optionalBlank = validatePhoneNumber('', { required: false });
assert.strictEqual(optionalBlank.valid, true);
assert.strictEqual(optionalBlank.normalized, '');

const tooShort = validatePhoneNumber('12345', { required: true });
assert.strictEqual(tooShort.valid, false);

const fakeSequential = validatePhoneNumber('1234567890', { required: true });
assert.strictEqual(fakeSequential.valid, false);

const fakeReserved = validatePhoneNumber('555-010-1234', { required: true });
assert.strictEqual(fakeReserved.valid, false);

const letters = validatePhoneNumber('abc1234567', { required: true });
assert.strictEqual(letters.valid, false);

console.log('phone validation checks passed');
