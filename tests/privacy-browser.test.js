const assert = require('assert');
const { chromium } = require('playwright-core');

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const baseUrl = process.env.PRIVACY_TEST_URL || 'http://127.0.0.1:3000';

let browser;

(async () => {
  console.log('launching browser');
  browser = await chromium.launch({ executablePath: chromePath, headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });

  await page.addInitScript(() => {
    localStorage.setItem('studentInfo_v1', JSON.stringify({ name: 'legacy applicant PII', latitude: 1, longitude: 2 }));
    sessionStorage.setItem('studentInfo_v1', JSON.stringify({ name: 'legacy applicant PII', latitude: 1, longitude: 2 }));
    window.__geolocationRequestCount = 0;
    if (navigator.geolocation && navigator.geolocation.getCurrentPosition) {
      const original = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
      navigator.geolocation.getCurrentPosition = (...args) => {
        window.__geolocationRequestCount += 1;
        return original(...args);
      };
    }
  });

  console.log('opening teams page');
  await page.goto(`${baseUrl}/teams-nearby`, { waitUntil: 'commit', timeout: 30000 });
  console.log('waiting for page content');
  await page.waitForSelector('#teamsContainer', { timeout: 30000 });
  await page.waitForTimeout(2000);
  console.log('checking privacy state');
  const state = await page.evaluate(() => ({
    localApplicantData: localStorage.getItem('studentInfo_v1'),
    sessionApplicantData: sessionStorage.getItem('studentInfo_v1'),
    geolocationRequests: window.__geolocationRequestCount,
    horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
  }));
  assert.strictEqual(state.localApplicantData, null);
  assert.strictEqual(state.sessionApplicantData, null);
  assert.strictEqual(state.geolocationRequests, 0);
  assert.strictEqual(state.horizontalOverflow, false);
  assert.deepStrictEqual(errors, []);
  await page.screenshot({ path: `${process.env.TEMP}\\first-start-privacy-fixed.png`, fullPage: true });

  console.log(JSON.stringify(state));
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close();
});
