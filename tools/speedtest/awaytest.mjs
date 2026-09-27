// Plants grow while away: fake a save from an hour ago with a watered tomato, then Continue.
import puppeteer from 'puppeteer-core';
const [, , out = 'away.png', base = 'http://localhost:8166/'] = process.argv;
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
await page.setViewport({ width: 1333, height: 632 });
await page.goto(base + 'robots.txt');
await page.evaluate(() => localStorage.setItem('capy-springs-save-1', JSON.stringify({ v: 1, savedAt: Date.now() - 3600e3,
  player: { x: 54.4, z: 19.5, heading: 0 }, counters: { sun: 42, hearts: 1, leaves: 2 }, harvested: 3,
  garden: [{ crop: 'tomato', stage: 2, wet: true, grow: 3 }, { crop: 'melon', stage: 1, wet: false, grow: 0 }, ...Array(6).fill({ crop: null, stage: 0, wet: false, grow: 0 })],
  ducks: { chicks: ['home', 'home', 'follow', 'lost', 'lost', 'lost', 'lost', 'lost'] } })));
await page.goto(base + '?zoom=8', { waitUntil: 'networkidle0', timeout: 180000 });
await page.waitForSelector('.hud-dlg.on button[data-id="continue"]', { timeout: 180000 });
await page.click('.hud-dlg button[data-id="continue"]');
await new Promise((r) => setTimeout(r, 2000));
console.log(await page.evaluate(() => JSON.stringify({ beds: window.capy.garden.state().slice(0, 2), ducks: window.capy.ducks().found + ' found, ' + window.capy.ducks().home + ' home', toast: document.querySelector('.hud-toast').textContent, quests: [...document.querySelectorAll('.hud-q b')].map((b) => b.textContent) })));
await page.screenshot({ path: out });
await browser.close();
