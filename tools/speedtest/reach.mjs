// Headless check: can Mochi walk from the start to every debug spot? (PC, no tablet)
// usage: node reach.mjs
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 800, height: 450 });
page.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
const t0 = Date.now();
await page.goto('http://localhost:8166/?p=1', { waitUntil: 'networkidle0', timeout: 180000 });
await page.waitForFunction(() => window.capy && document.getElementById('loading').classList.contains('done'), { timeout: 180000 });
console.log('loaded in', ((Date.now() - t0) / 1000).toFixed(1), 's');
const res = await page.evaluate(async () => {
  const { SPOTS } = await import('/src/debug.ts');
  const c = window.capy;
  const out = [];
  for (const [name, x, z] of SPOTS) {
    const t = performance.now();
    const p = c.findPath(46.2, 12.4, x, z);
    const ms = performance.now() - t;
    const end = p && p.length ? p[p.length - 1] : null;
    const miss = end ? Math.hypot(end.x - x, end.y - z) : 99;
    out.push(`${miss < 1.2 ? 'OK ' : 'NO '} ${name.padEnd(28)} miss ${miss.toFixed(1)}  (${ms.toFixed(0)} ms)`);
  }
  return out;
});
console.log(res.join('\n'));
await browser.close();
