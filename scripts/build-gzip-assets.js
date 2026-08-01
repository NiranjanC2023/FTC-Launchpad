const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const assetsRoot = path.join(__dirname, '..', 'assets');
const compressibleExtensions = new Set(['.css', '.html', '.js', '.json', '.svg', '.txt', '.xml']);

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(entryPath) : [entryPath];
  });
}

const sourceFiles = walk(assetsRoot).filter((filePath) => {
  return compressibleExtensions.has(path.extname(filePath).toLowerCase());
});

let compressedCount = 0;
let originalBytes = 0;
let compressedBytes = 0;

for (const sourcePath of sourceFiles) {
  const source = fs.readFileSync(sourcePath);
  const compressed = zlib.gzipSync(source, {
    level: zlib.constants.Z_BEST_COMPRESSION
  });
  const gzipPath = sourcePath + '.gz';

  if (compressed.length < source.length) {
    fs.writeFileSync(gzipPath, compressed);
    compressedCount += 1;
    originalBytes += source.length;
    compressedBytes += compressed.length;
  }
}

console.log(`Precompressed ${compressedCount} assets: ${originalBytes} -> ${compressedBytes} bytes`);
