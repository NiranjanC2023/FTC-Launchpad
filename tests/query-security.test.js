const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { objectIdString, objectIdValue, inviteTokenFilter } = require('../lib/query-input');
const { normalizeEmail } = require('../lib/notifications');
const User = require('../models/user');
const Team = require('../models/team');
const ManagerInvite = require('../models/managerInvite');

// Stub database availability and model calls, then exercise the real handlers.
// No connection, account changes, or outbound email is required.
require('../lib/database').isDatabaseConnected = () => true;
const router = require('../routes/web');
const id = '1234567890abcdef12345678';
const token = 'ab'.repeat(24);
const user = { _id: new mongoose.Types.ObjectId(id), email: 'member@example.com', validatePassword: async () => true };
function query(result) {
    return { lean() { return this; }, select() { return this; }, sort() { return this; }, exec: async () => result };
}
async function call(method, path, overrides = {}) {
    const route = router.stack.find(layer => layer.route && layer.route.path === path && layer.route.methods[method]).route;
    const req = {
        body: {}, query: {}, params: {},
        session: { userId: id, cookie: {}, regenerate: cb => cb(), save: cb => cb() },
        ...overrides
    };
    const result = {};
    const res = {
        render(view, locals) { Object.assign(result, { view, locals }); },
        redirect(url) { result.redirect = url; },
        status(code) { result.status = code; return this; },
        send(message) { result.message = message; }
    };
    await route.stack[route.stack.length - 1].handle(req, res);
    return result;
}

async function main() {
    const invalid = [{ $ne: null }, { $gt: '' }, { $in: [id] }, [id], 123, null, '', 'invalid'];
    for (const value of invalid) {
        assert.equal(objectIdString(value), null);
        assert.throws(() => objectIdValue(value), /Invalid account identifier/);
        assert.equal(inviteTokenFilter(value), null);
    }
    assert.equal(objectIdValue(id).toHexString(), id);
    assert.deepEqual(inviteTokenFilter(token), { token: { $eq: token } });
    assert.equal(normalizeEmail({ $ne: null }), '');
    assert.equal(normalizeEmail(['member@example.com']), '');
    assert.equal(normalizeEmail(' Member@Example.com '), 'member@example.com');

    const inviteQueries = [];
    ManagerInvite.findOne = filter => { inviteQueries.push(filter); return query(null); };
    User.findOne = () => query(user);
    Team.find = () => query([]);
    Team.findOne = () => query(null);
    for (const value of invalid) {
        for (const path of ['/signup/manager', '/signup/seeker']) {
            const response = await call('get', path, { query: { inviteToken: value } });
            assert.ok(response.view.startsWith('pages/signup-'));
        }
        const response = await call('post', '/login', {
            body: { email: user.email, password: 'test-password', inviteToken: value }
        });
        assert.equal(response.redirect, '/my-applications');
    }
    assert.equal(inviteQueries.length, 0, 'Invalid tokens must never reach a query');
    await call('get', '/signup/manager', { query: { inviteToken: token } });
    await call('get', '/invite/:token', { params: { token } });
    await call('post', '/login', { body: { email: user.email, password: 'test-password', inviteToken: token } });
    assert.equal(inviteQueries.length, 3);
    inviteQueries.forEach(filter => assert.deepEqual(filter, { token: { $eq: token } }));

    const team = { _id: new mongoose.Types.ObjectId(), teamNumber: 1234 };
    User.findById = value => { assert.ok(value instanceof mongoose.Types.ObjectId); return query(user); };
    Team.findOne = () => query(team);
    const candidates = [];
    User.findOne = filter => { candidates.push(filter); return query(null); };
    for (const value of invalid) {
        const response = await call('post', '/manage-team/managers/add', { body: { managerUserId: value } });
        assert.equal(response.redirect, '/manage-team?error=manager_invalid');
    }
    assert.equal(candidates.length, 0, 'Invalid manager IDs must never reach a candidate query');
    await call('post', '/manage-team/managers/add', { body: { managerUserId: id } });
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0]._id.toHexString(), id);
    assert.deepEqual(candidates[0].teamNumber, { $eq: 1234 });

    // Verify equality filters retain expected Mongoose casting without a database.
    const filter = { teamNumber: { $eq: 1234 }, program: { $eq: 'FTC' } };
    const modelQuery = new mongoose.Query(filter, {}, Team, Team.collection);
    assert.deepEqual(modelQuery.cast(Team), filter);
    console.log('NoSQL query security regression tests passed.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
