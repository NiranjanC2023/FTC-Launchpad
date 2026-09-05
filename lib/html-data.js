function jsonToBase64(value) {
    const json = JSON.stringify(value === undefined ? null : value);
    return Buffer.from(json, 'utf8').toString('base64');
}

module.exports = { jsonToBase64 };
