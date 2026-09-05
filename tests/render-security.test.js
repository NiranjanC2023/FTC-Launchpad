const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const { renderView } = require('../lib/render-view');
const { accountFormValues, teamFormValues, formString, signupView } = require('../lib/form-values');

async function main() {
    const payload = '<%= 123456 * 654321 %><script>alert(1)</script>';
    const hostile = JSON.parse('{"settings":{"view options":{"client":true}},"__proto__":{"polluted":true},"constructor":{},"password":"do-not-redisplay","email":["a","b"],"country":{"toString":"bad"}}');
    hostile.name = payload;
    for (const pick of [accountFormValues, teamFormValues]) {
        const values = pick(hostile);
        assert.equal(Object.getPrototypeOf(values), null);
        assert.deepEqual(Object.keys(values), ['name']);
        assert.equal(values.name, payload);
        assert.equal(pick(Object.create({ name: 'inherited' })).name, undefined);
    }
    assert.equal(formString(['token']), '');
    assert.equal(signupView('../../app'), 'pages/signup-seeker');
    assert.equal(signupView('manager'), 'pages/signup-manager');

    // Exercise the real EJS compiler: malicious options must remain inert data.
    const html = await new Promise((resolve, reject) => renderView(
        path.join(__dirname, '../views/pages/signup-manager.ejs'),
        {
            error: null, values: accountFormValues(hostile), inviteToken: '', nextPath: '',
            delimiter: '?', client: true,
            settings: { 'view options': {
                client: true,
                escapeFunction: 'function () { throw new Error("injected compiler option"); }',
                outputFunctionName: 'not a valid identifier'
            } }
        },
        (error, result) => error ? reject(error) : resolve(result)
    ));
    assert.equal(typeof html, 'string');
    assert.ok(html.includes('&lt;%= 123456 * 654321 %&gt;'));
    assert.ok(!html.includes('<script>alert(1)</script>'));
    assert.ok(!html.includes('do-not-redisplay'));

    // No database or mail service: cover real route error renders via HTTP.
    const app = express();
    app.set('views', path.join(__dirname, '../views'));
    app.set('view engine', 'ejs');
    app.engine('ejs', renderView);
    app.use(express.urlencoded({ extended: true }));
    app.use(express.json());
    app.locals.unitedNationsCountries = require('../lib/country').UNITED_NATIONS_COUNTRIES;
    app.locals.countriesMatch = require('../lib/country').countriesMatch;
    app.locals.countryRegionsFor = require('../lib/country-regions').getCountryRegions;
    app.locals.canonicalizeCountryRegion = require('../lib/country-regions').canonicalizeCountryRegion;
    app.use((req, res, next) => {
        req.session = { userId: 'test-user' };
        const render = res.render.bind(res);
        res.render = (view, locals) => {
            if (locals.values) {
                assert.equal(locals.values.settings, undefined);
                assert.equal(locals.values.password, undefined);
                assert.equal(locals.values.email, undefined);
            }
            return render(view, locals);
        };
        next();
    });
    app.use(require('../routes/web'));
    const server = await new Promise(resolve => {
        const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    try {
        const base = `http://127.0.0.1:${server.address().port}`;
        for (const [url, body] of [
            ['/signup', { ...hostile, signupMode: 'manager' }],
            ['/signup', { ...hostile, signupMode: '../../app' }],
            ['/team-register', hostile],
            ['/team-register/email-verification', hostile],
            ['/account/signup-info', hostile]
        ]) {
            const response = await fetch(base + url, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
            });
            assert.equal(response.status, 200, url);
            const content = await response.text();
            assert.ok(content.includes('&lt;%= 123456 * 654321 %&gt;'), url);
            assert.ok(!content.includes('do-not-redisplay'), url);
        }
        for (const url of ['/signup', '/signup/seeker', '/signup/manager', '/login']) {
            const response = await fetch(base + url + '?inviteToken[settings][client]=true&notice[x]=bad&next[x]=bad');
            assert.equal(response.status, 200, url);
            assert.ok(!(await response.text()).includes('[object Object]'), url);
        }
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
    console.log('Render security regression tests passed.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
