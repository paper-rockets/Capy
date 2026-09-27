import puppeteer from 'puppeteer-core';
const [, , url] = process.argv;
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage();
await p.goto(url, { waitUntil: 'networkidle0', timeout: 120000 });
await p.waitForFunction(() => window.__vg?.current, { timeout: 120000 });
console.log(await p.evaluate(() => {
  const L = __vg.current.L, h0 = L.h0, out = [];
  const grad = (x, z) => [(h0(x + 1.2, z) - h0(x - 1.2, z)) / 2.4, (h0(x, z + 1.2) - h0(x, z - 1.2)) / 2.4];
  for (const H of [h0(0, 0) - 14, h0(0, 0) - 7, h0(0, 0) + 7, h0(0, 0) + 14]) {
    let x = 0, z = 0;
    for (let i = 0; i < 80; i++) { const [gx, gz] = grad(x, z), g = Math.hypot(gx, gz) || 1e-3, e = h0(x, z) - H; if (Math.abs(e) < 0.05) break; const k = Math.max(-8, Math.min(8, e / g)); x -= gx / g * k; z -= gz / g * k; }
    out.push([H.toFixed(1), x.toFixed(1), z.toFixed(1), h0(x, z).toFixed(2), Math.hypot(...grad(x, z)).toFixed(2), Math.hypot(x, z).toFixed(0)].join(' '));
  }
  return out.join('\n') + '\nR ' + L.R;
}));
await b.close();
