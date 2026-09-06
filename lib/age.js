function parseDateOfBirth(value) {
    const text = String(value || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
    const [year, month, day] = text.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return date;
}

function isAtLeastAge(value, minimumAge, now = new Date()) {
    const birthDate = parseDateOfBirth(value);
    if (!birthDate) return false;
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    if (birthDate > today) return false;
    const cutoff = new Date(Date.UTC(today.getUTCFullYear() - minimumAge, today.getUTCMonth(), today.getUTCDate()));
    return birthDate <= cutoff;
}

module.exports = { parseDateOfBirth, isAtLeastAge };
