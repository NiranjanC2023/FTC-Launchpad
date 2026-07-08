const assert = require('assert');

const originalBrevoKey = process.env.BREVO_API_KEY;
const originalBrevoFrom = process.env.BREVO_FROM_EMAIL;
const originalEmailFrom = process.env.EMAIL_FROM;
const originalResendKey = process.env.RESEND_API_KEY;

function restoreEnv(key, value) {
    if (typeof value === 'undefined') {
        delete process.env[key];
    } else {
        process.env[key] = value;
    }
}

delete process.env.BREVO_API_KEY;
delete process.env.BREVO_FROM_EMAIL;
delete process.env.EMAIL_FROM;
process.env.RESEND_API_KEY = 're_legacy_key';

const email = require('../lib/email');

assert.strictEqual(email.getBrevoConfigStatus().configured, false);
assert.match(email.getBrevoConfigErrorMessage(), /Missing BREVO_API_KEY and BREVO_FROM_EMAIL or EMAIL_FROM/);
assert.match(email.getBrevoConfigErrorMessage(), /RESEND_API_KEY/);

restoreEnv('BREVO_API_KEY', originalBrevoKey);
restoreEnv('BREVO_FROM_EMAIL', originalBrevoFrom);
restoreEnv('EMAIL_FROM', originalEmailFrom);
restoreEnv('RESEND_API_KEY', originalResendKey);

console.log('email helper config check passed');
