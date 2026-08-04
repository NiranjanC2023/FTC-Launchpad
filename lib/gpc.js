function hasGlobalPrivacyControl(headerValue) {
  return String(headerValue || '')
    .split(',')
    .some(value => value.trim() === '1');
}

module.exports = { hasGlobalPrivacyControl };
