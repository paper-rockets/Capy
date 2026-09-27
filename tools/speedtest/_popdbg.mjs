import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=swiftshader'] });
const p = await b.newPage();
p.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
await p.goto('http://127.0.0.1:8160/trees.html', { waitUntil: 'networkidle0' });
console.log(await p.evaluate(async () => { const { P } = await import('/js/builder.js'); const a = P.pop[0].p; let mn = 9, mx = 0; for (let i = 0; i < a.length; i += 3) { const r = Math.hypot(a[i], a[i+1], a[i+2]); mn = Math.min(mn, r); mx = Math.max(mx, r); } return [a.length / 9, mn, mx].join(' '); }));
await b.close();
