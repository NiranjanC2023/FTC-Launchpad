const DEFAULT_FROM_EMAIL = process.env.BREVO_FROM_EMAIL || 'no-reply@findfirst.org';
const DEFAULT_FROM_NAME = process.env.EMAIL_NAME || 'FIRST Start';
const DEFAULT_FROM = process.env.EMAIL_FROM || `"${DEFAULT_FROM_NAME}" <${DEFAULT_FROM_EMAIL}>`;

function getBrevoApiKey() {
    return String(process.env.BREVO_API_KEY || '').trim().replace(/^here/i, '');
}

function getBrevoConfigStatus() {
    const apiKey = getBrevoApiKey();
    const fromEmail = String(process.env.BREVO_FROM_EMAIL || process.env.EMAIL_FROM || '').trim();
    return {
        configured: Boolean(apiKey && fromEmail),
        hasApiKey: Boolean(apiKey),
        hasFromEmail: Boolean(fromEmail),
        hasLegacyResendKey: Boolean(String(process.env.RESEND_API_KEY || '').trim()),
        hasLegacyResendFromEmail: Boolean(String(process.env.RESEND_FROM_EMAIL || '').trim())
    };
}

function getBrevoConfigErrorMessage() {
    const status = getBrevoConfigStatus();
    const missing = [];
    if (!status.hasApiKey) missing.push('BREVO_API_KEY');
    if (!status.hasFromEmail) missing.push('BREVO_FROM_EMAIL or EMAIL_FROM');

    let message = `Brevo is not configured. Missing ${missing.join(' and ')} in .env.`;
    if (status.hasLegacyResendKey || status.hasLegacyResendFromEmail) {
        message += ' This project currently sends through Brevo, so RESEND_API_KEY and RESEND_FROM_EMAIL will not be used.';
    }
    return message;
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

async function sendBrevoEmail(mailOptions) {
    const brevoApiKey = getBrevoApiKey();
    if (!brevoApiKey || !getBrevoConfigStatus().hasFromEmail) {
        throw new Error(getBrevoConfigErrorMessage());
    }

    const normalizedRecipients = Array.isArray(mailOptions.to)
        ? mailOptions.to
        : String(mailOptions.to || '')
            .split(',')
            .map(value => value.trim())
            .filter(Boolean);

    const sender = parseEmailAddress(mailOptions.from || DEFAULT_FROM);
    const payload = {
        sender: {
            name: sender.name || DEFAULT_FROM_NAME,
            email: sender.email || DEFAULT_FROM_EMAIL
        },
        to: normalizedRecipients.map((recipient) => ({ email: recipient })),
        subject: mailOptions.subject || '',
        htmlContent: mailOptions.html || '',
        textContent: mailOptions.text || undefined,
        replyTo: mailOptions.replyTo || mailOptions.reply_to ? {
            email: String(mailOptions.replyTo || mailOptions.reply_to).trim()
        } : undefined
    };

    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
            'accept': 'application/json',
            'api-key': brevoApiKey,
            'content-type': 'application/json'
        },
        body: JSON.stringify(payload)
    });

    if (response.ok) {
        return response.json();
    }

    const errorText = await response.text().catch(() => '');
    let errorMessage = errorText || `Brevo send failed with status ${response.status}.`;
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
    getBrevoConfigErrorMessage,
    getBrevoConfigStatus,
    sendBrevoEmail
};
