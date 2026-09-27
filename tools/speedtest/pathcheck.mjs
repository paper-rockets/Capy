// Are any path points in the water (not on a bridge/boardwalk)? usage: node pathcheck.mjs
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
await page.goto('http://localhost:8166/?nosave', { waitUntil: 'networkidle0', timeout: 180000 });
await page.waitForFunction(() => window.capy && document.getElementById('loading').classList.contains('done'), { timeout: 180000 });
const out = await page.evaluate(async () => {
  const W = await import('/src/world.ts');
  const bad = [];
  W.PATHS.forEach((p, i) => { for (let k = 0; k < p.length - 1; k++) for (let t = 0; t < 1; t += 0.25) {
    const x = p[k][0] + (p[k + 1][0] - p[k][0]) * t, z = p[k][1] + (p[k + 1][1] - p[k][1]) * t;
    if (W.kindAt(x, z) === 'river' && !W.bridgeAt(x, z) && !W.onBoardwalk(x, z)) bad.push(`path ${i} at ${x.toFixed(1)},${z.toFixed(1)}`);
  } });
  return bad;
});
console.log(out.length ? out.join('\n') : 'no path in water');
await browser.close();
