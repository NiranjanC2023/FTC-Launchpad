const assert = require('node:assert/strict');
const fs = require('node:fs');

const main = fs.readFileSync('assets/js/main.js', 'utf8');
const shell = fs.readFileSync('assets/js/site-shell.js', 'utf8');

for (const [name, source] of [['main.js', main], ['site-shell.js', shell]]) {
    for (const forbiddenSink of [
        'footerTemplate.innerHTML',
        'header.innerHTML',
        'h.innerHTML',
        'inboxList.innerHTML',
        'initialsEl.innerHTML'
    ]) {
        assert.ok(!source.includes(forbiddenSink), `${name} must not use ${forbiddenSink}`);
    }
    assert.match(source, /title\.textContent = String\(notification\.title/);
    assert.match(source, /body\.textContent = String\(notification\.body/);
    assert.match(source, /rawLink\.startsWith\('\/'\) && !rawLink\.startsWith\('\/\/'\)/);
    assert.match(source, /inboxList\.replaceChildren\(\.\.\.notificationElements\)/);
}

assert.ok(!main.includes("fetch('/assets/partial/footer.html')"));
assert.ok(!main.includes("fetch('/assets/partial/header.html"));

console.log('Client DOM XSS regression tests passed.');
