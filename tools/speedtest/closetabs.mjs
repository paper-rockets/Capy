import puppeteer from 'puppeteer-core';
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9471', defaultViewport: null });
let n = 0;
for (const p of await browser.pages()) {
  if (!p.url().includes('localhost:8166')) continue;
  if (await p.evaluate(() => document.hidden)) { await p.close(); n++; }
}
console.log('closed', n, 'test tabs');
await browser.disconnect();
