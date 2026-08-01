const fs = require('fs');
const path = require('path');
const CleanCSS = require('clean-css');
const { PurgeCSS } = require('purgecss');
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
    let source = fs.readFileSync(sourcePath, 'utf8');
    if (stylesheetName === 'main.css') {
      const interStyles = fs.readFileSync(path.join(assetRoot, 'vendor', 'inter', 'inter.css'), 'utf8')
        .replace(/url\(\.\//g, 'url(/assets/vendor/inter/');
      const iconStyles = fs.readFileSync(path.join(assetRoot, 'css', 'icons.css'), 'utf8');
      source = `${interStyles}\n${iconStyles}\n${source}`;
    }
    const result = new CleanCSS({ level: 2 }).minify(source);
    if (result.errors.length) throw new Error(`${stylesheetName}: ${result.errors.join('; ')}`);
    fs.writeFileSync(outputPath, result.styles, 'utf8');
  }

  const interStyles = fs.readFileSync(path.join(assetRoot, 'vendor', 'inter', 'inter.css'), 'utf8')
    .replace(/url\(\.\//g, 'url(/assets/vendor/inter/');
  const homeSource = [
    interStyles,
    fs.readFileSync(path.join(assetRoot, 'css', 'icons.css'), 'utf8'),
    fs.readFileSync(path.join(assetRoot, 'css', 'main.css'), 'utf8'),
    fs.readFileSync(path.join(assetRoot, 'css', 'first-start.css'), 'utf8')
  ].join('\n');
  const purgedHome = await new PurgeCSS().purge({
    content: [
      path.join(projectRoot, 'views', 'index.ejs'),
      path.join(assetRoot, 'partial', 'header.html'),
      path.join(assetRoot, 'partial', 'footer.html'),
      path.join(assetRoot, 'js', 'first-start.js'),
      path.join(assetRoot, 'js', 'site-shell.js')
    ],
    css: [{ raw: homeSource }],
    fontFace: false,
    keyframes: false,
    variables: false,
    safelist: {
      standard: ['active', 'is-visible', 'is-open', 'page-motion-ready', 'fs-animations-ready'],
      greedy: [/data-auth-state/, /aria-expanded/, /hidden/]
    }
  });
  const homeResult = new CleanCSS({ level: 2 }).minify(purgedHome[0].css);
  if (homeResult.errors.length) throw new Error(`home.css: ${homeResult.errors.join('; ')}`);
  fs.writeFileSync(path.join(assetRoot, 'css', 'home.min.css'), homeResult.styles, 'utf8');
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
    const outputBase = sourcePath.slice(0, -extension.length);
    const outputPath = outputBase + '.webp';
    const isResponsiveContent = sourcePath.includes(`${path.sep}carousel${path.sep}`)
      || path.basename(sourcePath, extension) === 'why-join-first';
    const maxWidth = /@2x\./i.test(sourcePath) ? 1920 : 1280;
    const quality = path.basename(sourcePath, extension) === 'why-join-first'
      ? 36
      : (sourcePath.includes(`${path.sep}carousel${path.sep}`) ? 38 : 72);
    const output = await sharp(sourcePath)
      .resize({ width: maxWidth, withoutEnlargement: true })
      .webp({ quality, effort: 5 })
      .toBuffer();
    fs.writeFileSync(outputPath, output);

    if (isResponsiveContent && !/@2x\./i.test(sourcePath)) {
      const metadata = await sharp(sourcePath).metadata();
      const widths = [480, 640, 768, 960, 1280].filter((width) => !metadata.width || width <= metadata.width);
      await Promise.all(widths.map(async (width) => {
        const variant = await sharp(sourcePath)
          .resize({ width, withoutEnlargement: true })
          .webp({ quality, effort: 5 })
          .toBuffer();
        fs.writeFileSync(`${outputBase}.w${width}.webp`, variant);
  }));

  const carouselRoot = path.join(assetRoot, 'img', 'carousel');
  const standaloneWebpFiles = walk(carouselRoot).filter((filePath) => {
    return /\.webp$/i.test(filePath) && !/\.w\d+\.webp$/i.test(filePath) && !/@2x\.webp$/i.test(filePath);
  });
  await Promise.all(standaloneWebpFiles.map(async (sourcePath) => {
    const metadata = await sharp(sourcePath).metadata();
    const outputBase = sourcePath.slice(0, -path.extname(sourcePath).length);
    const widths = [480, 640, 768, 960, 1280].filter((width) => metadata.width && width < metadata.width);
    await Promise.all(widths.map(async (width) => {
      const outputPath = `${outputBase}.w${width}.webp`;
      if (fs.existsSync(outputPath)) return;
      await sharp(sourcePath)
        .resize({ width, withoutEnlargement: true })
        .webp({ quality: 38, effort: 5 })
        .toFile(outputPath);
    }));
  }));
}
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
