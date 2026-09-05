const fs = require('fs');
const path = require('path');

function isInsideRoot(rootPath, candidatePath) {
    const relative = path.relative(rootPath, candidatePath);
    return relative !== '' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function walkRegularFiles(rootDirectory) {
    const rootPath = fs.realpathSync(rootDirectory);
    const pendingDirectories = [rootPath];
    const files = [];

    while (pendingDirectories.length) {
        const directory = pendingDirectories.pop();
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            // Never follow links: a link inside assets could point outside the root.
            if (entry.isSymbolicLink()) continue;
            const entryPath = path.resolve(directory, entry.name);
            if (!isInsideRoot(rootPath, entryPath)) {
                throw new Error(`Refusing to access a path outside ${rootPath}`);
            }
            if (entry.isDirectory()) pendingDirectories.push(entryPath);
            else if (entry.isFile()) files.push(entryPath);
        }
    }

    return files;
}

module.exports = { isInsideRoot, walkRegularFiles };
