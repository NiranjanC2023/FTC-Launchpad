const assert = require('assert');

const originalResendKey = process.env.RESEND_API_KEY;
const originalResendFrom = process.env.RESEND_FROM_EMAIL;
const originalEmailFrom = process.env.EMAIL_FROM;
const originalEmailUser = process.env.EMAIL_USER;
const originalEmailPass = process.env.EMAIL_PASS;

function restoreEnv(key, value) {
    if (typeof value === 'undefined') {
        delete process.env[key];
    } else {
        process.env[key] = value;
    }
}

delete process.env.RESEND_API_KEY;
delete process.env.RESEND_FROM_EMAIL;
delete process.env.EMAIL_FROM;
delete process.env.EMAIL_USER;
delete process.env.EMAIL_PASS;

const email = require('../lib/email');

assert.strictEqual(email.getEmailConfigStatus().configured, false);
assert.match(email.getEmailConfigErrorMessage(), /Email is not configured/);
assert.strictEqual(typeof email.sendTransactionalEmail, 'function');
assert.strictEqual(typeof email.buildEmailIdempotencyKey, 'function');

const payload = {
    from: 'FIRST Start <mail@findfirst.org>',
    to: ['Student@Example.com'],
    subject: 'Application received',
    html: '<p>Hello</p>'
};
const duplicateKey = email.buildEmailIdempotencyKey({ ...payload });
assert.strictEqual(email.buildEmailIdempotencyKey(payload), duplicateKey);
assert.match(duplicateKey, /^first-start\/[a-f0-9]{64}$/);
assert.notStrictEqual(
    email.buildEmailIdempotencyKey({ ...payload, subject: 'Different event' }),
    duplicateKey
);

restoreEnv('RESEND_API_KEY', originalResendKey);
restoreEnv('RESEND_FROM_EMAIL', originalResendFrom);
restoreEnv('EMAIL_FROM', originalEmailFrom);
restoreEnv('EMAIL_USER', originalEmailUser);
restoreEnv('EMAIL_PASS', originalEmailPass);

console.log('email helper config check passed');
