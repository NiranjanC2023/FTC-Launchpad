const fs = require('fs');
const path = require('path');
const CleanCSS = require('clean-css');
const { minify: minifyJavaScript } = require('terser');
const sharp = require('sharp');

const projectRoot = path.join(__dirname, '..');
const assetRoot = path.join(projectRoot, 'assets');

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(entryPath) : [entryPath];
  });
}

async function minifyStylesheets() {
  const stylesheetNames = ['main.css', 'first-start.css', 'icons.css'];
  for (const stylesheetName of stylesheetNames) {
    const sourcePath = path.join(assetRoot, 'css', stylesheetName);
    const outputPath = path.join(assetRoot, 'css', stylesheetName.replace(/\.css$/, '.min.css'));
    const result = new CleanCSS({ level: 2 }).minify(fs.readFileSync(sourcePath, 'utf8'));
    if (result.errors.length) throw new Error(`${stylesheetName}: ${result.errors.join('; ')}`);
    fs.writeFileSync(outputPath, result.styles, 'utf8');
  }
}

async function minifyScripts() {
  const scriptNames = ['main.js', 'first-start.js', 'site-shell.js'];
  for (const scriptName of scriptNames) {
    const sourcePath = path.join(assetRoot, 'js', scriptName);
    const outputPath = path.join(assetRoot, 'js', scriptName.replace(/\.js$/, '.min.js'));
    const result = await minifyJavaScript(fs.readFileSync(sourcePath, 'utf8'), {
      compress: true,
      mangle: true,
      format: { comments: false }
    });
    if (!result.code) throw new Error(`${scriptName}: minifier returned no code`);
    fs.writeFileSync(outputPath, result.code, 'utf8');
  }
}

async function optimizeImages() {
  const imageFiles = walk(path.join(assetRoot, 'img')).filter((filePath) => {
    return /\.(jpe?g|png)$/i.test(filePath);
  });

  await Promise.all(imageFiles.map(async (sourcePath) => {
    const extension = path.extname(sourcePath);
    const outputPath = sourcePath.slice(0, -extension.length) + '.webp';
    const maxWidth = /@2x\./i.test(sourcePath) ? 2400 : 1600;
    const output = await sharp(sourcePath)
      .resize({ width: maxWidth, withoutEnlargement: true })
      .webp({ quality: 78, effort: 4 })
      .toBuffer();
    fs.writeFileSync(outputPath, output);
  }));

  return imageFiles.length;
}

async function build() {
  await minifyStylesheets();
  await minifyScripts();
  const imageCount = await optimizeImages();
  console.log(`Optimized client assets and generated WebP variants for ${imageCount} images`);
}

build().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
