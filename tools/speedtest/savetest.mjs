// Save check: play a bit (pick, water, find a duckling), close the browser, open it again →
// "Welcome back" → Continue → everything is back; then Menu → Start over → all back to the start.
// usage: node savetest.mjs <outdir> [base-url]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [, , outDir = 'save_shots', base = 'http://localhost:8166/'] = process.argv;
fs.mkdirSync(outDir, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'capy-save-')); // same browser profile both times = same saved game
const open = async (query) => {
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'new',
    userDataDir: profile,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1333, height: 632, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('console error:', m.text().slice(0, 300)); });
  await page.goto(`${base}?${query}`, { waitUntil: 'networkidle0', timeout: 180000 });
  await page.waitForFunction(() => window.capy && window.capy.garden && document.getElementById('loading').classList.contains('done'), { timeout: 180000 });
  await new Promise((r) => setTimeout(r, 1000));
  return { browser, page };
};
const state = (page) => page.evaluate(() => ({
  sun: document.querySelector('[data-k="sun"] span').textContent,
  beds: window.capy.garden.state().map((b) => `${b.crop ?? '-'}:${b.stage}${b.wet ? 'w' : ''}`).join(' '),
  ducks: (({ found, home }) => `found ${found}, home ${home}`)(window.capy.ducks()),
  at: `${window.capy.player.x.toFixed(1)},${window.capy.player.z.toFixed(1)}`,
  dialog: document.querySelector('.hud-dlg.on h2')?.textContent ?? '-',
}));
const shot = async (page, name) => { await page.screenshot({ path: path.join(outDir, name + '.png') }); console.log(name, JSON.stringify(await state(page))); };
const tendAndWait = async (page, i) => {
  await page.evaluate((i) => window.capy.tend(i), i);
  await page.waitForFunction(() => !window.capy.player.path.length, { timeout: 60000 });
  await new Promise((r) => setTimeout(r, 200));
  await page.waitForFunction(() => window.capy.busy() <= 0, { timeout: 60000 });
};

// 1. first visit: no save, the game just starts
let { browser, page } = await open('at=54.4,19.5&zoom=8&grow=600');
await shot(page, '1_new_game');
await tendAndWait(page, 1); // pick the carrots
await page.evaluate(() => document.querySelector('.hud-tool[data-id="water"]').click());
await tendAndWait(page, 6); // water the tomato
// walk into the first lost duckling
await page.evaluate(() => { const p = window.capy.player; p.x = 47.3; p.z = 3.6; p.path = []; });
await page.waitForFunction(() => window.capy.ducks().found === 1, { timeout: 30000 });
await new Promise((r) => setTimeout(r, 2500));
await page.evaluate(() => window.capy.save());
await shot(page, '2_played');
const before = await state(page);
await browser.close();

// 2. come back later: "Welcome back" → Continue
({ browser, page } = await open('zoom=8&grow=600'));
await shot(page, '3_welcome_back');
await page.click('.hud-dlg button[data-id="continue"]');
await new Promise((r) => setTimeout(r, 2500));
await shot(page, '4_continued');
const after = await state(page);
for (const k of ['sun', 'beds', 'ducks']) console.log(k, before[k] === after[k] ? 'SAME' : `DIFFERENT: ${before[k]} → ${after[k]}`);

// 3. Menu → Start over → Yes
await page.click('#btn-menu');
await new Promise((r) => setTimeout(r, 500));
await shot(page, '5_menu');
await page.click('.hud-dlg button[data-id="over"]');
await new Promise((r) => setTimeout(r, 500));
await shot(page, '6_are_you_sure');
await page.click('.hud-dlg button[data-id="yes"]');
await new Promise((r) => setTimeout(r, 2500));
await shot(page, '7_started_over');
await browser.close();
fs.rmSync(profile, { recursive: true, force: true });
