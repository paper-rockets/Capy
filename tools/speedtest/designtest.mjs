// Designed map check: open ?map=<key>, screenshot the start, a few spots and the whole map.
// usage: node designtest.mjs <key> <outdir> [x,z ...]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
const [, , key = 'old_orchard', outDir = 'design', ...spots] = process.argv;
fs.mkdirSync(outDir, { recursive: true });
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars'] });
const page = await browser.newPage();
await page.setViewport({ width: 1333, height: 632, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
page.on('console', (m) => { const t = m.text(); if (m.type() === 'error' || /designed map|picture sheet/.test(t)) console.log(m.type(), t.slice(0, 300)); });
const t0 = Date.now();
await page.goto(`http://localhost:8166/?map=${key}&nosave`, { waitUntil: 'networkidle0', timeout: 240000 });
await page.waitForFunction(() => document.getElementById('loading').classList.contains('done') || /Error/.test(document.getElementById('loading-status').textContent), { timeout: 240000 });
console.log('loaded in', Date.now() - t0, 'ms', await page.evaluate(() => document.getElementById('loading-status').textContent));
await new Promise((r) => setTimeout(r, 2500));
await page.screenshot({ path: path.join(outDir, `${key}_0_start.png`) });
let n = 1;
for (const s of spots) {
  const [x, z] = s.split(',').map(Number);
  await page.evaluate((x, z) => { const p = window.capy.player; p.x = x; p.z = z; p.path = []; }, x, z);
  await new Promise((r) => setTimeout(r, 2500));
  await page.screenshot({ path: path.join(outDir, `${key}_${n++}_${x}_${z}.png`) });
}
await page.evaluate(() => window.capy.setView(46));
await new Promise((r) => setTimeout(r, 2500));
await page.screenshot({ path: path.join(outDir, `${key}_whole.png`) });
const nav = await page.evaluate(() => { const a = window.capy.navOK(); let n = 0; for (const v of a) n += v; return n; });
console.log('walkable nav squares', nav);
await browser.close();
