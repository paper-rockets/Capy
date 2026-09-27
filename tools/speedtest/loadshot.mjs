// screenshot of the loading screen (title logo) shortly after the page opens
// usage: node loadshot.mjs <out.png> [w] [h]
import puppeteer from 'puppeteer-core';
const [, , out, w = '1333', h = '632'] = process.argv;
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars'] });
const page = await browser.newPage();
await page.setViewport({ width: +w, height: +h, deviceScaleFactor: 1 });
await page.goto('http://localhost:8166/?nosave', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => { const i = document.querySelector('#loading img'); return i && i.complete && i.naturalWidth > 0; }, { timeout: 60000 });
await new Promise((r) => setTimeout(r, 300));
await page.screenshot({ path: out });
console.log('saved', out);
await browser.close();
