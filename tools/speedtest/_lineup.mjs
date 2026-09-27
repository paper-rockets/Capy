import puppeteer from 'puppeteer-core';
const [, , url, out] = process.argv;
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage(); await p.setViewport({ width: 1800, height: 700 });
p.on('pageerror', (e) => console.log('PAGE ERROR', e.message)); p.on('console', (m) => { if (m.type() === 'error') console.log(m.text().slice(0, 200)); });
await p.goto(url, { waitUntil: 'networkidle0', timeout: 120000 });
await p.waitForFunction(() => window.__ready, { timeout: 120000 }); await new Promise((r) => setTimeout(r, 3000));
await p.screenshot({ path: out }); await b.close();
