const assert = require('node:assert/strict');
const { isExcludedTraffic, publicTrafficFilter } = require('../lib/site-traffic');

const cases = [
    ['localhost:3000', 'Mozilla/5.0', true],
    ['LOCALHOST', '', true],
    ['test.localhost', '', true],
    ['127.0.0.1:3000', '', true],
    ['[::1]:3000', '', true],
    ['::ffff:127.0.0.1', '', true],
    ['0.0.0.0', '', true],
    ['example.com', 'Mozilla/5.0 (compatible; UptimeRobot/2.0; http://www.uptimerobot.com/)', true],
    ['example.com', 'Uptime-Kuma/1.0', true],
    ['example.com', 'uptime bot', true],
    ['example.com', 'Pingdom.com_bot_version_1.4', true],
    ['example.com', 'Better Uptime Bot', true],
    ['example.com', 'Mozilla/5.0', false],
    ['localhost.example.com', 'Mozilla/5.0', false],
    [undefined, undefined, false]
];
for (const [host, agent, excluded] of cases) {
    assert.equal(isExcludedTraffic(host, agent), excluded, `${host}: ${agent}`);
    const filter = publicTrafficFilter();
    const includedInStats = !filter.host.$not.test(host || '') && !filter.userAgent.$not.test(agent || '');
    assert.equal(includedInStats, !excluded, 'Historical filter must match recording exclusions');
}
for (const path of ['/wp-admin/install.php', '/WP-ADMIN/', '/wp-login.php', '/wordpress/', '/.env', '/.env.production', '/.git/config', '/phpmyadmin/', '/index.php']) {
    assert.equal(isExcludedTraffic('example.com', 'Mozilla/5.0', path), true, path);
    assert.equal(publicTrafficFilter().path.$not.test(path), true, path);
}
for (const path of ['/', '/teams-nearby', '/account', '/resources/programming']) {
    assert.equal(isExcludedTraffic('example.com', 'Mozilla/5.0', path), false, path);
}

// Exercise the real middleware without a server or database.
const fs = require('node:fs');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const source = fs.readFileSync(require.resolve('../routes/web'), 'utf8');
const start = source.indexOf('router.use(function trackSiteTraffic');
const end = source.indexOf('\nrouter.use(', start + 1);
let middleware;
const visits = [];
vm.runInNewContext(source.slice(start, end), {
    router: { use(fn) { middleware = fn; } },
    isExcludedTraffic,
    isDatabaseConnected: () => true,
    SiteVisit: { create(visit) { visits.push(visit); return Promise.resolve(); } },
    console
});
for (const [path, status, type, expected] of [
    ['/', 200, 'text/html; charset=utf-8', 1],
    ['/missing', 404, 'text/html', 0],
    ['/error', 500, 'text/html', 0],
    ['/account', 302, 'text/html', 0],
    ['/data', 200, 'application/json', 0],
    ['/wp-admin/install.php', 200, 'text/html', 0]
]) {
    visits.length = 0;
    const res = new EventEmitter();
    res.statusCode = status;
    res.getHeader = () => type;
    let nextCalls = 0;
    middleware({ method: 'GET', path, hostname: 'example.com', get: () => 'Mozilla/5.0' }, res, () => nextCalls++);
    assert.equal(nextCalls, 1);
    assert.equal(visits.length, 0, 'Must wait for the completed response');
    res.emit('finish');
    assert.equal(visits.length, expected, `${path} ${status}`);
}
console.log('Site traffic exclusion and response tracking tests passed.');
