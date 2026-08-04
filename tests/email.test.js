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

restoreEnv('RESEND_API_KEY', originalResendKey);
restoreEnv('RESEND_FROM_EMAIL', originalResendFrom);
restoreEnv('EMAIL_FROM', originalEmailFrom);
restoreEnv('EMAIL_USER', originalEmailUser);
restoreEnv('EMAIL_PASS', originalEmailPass);

console.log('email helper config check passed');
