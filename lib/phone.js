function normalizePhoneInput(value) {
    return String(value || '').trim();
}

function isObviousFakeNorthAmericanPhone(nationalDigits) {
    const fakeNumbers = new Set([
        '0000000000',
        '1111111111',
        '2222222222',
        '3333333333',
        '4444444444',
        '5555555555',
        '6666666666',
        '7777777777',
        '8888888888',
        '9999999999',
        '0123456789',
        '1234567890',
        '1231231234',
        '9876543210'
    ]);

    if (fakeNumbers.has(nationalDigits)) return true;
    if (/^(\d)\1{9}$/.test(nationalDigits)) return true;
    if (/^55501\d{4}$/.test(nationalDigits)) return true;

    return false;
}

function formatUsPhoneNumber(nationalDigits) {
    return `+1${nationalDigits}`;
}

function validatePhoneNumber(value, { required = false } = {}) {
    const raw = normalizePhoneInput(value);
    if (!raw) {
        return required
            ? { valid: false, normalized: '', error: 'Enter a valid phone number.' }
            : { valid: true, normalized: '', error: null };
    }

    if (/[A-Za-z]/.test(raw)) {
        return { valid: false, normalized: '', error: 'Enter a valid phone number.' };
    }

    const digits = raw.replace(/\D/g, '');
    const hasLeadingPlus = raw.startsWith('+');
    const nationalDigits = digits.length === 11 && digits.startsWith('1')
        ? digits.slice(1)
        : digits.length === 10
            ? digits
            : null;

    if (!nationalDigits) {
        return { valid: false, normalized: '', error: 'Enter a valid phone number.' };
    }

    if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(nationalDigits)) {
        return { valid: false, normalized: '', error: 'Enter a valid phone number.' };
    }

    if (isObviousFakeNorthAmericanPhone(nationalDigits)) {
        return { valid: false, normalized: '', error: 'Enter a valid phone number.' };
    }

    if (hasLeadingPlus && digits.length !== 11) {
        return { valid: false, normalized: '', error: 'Enter a valid phone number.' };
    }

    return {
        valid: true,
        normalized: formatUsPhoneNumber(nationalDigits),
        error: null
    };
}

module.exports = {
    normalizePhoneInput,
    validatePhoneNumber
};
