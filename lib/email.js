const nodemailer = require('nodemailer');

const DEFAULT_FROM_EMAIL = process.env.EMAIL_FROM_EMAIL || process.env.RESEND_FROM_EMAIL || process.env.EMAIL_USER || 'no-reply@findfirst.org';
const DEFAULT_FROM_NAME = process.env.EMAIL_NAME || 'FIRST Start';
const DEFAULT_FROM = process.env.EMAIL_FROM || `"${DEFAULT_FROM_NAME}" <${DEFAULT_FROM_EMAIL}>`;

function getResendApiKey() {
    return String(process.env.RESEND_API_KEY || '').trim();
}

function getEmailConfigStatus() {
    const apiKey = getResendApiKey();
    const smtpUser = String(process.env.EMAIL_USER || '').trim();
    const smtpPass = String(process.env.EMAIL_PASS || '').trim();
    return {
        configured: Boolean(apiKey || (smtpUser && smtpPass)),
        hasApiKey: Boolean(apiKey),
        hasFromEmail: Boolean(String(process.env.RESEND_FROM_EMAIL || process.env.EMAIL_FROM || process.env.EMAIL_FROM_EMAIL || process.env.EMAIL_USER || '').trim()),
        hasSmtpCredentials: Boolean(smtpUser && smtpPass)
    };
}

function getEmailConfigErrorMessage() {
    const status = getEmailConfigStatus();
    if (!status.configured) return 'Email is not configured. Add RESEND_API_KEY or EMAIL_USER/EMAIL_PASS in .env.';
    if (!status.hasFromEmail && !status.hasSmtpCredentials) return 'Email sender is not configured. Set EMAIL_FROM, RESEND_FROM_EMAIL, or EMAIL_USER in .env.';
    return 'Email sender is using the default from address.';
}

function parseEmailAddress(value) {
    const input = String(value || '').trim();
    if (!input) return { name: '', email: '' };
    const match = input.match(/^(?:"?([^"]*)"?\s*)?<([^<>]+)>$/);
    if (match) {
        return {
            name: String(match[1] || '').trim(),
            email: String(match[2] || '').trim()
        };
    }
    return { name: '', email: input };
}

function normalizeRecipientList(to) {
    return Array.isArray(to)
        ? to.map(value => String(value || '').trim()).filter(Boolean)
        : String(to || '')
            .split(',')
            .map(value => value.trim())
            .filter(Boolean);
}

function createSmtpTransport() {
    const user = String(process.env.EMAIL_USER || '').trim();
    const pass = String(process.env.EMAIL_PASS || '').trim();
    if (!user || !pass) return null;

    return nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user,
            pass
        }
    });
}

