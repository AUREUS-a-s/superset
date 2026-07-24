// Headless runtime check: load the sandbox in chromium, capture console
// errors + uncaught exceptions, verify #root actually rendered, screenshot.
import { chromium } from 'playwright-core';

const TARGET = process.env.SANDBOX_URL || 'http://localhost:5199';
const SHOT = new URL('./sandbox.png', import.meta.url).pathname;
const browser = await chromium.launch();
const page = await browser.newPage();

const errors = [];
page.on('console', m => {
  if (m.type() === 'error') errors.push(`CONSOLE.error: ${m.text()}`);
});
page.on('pageerror', e => errors.push(`PAGEERROR: ${e.message}`));

try {
  await page.goto(TARGET, { waitUntil: 'networkidle', timeout: 90000 });
} catch (e) {
  console.log('goto failed:', e.message);
}
await page.waitForTimeout(2500);

const rootLen = await page
  .$eval('#root', el => el.innerHTML.length)
  .catch(() => -1);
const hasPicker = await page
  .locator('text=/Relative Date|Configure custom|time range/i')
  .count()
  .catch(() => 0);

await page.screenshot({ path: SHOT, fullPage: true }).catch(() => {});

console.log(`\n#root innerHTML length: ${rootLen} (blank if ~0)`);
console.log(`picker text matches on page: ${hasPicker}`);
console.log(`runtime errors: ${errors.length}`);
if (errors.length) console.log('\n' + errors.slice(0, 30).join('\n'));

await browser.close();
process.exit(0);
