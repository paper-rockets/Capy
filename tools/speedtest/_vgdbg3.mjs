import puppeteer from 'puppeteer-core';
const [, , url] = process.argv;
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage();
p.on('console', (m) => console.log(m.type(), m.text().slice(0, 200)));
p.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
await p.goto(url, { waitUntil: 'networkidle0', timeout: 120000 });
await p.waitForFunction(() => window.__vg?.current, { timeout: 120000 });
console.log(await p.evaluate(() => {
  const W = __vg.current.W, L = __vg.current.L; let nan = 0; for (const v of W.terrain.h) if (!(v === v)) nan++;
  const bad = L.buildings.filter(b => !(b.y === b.y)).length, badT = L.trees.filter(t => !(t.y === t.y)).length, badP = L.props.filter(t => !(t.y === t.y)).length;
  const g = W.group.children.find(o => o.name === 'ground'); const pos = g.geometry.attributes.position.array; let gn = 0; for (const v of pos) if (!(v === v)) gn++;
  return JSON.stringify({ nan, bad, badT, badP, gn, canvas: W.groundCanvas && [W.groundCanvas.width, W.groundCanvas.height] });
}));
await b.close();