function buildTransactionalEmailTemplate({ preheader, title, intro, ctaLabel, ctaUrl, outro, footer, details = [] }) {
    const safePreheader = String(preheader || '').trim();
    const safeTitle = String(title || '').trim();
    const safeIntro = String(intro || '').trim();
    const safeCtaLabel = String(ctaLabel || '').trim();
    const safeCtaUrl = String(ctaUrl || '').trim();
    const safeOutro = String(outro || '').trim();
    const safeFooter = String(footer || '').trim();
    const safeDetails = Array.isArray(details) ? details : [];

    const detailMarkup = safeDetails.length
        ? `
          <div style="margin:24px 0;padding:18px 20px;background:#f6faf7;border:1px solid #d8e5dd;border-radius:14px;">
            ${safeDetails.map((item) => `
              <div style="margin:0 0 12px;">
                <div style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#6a7e73;font-weight:700;">${String(item.label || '').trim()}</div>
                <div style="margin-top:4px;font-size:16px;line-height:1.6;color:#234033;">${String(item.value || '').trim()}</div>
              </div>
            `).join('')}
          </div>
        `
        : '';

    return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f3f7f4;font-family:Arial,Helvetica,sans-serif;color:#163026;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">${safePreheader}</div>
    <div style="padding:32px 16px;">
      <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #dbe8df;border-radius:20px;overflow:hidden;box-shadow:0 18px 50px rgba(15, 48, 35, 0.10);">
        <div style="padding:28px 32px 20px;background:linear-gradient(135deg,#0f3922,#145437);color:#fff;">
          <div style="display:inline-block;padding:8px 12px;border-radius:999px;background:rgba(255,255,255,0.12);font-size:12px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;">FIRST Start</div>
          <h1 style="margin:18px 0 0;font-size:28px;line-height:1.15;font-weight:800;">${safeTitle}</h1>
        </div>
        <div style="padding:32px;">
          <p style="margin:0 0 18px;font-size:17px;line-height:1.75;color:#234033;">${safeIntro}</p>
          ${detailMarkup}
          ${safeCtaUrl && safeCtaLabel ? `
          <div style="margin:28px 0 24px;">
            <a href="${safeCtaUrl}" style="display:inline-block;padding:14px 22px;background:#18a15e;color:#ffffff;text-decoration:none;border-radius:12px;font-size:16px;font-weight:700;">${safeCtaLabel}</a>
          </div>
          ` : ''}
          ${safeOutro ? `<p style="margin:0;font-size:16px;line-height:1.7;color:#355145;">${safeOutro}</p>` : ''}
          ${safeCtaUrl ? `<p style="margin:28px 0 0;font-size:14px;line-height:1.65;color:#6a7e73;">If the button does not work, copy and paste this link into your browser:<br><a href="${safeCtaUrl}" style="color:#0f7a44;word-break:break-all;">${safeCtaUrl}</a></p>` : ''}
        </div>
        <div style="padding:18px 32px 28px;border-top:1px solid #e2ece6;background:#fbfdfb;color:#6a7e73;font-size:13px;line-height:1.6;">
          <div style="font-weight:700;color:#355145;margin-bottom:4px;">FIRST Start Support</div>
          <div>${safeFooter}</div>
        </div>
      </div>
    </div>
  </body>
</html>`;
}

async function sendTransactionalEmail(mailOptions = {}) {
    const recipients = normalizeRecipientList(mailOptions.to);
    if (!recipients.length) {
        throw new Error('At least one recipient email is required.');
    }

    const sender = parseEmailAddress(mailOptions.from || DEFAULT_FROM);
    const payload = {
        from: mailOptions.from || DEFAULT_FROM,
        to: recipients.length === 1 ? recipients[0] : recipients,
        subject: String(mailOptions.subject || '').trim(),
        html: String(mailOptions.html || ''),
        text: String(mailOptions.text || '') || undefined,
        reply_to: String(mailOptions.replyTo || mailOptions.reply_to || '').trim() || undefined
    };

    if (!payload.subject) {
        throw new Error('Email subject is required.');
    }

    const smtpTransport = createSmtpTransport();
    if (smtpTransport) {
        try {
            const info = await smtpTransport.sendMail({
                from: payload.from,
                to: payload.to,
                subject: payload.subject,
                html: payload.html,
                text: payload.text,
                replyTo: payload.reply_to
            });
            return {
                id: info && info.messageId ? info.messageId : undefined,
                from: sender.email || DEFAULT_FROM_EMAIL,
                to: recipients
            };
        } catch (smtpErr) {
            const apiKey = getResendApiKey();
            if (!apiKey) {
                throw smtpErr;
            }

            const response = await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            if (response.ok) {
                const data = await response.json().catch(() => ({}));
                return {
                    ...data,
                    from: sender.email || DEFAULT_FROM_EMAIL,
                    to: recipients
                };
            }

            const errorText = await response.text().catch(() => '');
            let errorMessage = errorText || `Resend send failed with status ${response.status}.`;
            try {
                const parsed = JSON.parse(errorText);
                if (parsed && parsed.message) {
                    errorMessage = String(parsed.message);
                }
            } catch (err) {}
            throw new Error(errorMessage);
        }
    }

    const apiKey = getResendApiKey();
    if (!apiKey) {
        throw new Error(getEmailConfigErrorMessage());
    }

    const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });

    if (response.ok) {
        const data = await response.json().catch(() => ({}));
        return {
            ...data,
            from: sender.email || DEFAULT_FROM_EMAIL,
            to: recipients
        };
    }

    const errorText = await response.text().catch(() => '');
    let errorMessage = errorText || `Resend send failed with status ${response.status}.`;
    try {
        const parsed = JSON.parse(errorText);
        if (parsed && parsed.message) {
            errorMessage = String(parsed.message);
        }
    } catch (err) {}
    throw new Error(errorMessage);
}

module.exports = {
    DEFAULT_FROM,
    DEFAULT_FROM_EMAIL,
    DEFAULT_FROM_NAME,
    buildTransactionalEmailTemplate,
    getEmailConfigErrorMessage,
    getEmailConfigStatus,
    parseEmailAddress,
    createSmtpTransport,
    sendTransactionalEmail
};
