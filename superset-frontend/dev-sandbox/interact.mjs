// Interaction check: open the SingleDateFrame picker, select a different day,
// and assert the encoded value becomes that day's full-day range.
import { chromium } from 'playwright-core';

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push(`PAGEERROR: ${e.message}`));
await page.goto('http://localhost:5199', { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);

// The SingleDateFrame is the first .ant-picker on the page.
const before = (await page.locator('pre').first().textContent())?.trim();
await page.locator('.ant-picker').first().click();
await page.waitForSelector('.ant-picker-cell');
// Pick a specific, in-range day cell by its title (current panel is 2021-03).
const cell = page.locator('.ant-picker-cell[title="2021-03-10"]').first();
await cell.click();
await page.waitForTimeout(500);
const after = (await page.locator('pre').first().textContent())?.trim();

console.log('before:', before);
console.log('after :', after);
console.log('changed:', before !== after);
console.log(
  'matches single-day 2021-03-10:',
  after === '2021-03-10T00:00:00 : 2021-03-11T00:00:00',
);
console.log('runtime errors:', errors.length, errors.join(' | '));
await browser.close();
process.exit(0);
