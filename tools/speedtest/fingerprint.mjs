// Fingerprint of the built world, to prove a speed-up changed nothing you can see or walk on.
// usage: node fingerprint.mjs ["<query>"] > before.json   ... then compare two files with: node fingerprint.mjs --diff a.json b.json
import puppeteer from 'puppeteer-core';
import { readFileSync } from 'fs';
if (process.argv[2] === '--diff') {
  const a = JSON.parse(readFileSync(process.argv[3], 'utf8'));
  const b = JSON.parse(readFileSync(process.argv[4], 'utf8'));
  let same = true;
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const ok = JSON.stringify(a[k]) === JSON.stringify(b[k]);
    if (!ok) same = false;
    console.log(`${ok ? 'same   ' : 'CHANGED'} ${k}${ok ? '' : `: ${JSON.stringify(a[k])} -> ${JSON.stringify(b[k])}`}`);
  }
  console.log(same ? '\nEVERYTHING THE SAME' : '\nSOMETHING CHANGED');
  process.exit(same ? 0 : 1);
}
const q = process.argv[2] || '';
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1333, height: 632, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.error('PAGE ERROR', e.message));
await page.goto(`http://localhost:8166/?${q}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.capy && document.getElementById('loading').classList.contains('done'), { timeout: 300000, polling: 200 });
const out = await page.evaluate(() => {
  const c = window.capy;
  // FNV-1a over float bits
  const hashArr = (arr) => {
    const f = new Float32Array(arr.length);
    for (let i = 0; i < arr.length; i++) f[i] = arr[i];
    const u = new Uint32Array(f.buffer);
    let h = 2166136261;
    for (let i = 0; i < u.length; i++) { h ^= u[i]; h = Math.imul(h, 16777619) >>> 0; }
    return h.toString(16);
  };
  const res = {};
  // heights and ground kinds on a fine grid (off the ground-mesh grid, so in-between points are tested too)
  const hs = [];
  const kinds = [];
  const km = { meadow: 0, terrace: 1, plateau: 2, high: 3, pool: 4, river: 5, stairs: 6 };
  for (let z = -7.93; z < 63; z += 0.37) for (let x = -7.91; x < 97; x += 0.37) { hs.push(c.groundHeight(x, z)); kinds.push(km[c.kindAt(x, z)]); }
  res.heights = hashArr(hs);
  res.kinds = hashArr(kinds);
  res.nav = hashArr(Array.from(c.navOK()));
  res.navCount = Array.from(c.navOK()).reduce((a, b) => a + b, 0);
  // every mesh in the scene: name, vertex count and a hash of its vertex positions and index
  const meshes = {};
  c.scene.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    let n = o.name || o.parent?.name || o.type;
    const key = n;
    const g = o.geometry;
    const m = meshes[key] || (meshes[key] = { pieces: 0, verts: 0, parts: [] });
    m.pieces++;
    m.verts += g.index ? g.index.count : g.attributes.position.count;
    const pos = g.attributes.position.array;
    const sub = [];
    const idx = g.index ? g.index.array : null;
    // positions actually used (index order), and the instance matrices for batches
    if (idx) for (let i = 0; i < idx.length; i++) sub.push(pos[idx[i] * 3], pos[idx[i] * 3 + 1], pos[idx[i] * 3 + 2]);
    else sub.push(...pos);
    if (o.isInstancedMesh) sub.push(...o.instanceMatrix.array);
    for (const a of ['uv', 'aMat', 'aTint', 'aAO', 'aTop', 'aDepth', 'aFlow', 'aRing', 'aStream', 'aLocal']) {
      const at = g.attributes[a];
      if (at && idx) for (let i = 0; i < idx.length; i++) for (let k = 0; k < at.itemSize; k++) sub.push(at.array[idx[i] * at.itemSize + k]);
    }
    m.parts.push(hashArr(sub));
  });
  for (const k of Object.keys(meshes)) { meshes[k].parts.sort(); meshes[k].hash = meshes[k].parts.join('').length + ':' + (() => { let h = 0; for (const p of meshes[k].parts) for (const ch of p) h = (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0; return h.toString(16); })(); delete meshes[k].parts; }
  res.meshes = meshes;
  // a few routes
  const routes = [[46.2, 12.4, 54, 37.4], [40, 46.8, 74.2, 53.4], [35, 4.6, 8, 30], [23.2, 43, 80, 12]];
  res.routes = routes.map(([a, b, x, z]) => { const p = c.findPath(a, b, x, z); return p ? p.length + ':' + hashArr(p.flatMap((v) => [v.x, v.y])) : 'none'; });
  return res;
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
