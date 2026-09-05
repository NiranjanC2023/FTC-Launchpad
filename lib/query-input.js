const mongoose = require('mongoose');

function objectIdString(value) {
    return typeof value === 'string' && /^[a-f\d]{24}$/i.test(value) ? value : null;
}

function objectIdValue(value) {
    const id = objectIdString(value);
    if (!id) throw new TypeError('Invalid account identifier');
    return new mongoose.Types.ObjectId(id);
}

function inviteTokenFilter(value) {
    // Invitation tokens are generated with randomBytes(24).toString('hex').
    if (typeof value !== 'string' || !/^[a-f\d]{48}$/.test(value)) return null;
    return { token: { $eq: value } };
}

module.exports = { objectIdString, objectIdValue, inviteTokenFilter };
