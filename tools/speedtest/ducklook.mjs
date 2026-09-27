// Duck look check: collect 3 ducklings, walk, screenshot (phone-like screen), then Mama on the lake.
// usage: node ducklook.mjs <outdir> [base-url]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
const [, , outDir = 'ducklook', base = 'http://localhost:8166/'] = process.argv;
fs.mkdirSync(outDir, { recursive: true });
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars'] });
const page = await browser.newPage();
await page.setViewport({ width: 1000, height: 470, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
await page.goto(`${base}?nosave&at=46.2,5`, { waitUntil: 'networkidle0', timeout: 180000 });
await page.waitForFunction(() => window.capy && window.capy.ducks && document.getElementById('loading').classList.contains('done'), { timeout: 180000 });
const walk = async (x, z) => {
  await page.evaluate((x, z) => { const p = window.capy.player; p.path = window.capy.findPath(p.x, p.z, x, z) || []; }, x, z);
  await page.waitForFunction(() => !window.capy.player.path.length, { timeout: 120000 });
};
for (const [x, z] of [[47.3, 3.2], [35.6, 4.8]]) {
  await walk(x, z + 0.6);
  await new Promise((r) => setTimeout(r, 2500));
}
console.log('found', await page.evaluate(() => window.capy.ducks().found));
await walk(42, 9);
// shot while still walking
await page.evaluate(() => { const p = window.capy.player; p.path = window.capy.findPath(p.x, p.z, 46, 14) || []; });
await new Promise((r) => setTimeout(r, 2500));
await page.screenshot({ path: path.join(outDir, '1_walking.png') });
await page.waitForFunction(() => !window.capy.player.path.length, { timeout: 120000 });
await new Promise((r) => setTimeout(r, 2000));
await page.screenshot({ path: path.join(outDir, '2_stopped.png') });
await page.evaluate(() => { const p = window.capy.player; p.x = 54; p.z = 37.9; p.path = []; });
await new Promise((r) => setTimeout(r, 3000));
await page.screenshot({ path: path.join(outDir, '3_lake.png') });
await browser.close();
