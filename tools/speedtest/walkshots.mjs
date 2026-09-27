// usage: node walkshots.mjs <url> <outprefix> <x0,z0> <x1,z1> [n=8] [w h dpr]
// Mochi walks from A to B; takes n screenshots along the way (for checking clipping on bridges etc.)
import puppeteer from 'puppeteer-core';
const [, , url, out, a, b, n = '8', w = '412', h = '892', dpr = '1'] = process.argv;
const [x0, z0] = a.split(',').map(Number), [x1, z1] = b.split(',').map(Number);
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.setViewport({ width: +w, height: +h, deviceScaleFactor: +dpr });
await page.goto(`${url}${url.includes('?') ? '&' : '?'}at=${x0},${z0}`, { waitUntil: 'networkidle0', timeout: 180000 });
await page.waitForFunction(() => window.capy && document.getElementById('loading').classList.contains('done'), { timeout: 180000 });
await new Promise((r) => setTimeout(r, 1500));
const path = await page.evaluate((x0, z0, x1, z1) => { const c = capy; const p = c.findPath(x0, z0, x1, z1); c.player.path = p || []; return p ? p.length : -1; }, x0, z0, x1, z1);
console.log('path points', path);
let i = 0;
for (; i < +n; i++) {
  const pos = await page.evaluate(() => [capy.player.x.toFixed(2), capy.player.z.toFixed(2), capy.player.path.length]);
  await page.screenshot({ path: `${out}_${i}.png` });
  console.log(i, pos.join(' '));
  if (!pos[2]) break;
  await new Promise((r) => setTimeout(r, 450));
}
await browser.close();
