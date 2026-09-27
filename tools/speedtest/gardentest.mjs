// Garden check: pick, water, plant (seed picker), grow to ripe, pick again — screenshots of each step.
// usage: node gardentest.mjs <outdir> [base-url]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const [, , outDir = 'garden_shots', base = 'http://localhost:8166/'] = process.argv;
fs.mkdirSync(outDir, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1333, height: 632, deviceScaleFactor: 1.5 });
page.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('console error:', m.text().slice(0, 300)); });
await page.goto(`${base}?at=54.4,19.5&zoom=8&grow=3`, { waitUntil: 'networkidle0', timeout: 180000 });
await page.waitForFunction(() => window.capy && window.capy.garden && document.getElementById('loading').classList.contains('done'), { timeout: 180000 });
await new Promise((r) => setTimeout(r, 1500));

const beds = () => page.evaluate(() => window.capy.garden.state().map((b) => `${b.crop ?? '-'}:${b.stage}${b.wet ? 'w' : ''}`).join(' '));
const shot = async (name) => { await page.screenshot({ path: path.join(outDir, name + '.png') }); console.log('shot', name, '|', await beds()); };
const tool = (id) => page.evaluate((id) => document.querySelector(`.hud-tool[data-id="${id}"]`).click(), id);
// walk to a bed and wait until Mochi has arrived and finished what he was doing
const tendAndWait = async (i) => {
  await page.evaluate((i) => window.capy.tend(i), i);
  await page.waitForFunction(() => !window.capy.player.path.length, { timeout: 60000 });
  await new Promise((r) => setTimeout(r, 200));
  await page.waitForFunction(() => window.capy.busy() <= 0, { timeout: 60000 });
};

await shot('0_start');
// 1. hand on the ripe carrots → picked
await tool('hand');
await tendAndWait(1);
await new Promise((r) => setTimeout(r, 1500));
await shot('1_picked_carrots');
console.log('sun points', await page.evaluate(() => document.querySelector('[data-k="sun"] span').textContent));
// 2. basket on the thirsty tomato → a hint; then the watering can → watered
await tool('basket');
await tendAndWait(6);
await shot('2_hint_thirsty');
await tool('water');
await tendAndWait(6);
await shot('3_watered');
// 3. seeds on an empty bed → picker → melon
await tool('seeds');
await tendAndWait(2);
await page.waitForSelector('.hud-pick.on');
await shot('4_seed_picker');
await page.click('.hud-pick button[data-id="melon"]');
await page.waitForFunction(() => window.capy.busy() > 0);
await page.waitForFunction(() => window.capy.busy() <= 0, { timeout: 60000 });
await shot('5_planted_melon');
// 4. water → grows (3 s here) → water → ripe
// (game time runs slower than real time in a slow headless browser, so wait for the stage itself)
const stage = (n) => page.waitForFunction((n) => window.capy.garden.state()[2].stage === n, { timeout: 120000 }, n);
await tool('hand');
await tendAndWait(2);
await shot('5b_melon_watered');
await stage(2);
await shot('6_melon_growing');
await tendAndWait(2);
await stage(3);
await shot('7_melon_ripe');
await tendAndWait(2);
await new Promise((r) => setTimeout(r, 1500));
await shot('8_melon_picked');
console.log('quests', await page.evaluate(() => [...document.querySelectorAll('.hud-q')].map((q) => q.textContent.replace(/\s+/g, ' ').trim()).join(' | ')));
await browser.close();
