const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { walkRegularFiles } = require('../lib/safe-file-walk');

const assetsRoot = path.join(__dirname, '..', 'assets');
const compressibleExtensions = new Set(['.css', '.html', '.js', '.json', '.svg', '.txt', '.xml']);

const sourceFiles = walkRegularFiles(assetsRoot).filter((filePath) => {
  return compressibleExtensions.has(path.extname(filePath).toLowerCase());
});

let gzipCount = 0;
let brotliCount = 0;
let originalBytes = 0;
let gzipBytes = 0;
let brotliBytes = 0;

for (const sourcePath of sourceFiles) {
  const source = fs.readFileSync(sourcePath);
  const compressed = zlib.gzipSync(source, {
    level: zlib.constants.Z_BEST_COMPRESSION
  });
  const gzipPath = sourcePath + '.gz';

  if (compressed.length < source.length) {
    fs.writeFileSync(gzipPath, compressed);
    gzipCount += 1;
    gzipBytes += compressed.length;
  }

  const brotli = zlib.brotliCompressSync(source, {
    params: {
      [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
      [zlib.constants.BROTLI_PARAM_QUALITY]: zlib.constants.BROTLI_MAX_QUALITY
    }
  });
  if (brotli.length < source.length) {
    fs.writeFileSync(sourcePath + '.br', brotli);
    brotliCount += 1;
    brotliBytes += brotli.length;
  }
  originalBytes += source.length;
}

console.log(`Precompressed ${gzipCount} gzip and ${brotliCount} Brotli assets: ${originalBytes} -> gzip ${gzipBytes}, Brotli ${brotliBytes} bytes`);
