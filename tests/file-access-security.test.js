const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { isInsideRoot, walkRegularFiles } = require('../lib/safe-file-walk');

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ftc-safe-walk-'));
try {
    const assetsRoot = path.join(temporaryRoot, 'assets');
    const nested = path.join(assetsRoot, 'js');
    const sibling = path.join(temporaryRoot, 'assets-private');
    fs.mkdirSync(nested, { recursive: true });
    fs.mkdirSync(sibling);
    const safeFile = path.join(nested, 'app.js');
    const secretFile = path.join(sibling, 'secret.txt');
    fs.writeFileSync(safeFile, 'safe');
    fs.writeFileSync(secretFile, 'secret');

    assert.equal(isInsideRoot(assetsRoot, safeFile), true);
    assert.equal(isInsideRoot(assetsRoot, assetsRoot), false);
    assert.equal(isInsideRoot(assetsRoot, secretFile), false);
    assert.equal(isInsideRoot(assetsRoot, path.resolve(assetsRoot, '..', 'secret.txt')), false);
    assert.deepEqual(walkRegularFiles(assetsRoot), [safeFile]);

    // If this platform permits symlinks, verify the walker will not follow one.
    try {
        fs.symlinkSync(sibling, path.join(assetsRoot, 'linked-private'), 'junction');
        assert.deepEqual(walkRegularFiles(assetsRoot), [safeFile]);
    } catch (error) {
        if (!['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) throw error;
    }
} finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
}

const appSource = fs.readFileSync('app.js', 'utf8');
assert.ok(!appSource.includes('decodedPath'));
assert.ok(!appSource.includes('servePrecompressedAsset'));
assert.match(appSource, /express\.static\(ASSETS_ROOT/);

console.log('File access security regression tests passed.');
