// temporary: screenshot the Village Generator with given hash settings. usage: node _vgshot.mjs <url> <out.png> [wait s]
import puppeteer from 'puppeteer-core';
const [, , url, out, wait = '25', js = ''] = process.argv;
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage();
await p.setViewport({ width: 1400, height: 850 });
p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(m.type(), m.text().slice(0, 300)); });
p.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
await p.goto(url, { waitUntil: 'networkidle0', timeout: 120000 });
await new Promise((r) => setTimeout(r, +wait * 1000));
console.log('status:', await p.evaluate(() => document.getElementById('status').textContent + ' | ' + document.getElementById('vname').textContent));
if (js) { console.log('js:', await p.evaluate(js)); await new Promise((r) => setTimeout(r, 4000)); }
await p.screenshot({ path: out });
await b.close();
