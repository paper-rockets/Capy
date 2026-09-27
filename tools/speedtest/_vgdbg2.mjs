import puppeteer from 'puppeteer-core';
const [, , url] = process.argv;
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage();
await p.goto(url, { waitUntil: 'networkidle0', timeout: 120000 });
await p.waitForFunction(() => window.__vg?.current, { timeout: 120000 });
console.log(await p.evaluate(() => {
  const L = __vg.current.L, c = L.coast, h0 = L.h0, out = [];
  for (const u of [-L.R, -L.R * 0.6, 0, L.R * 0.6]) { const row = []; for (let d = -4; d <= 20; d += 3) { const x = c.tx * u + c.cx * (c.o - d), z = c.tz * u + c.cz * (c.o - d); row.push(h0(x, z).toFixed(1)); } out.push('u' + Math.round(u) + ': ' + row.join(' ')); }
  out.push('roads ' + L.roads.map(r => r.kind + (r.waterfront ? '*' : '') + ':' + Math.round(r.path.len)).join(' '));
  out.push('villas ' + L.buildings.filter(b => b.villa).length + ' church ' + L.buildings.filter(b => b.kind === 'church').length + ' umbrellas ' + L.props.filter(p => p.kind === 'umbrella').length + ' walls ' + L.props.filter(p => p.kind === 'seawall').length);
  return out.join('\n');
}));
await b.close();
