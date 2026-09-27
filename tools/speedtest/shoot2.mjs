// usage: node shoot2.mjs <url> <out.png> [width] [height] [dpr] [js-before-shot]
import puppeteer from 'puppeteer-core';
const [, , url, out, w = '1333', h = '632', dpr = '1.5', js = ''] = process.argv;
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.setViewport({ width: +w, height: +h, deviceScaleFactor: +dpr });
page.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
page.on('console', (m) => { if (!/Mochi clips|vite/.test(m.text())) console.log('console:', m.text().slice(0, 300)); });
await page.goto(url, { waitUntil: 'networkidle0', timeout: 180000 });
await page.waitForFunction(() => window.capy && document.getElementById('loading').classList.contains('done'), { timeout: 180000 });
if (js) await page.evaluate(js);
await new Promise((r) => setTimeout(r, 2500));
await page.screenshot({ path: out });
console.log('saved', out);
await browser.close();
