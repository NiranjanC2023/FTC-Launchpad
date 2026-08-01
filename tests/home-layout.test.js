const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright-core');

const baseUrl = process.env.LAYOUT_TEST_URL || 'http://127.0.0.1:3105/';
const chromeCandidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
].filter(Boolean);
const executablePath = chromeCandidates.find(candidate => fs.existsSync(candidate));

if (!executablePath) throw new Error('Google Chrome was not found for layout testing.');

async function inspect(page, width, height, label) {
  await page.setViewportSize({ width, height });
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  for (const selector of ['.home-why', '.home-how', '.home-teams', '.home-cta']) {
    const section = page.locator(selector);
    if (await section.count()) {
      await section.scrollIntoViewIfNeeded();
      await page.waitForTimeout(650);
    }
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  const metrics = await page.evaluate(() => {
    const grid = document.querySelector('.home-hero-grid');
    const heading = document.querySelector('.home-hero-copy h1');
    const description = document.querySelector('.hero-description');
    const search = document.querySelector('.home-search');
    const header = document.querySelector('header');
    const brand = document.querySelector('.navbar-brand');
    const navLink = document.querySelector('.navbar-nav > li > a');
    const styles = element => element ? getComputedStyle(element) : null;
    return {
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      gridColumns: styles(grid).gridTemplateColumns.split(' ').length,
      headingSize: parseFloat(styles(heading).fontSize),
      headingAlign: styles(heading).textAlign,
      descriptionSize: parseFloat(styles(description).fontSize),
      searchDirection: styles(search).flexDirection,
      gridWidth: grid.getBoundingClientRect().width,
      headerHeight: header.getBoundingClientRect().height,
      brandSize: parseFloat(styles(brand).fontSize),
      navSize: parseFloat(styles(navLink).fontSize)
      ,hiddenContentCount: Array.from(document.querySelectorAll('.home-why, .home-how, .home-teams, .home-cta'))
        .filter(element => parseFloat(getComputedStyle(element).opacity) === 0).length
      ,clippedHeadingCount: Array.from(document.querySelectorAll('.home-hero-copy h1, .home-cta-content h2, .section-heading h2'))
        .filter(element => element.scrollWidth > element.clientWidth + 1).length
      ,wrappedNavCount: Array.from(document.querySelectorAll('.navbar-nav > li > a'))
        .filter(element => element.getClientRects().length && element.scrollWidth > element.clientWidth + 1).length
    };
  });

  const screenshotPath = path.join(os.tmpdir(), `first-start-${label}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  return { ...metrics, screenshotPath };
}

async function inspectForm(page, route, width, label) {
  await page.setViewportSize({ width, height: 844 });
  await page.goto(new URL(route, baseUrl).href, { waitUntil: 'networkidle' });
  const metrics = await page.evaluate(() => {
    const form = document.querySelector('form');
    const input = document.querySelector('.form-control, input:not([type="hidden"])');
    const button = document.querySelector('button[type="submit"], input[type="submit"]');
    const styles = element => element ? getComputedStyle(element) : null;
    const formRect = form.getBoundingClientRect();
    return {
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      formLeft: formRect.left,
      formRight: formRect.right,
      inputSize: parseFloat(styles(input).fontSize),
      buttonSize: parseFloat(styles(button).fontSize)
    };
  });
  const screenshotPath = path.join(os.tmpdir(), `first-start-${label}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  return { ...metrics, screenshotPath };
}

(async () => {
  const browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage();
  const browserErrors = [];
  page.on('pageerror', error => browserErrors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });
  try {
    const desktop = await inspect(page, 1920, 1080, 'desktop');
    const intermediate = await inspect(page, 1536, 864, 'intermediate');
    const compact = await inspect(page, 1195, 700, 'compact');
    const mobile = await inspect(page, 390, 844, 'mobile');
    const forms = {
      loginDesktop: await inspectForm(page, '/login', 1195, 'login-desktop'),
      loginMobile: await inspectForm(page, '/login', 390, 'login-mobile'),
      signupDesktop: await inspectForm(page, '/signup/seeker', 1195, 'signup-desktop'),
      signupMobile: await inspectForm(page, '/signup/seeker', 390, 'signup-mobile')
    };

    console.log(JSON.stringify({ desktop, intermediate, compact, mobile, forms, browserErrors }, null, 2));

    assert.strictEqual(desktop.gridColumns, 2, '1920px homepage should use two hero columns');
    assert.strictEqual(intermediate.gridColumns, 2, '1536px homepage should use two hero columns');
    assert.strictEqual(compact.gridColumns, 1, '1195px homepage should use one hero column');
    assert.strictEqual(mobile.gridColumns, 1, 'mobile homepage should use one hero column');
    assert(desktop.headingSize >= 60 && desktop.headingSize <= 72, 'desktop heading size is outside the intended range');
    assert(compact.headingSize >= 50 && compact.headingSize <= 70, 'compact heading size is outside the intended range');
    assert(mobile.headingSize >= 36 && mobile.headingSize <= 56, 'mobile heading size is outside the intended range');
    assert.strictEqual(compact.headingAlign, 'center', 'compact hero heading should be centered');
    assert.strictEqual(desktop.headingAlign, 'left', 'desktop hero heading should be left aligned');
    assert(desktop.headerHeight <= 72, 'desktop header is taller than intended');
    assert(desktop.brandSize <= 24, 'desktop brand text is larger than intended');
    assert(desktop.navSize <= 18, 'desktop navigation text is larger than intended');
    assert.strictEqual(mobile.searchDirection, 'column', 'mobile search form should stack');
    [desktop, intermediate, compact, mobile].forEach(result => {
      assert(result.documentWidth <= result.viewportWidth + 1, `${result.viewportWidth}px layout has horizontal overflow`);
      assert.strictEqual(result.hiddenContentCount, 0, `${result.viewportWidth}px layout left a homepage section hidden after scrolling`);
      assert.strictEqual(result.clippedHeadingCount, 0, `${result.viewportWidth}px layout clips a heading`);
      assert.strictEqual(result.wrappedNavCount, 0, `${result.viewportWidth}px layout wraps or clips navigation text`);
    });
    Object.values(forms).forEach(result => {
      assert(result.documentWidth <= result.viewportWidth + 1, `${result.viewportWidth}px form layout has horizontal overflow`);
      assert(result.formLeft >= 0 && result.formRight <= result.viewportWidth + 1, `${result.viewportWidth}px form extends outside the viewport`);
      assert(result.inputSize >= 16, `${result.viewportWidth}px form inputs are too small`);
      assert(result.buttonSize >= 14 && result.buttonSize <= 18, `${result.viewportWidth}px form buttons are outside the intended size range`);
    });
    assert.deepStrictEqual(browserErrors, [], 'browser console or page errors were detected');

  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
