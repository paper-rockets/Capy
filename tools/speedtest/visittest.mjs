// Map visit check: open each designed map in visit mode, tap the ground to walk, screenshot.
// usage: node visittest.mjs <outdir> [base-url]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
const [, , outDir = 'visit', base = 'http://localhost:8172/maker/'] = process.argv;
fs.mkdirSync(outDir, { recursive: true });
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars'] });
const page = await browser.newPage();
await page.setViewport({ width: 1000, height: 470, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
page.on('requestfailed', (r) => console.log('FAILED', r.url()));
await page.goto(`${base}?view=visit&map=old_orchard`, { waitUntil: 'networkidle0', timeout: 180000 });
await page.waitForFunction(() => window.__visit && document.querySelector('.v-loading.done'), { timeout: 180000 });
for (const key of ['old_orchard', 'bamboo_woods', 'lotus_marsh', 'mountain_springs', 'moonlit_lake', 'misty_highlands']) {
  await page.evaluate((k) => window.__visit.visit(k), key);
  await new Promise((r) => setTimeout(r, 1500));
  // tap a spot up-left of Mochi on the screen and let him walk
  const t0 = Date.now();
  await page.mouse.click(620, 300);
  await new Promise((r) => setTimeout(r, 300));
  const moving = await page.evaluate(() => window.__visit.player.path.length);
  await page.waitForFunction(() => !window.__visit.player.path.length, { timeout: 60000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1200));
  const p = await page.evaluate(() => { const v = window.__visit; let n = 0; for (const x of v.ok) n += x; return { x: v.player.x.toFixed(1), z: v.player.z.toFixed(1), standable: n }; });
  console.log(key, 'path points', moving, 'now at', p.x, p.z, 'standable samples', p.standable, `${Date.now() - t0} ms`);
  await page.screenshot({ path: path.join(outDir, key + '.png') });
}
await browser.close();
