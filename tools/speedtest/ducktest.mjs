// Plays the duckling quest headless: find the first duckling, walk it to the lake, then collect the rest.
// usage: node ducktest.mjs <outdir>   (saves screenshots found.png, following.png, home1.png, allhome.png)
import puppeteer from 'puppeteer-core';
const out = process.argv[2] || '.';
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1333, height: 632, deviceScaleFactor: 1.5 });
page.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
await page.goto('http://localhost:8166/?at=47.3,4.5&zoom=8', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.capy && document.getElementById('loading').classList.contains('done'), { timeout: 300000, polling: 200 });
const wait = (s) => new Promise((r) => setTimeout(r, s * 1000));
const status = () => page.evaluate(() => { const s = capy.ducks(); return { found: s.found, home: s.home, states: s.ducklings.map((d) => d.state).join(' ') }; });
await wait(2.5);
console.log('after arriving next to duckling 1:', await status());
await page.screenshot({ path: `${out}/found.png` });
// walk to the lake shore
await page.evaluate(() => { const c = capy; c.player.path = c.findPath(c.player.x, c.player.z, 54, 37.4) || []; c.player.running = true; });
const t0 = Date.now();
let shot = false;
for (;;) {
  const left = await page.evaluate(() => capy.player.path.length);
  if (!shot && Date.now() - t0 > 6000) { await page.screenshot({ path: `${out}/following.png` }); shot = true; }
  if (!left || Date.now() - t0 > 150000) break;
  await wait(0.5);
}
console.log(`walked to the shore in ${((Date.now() - t0) / 1000).toFixed(0)} s:`, await status());
await wait(9);
console.log('9 s later:', await status());
await page.screenshot({ path: `${out}/home1.png` });
// the other seven: hop next to each (teleport), then back to the shore
const spots = [[35.6, 4.8], [18.6, 15.8], [66.0, 17.5], [70.2, 31.5], [7.6, 28.8], [37.3, 50.5], [74.2, 53.4]];
for (const [x, z] of spots) {
  await page.evaluate(([x, z]) => { capy.player.x = x + 0.6; capy.player.z = z + 0.6; capy.player.path = []; }, [x, z]);
  await wait(2.2);
}
console.log('after visiting all:', await status());
await page.evaluate(() => { capy.player.x = 52.5; capy.player.z = 37.6; capy.player.path = []; });
await wait(4);
await page.evaluate(() => { capy.player.x = 54.2; capy.player.z = 37.5; capy.player.path = []; });
await wait(14);
console.log('at the shore, 18 s later:', await status());
await page.screenshot({ path: `${out}/allhome.png` });
const hud = await page.evaluate(() => [...document.querySelectorAll('.hud-pill span')].map((s) => s.textContent).join(' / ') + ' | ' + document.querySelector('.hud-quests').innerText.replace(/\n+/g, ' · '));
console.log('HUD:', hud);
await browser.close();
