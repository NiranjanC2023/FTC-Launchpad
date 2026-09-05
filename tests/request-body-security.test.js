const assert = require('node:assert/strict');
const express = require('express');
const bodyParser = require('body-parser');
const getRawBody = require('raw-body');
const { Readable } = require('node:stream');

async function main() {
    const app = express();
    app.post('/urlencoded', bodyParser.urlencoded({ extended: false, limit: '1kb' }), (req, res) => res.json(req.body));
    app.post('/json', express.json({ limit: '1kb' }), (req, res) => res.json(req.body));
    app.use((error, req, res, next) => res.status(error.status || 500).json({ type: error.type || error.name }));

    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    try {
        const base = `http://127.0.0.1:${server.address().port}`;
        let response = await fetch(`${base}/urlencoded`, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: 'name=FTC+Launchpad'
        });
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { name: 'FTC Launchpad' });

        response = await fetch(`${base}/json`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: 'FTC Launchpad' })
        });
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { name: 'FTC Launchpad' });

        response = await fetch(`${base}/json`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ data: 'x'.repeat(2048) })
        });
        assert.equal(response.status, 413);

        const invalidLimitError = await new Promise(resolve => {
            getRawBody(Readable.from(['x']), { limit: 'invalid-limit' }, resolve);
        });
        assert.ok(invalidLimitError instanceof TypeError);
    } finally {
        await new Promise(resolve => server.close(resolve));
    }

    console.log('Request body security regression tests passed.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
