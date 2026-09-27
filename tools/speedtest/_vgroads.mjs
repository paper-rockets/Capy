import puppeteer from 'puppeteer-core';
const [, , url] = process.argv;
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage();
p.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
await p.goto(url, { waitUntil: 'networkidle0', timeout: 120000 });
await p.waitForFunction(() => window.__vg?.current, { timeout: 120000 });
console.log(await p.evaluate(() => { const L = __vg.current.L; return JSON.stringify({ R: L.R, E: L.E, h00: L.h0(0, 0), roads: L.roads.map(r => r.kind + ':' + Math.round(r.path.len)), fall: L.fall }); }));
await b.close();
