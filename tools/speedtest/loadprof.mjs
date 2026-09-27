// What takes the time while the game loads (headless Chrome on the PC).
// usage: node loadprof.mjs ["<query>"] [--cpu=4]   (--cpu slows the processor down, like a tablet)
// Prints the loading steps with their times, then the functions that took the most time.
import puppeteer from 'puppeteer-core';
const q = process.argv.slice(2).find((a) => !a.startsWith('--')) || '';
const cpu = Number((process.argv.find((a) => a.startsWith('--cpu=')) || '--cpu=1').slice(6));
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1333, height: 632, deviceScaleFactor: 1.5 });
page.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
page.on('console', (m) => { if (/load step|picture sheet/.test(m.text())) console.log('  ', m.text()); });
const cdp = await page.createCDPSession();
if (cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
// warm the dev server's cache once, so the timed load is not waiting on Vite's first transform
await page.goto(`http://localhost:8166/?${q}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.capy && document.getElementById('loading').classList.contains('done'), { timeout: 300000, polling: 200 });
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
await cdp.send('Profiler.start');
const t0 = Date.now();
await page.goto(`http://localhost:8166/?${q}`, { waitUntil: 'domcontentloaded' });
const steps = [];
let lastStep = '';
for (;;) {
  const s = await page.evaluate(() => ({
    t: document.getElementById('loading-status')?.textContent || '',
    done: !!window.capy && document.getElementById('loading').classList.contains('done'),
  })).catch(() => ({ t: '?', done: false }));
  if (s.t !== lastStep) { steps.push([(Date.now() - t0) / 1000, s.t]); lastStep = s.t; }
  if (s.done) break;
  await new Promise((r) => setTimeout(r, 50));
}
const total = (Date.now() - t0) / 1000;
// first frames (shaders get built on the first draw)
await new Promise((r) => setTimeout(r, 1500));
const { profile } = await cdp.send('Profiler.stop');
console.log(`\nLOAD ${total.toFixed(1)} s  (cpu slowdown x${cpu})`);
for (const [t, s] of steps) console.log(`  ${t.toFixed(2)} s  ${s}`);

// time per function: self = in the function itself, total = including what it calls
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const parent = new Map();
for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id);
const label = (n) => {
  const f = n.callFrame;
  const file = f.url.split('/').pop().split('?')[0];
  return `${f.functionName || '(anon)'} ${file}:${f.lineNumber + 1}`;
};
const self = new Map();
const incl = new Map();
const dts = profile.timeDeltas;
for (let i = 0; i < profile.samples.length; i++) {
  const dt = (dts[i + 1] ?? 0) / 1000; // ms
  let n = byId.get(profile.samples[i]);
  const l = label(n);
  self.set(l, (self.get(l) || 0) + dt);
  const seen = new Set();
  while (n) {
    const k = label(n);
    if (!seen.has(k)) { incl.set(k, (incl.get(k) || 0) + dt); seen.add(k); }
    n = byId.get(parent.get(n.id));
  }
}
const top = (m, k) => [...m.entries()].filter(([l]) => !/^\(root\)|^\(program\)|^\(idle\)/.test(l)).sort((a, b) => b[1] - a[1]).slice(0, k);
console.log('\nTOTAL time (incl. what they call), ms:');
for (const [l, v] of top(incl, 45)) console.log(`  ${v.toFixed(0).padStart(6)}  ${l}`);
console.log('\nSELF time, ms:');
for (const [l, v] of top(self, 30)) console.log(`  ${v.toFixed(0).padStart(6)}  ${l}`);
console.log(`\n(idle ${(self.get('(idle) :0') || 0).toFixed(0)} ms, program ${(self.get('(program) :0') || 0).toFixed(0)} ms, gc ${(self.get('(garbage collector) :0') || 0).toFixed(0)} ms)`);
await browser.close();
