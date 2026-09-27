// Close-up checks on a map: stand Mochi at spots, zoom in, screenshot, with optional coloured dots at world points.
// usage: node probe.mjs <key|meadow> <outdir> <shots.json> [extra=query]
//   shots.json = [{ "name": "bridge", "x": 52, "z": 21, "view": 6, "hud": false, "marks": [[x, y, z, "red"], ...] }, ...]
//   "vw", "vh", "dpr" (optional): screen size for this shot (phone: 486 x 600, dpr 2)
//   "js": "..." (optional) runs in the page before the screenshot (window.capy is there)
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
const [, , key = 'old_orchard', outDir = 'probe', shotsFile, extra = ''] = process.argv;
const shots = JSON.parse(fs.readFileSync(shotsFile, 'utf8'));
fs.mkdirSync(outDir, { recursive: true });
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars'] });
const page = await browser.newPage();
await page.setViewport({ width: 1200, height: 800, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('console error', m.text().slice(0, 300)); });
const url = (key === 'meadow' ? 'http://localhost:8166/?nosave' : `http://localhost:8166/?map=${key}&nosave`) + (extra ? '&' + extra : '');
await page.goto(url, { waitUntil: 'networkidle0', timeout: 240000 });
await page.waitForFunction(() => document.getElementById('loading').classList.contains('done'), { timeout: 240000 });
await new Promise((r) => setTimeout(r, 1500));
for (const s of shots) {
  if (s.vw) await page.setViewport({ width: s.vw, height: s.vh, deviceScaleFactor: s.dpr || 1 });
  await page.evaluate((s) => {
    const c = window.capy;
    c.player.x = s.x; c.player.z = s.z; c.player.path = [];
    if (s.view) c.setView(s.view);
    const canvas = c.renderer.domElement;
    for (const e of document.body.children) if (e !== canvas && !e.contains(canvas) && !e.classList.contains('dbgdot')) e.style.visibility = s.hud ? '' : 'hidden';
  }, s);
  await new Promise((r) => setTimeout(r, 3500));
  if (s.js) {
    const res = await page.evaluate(s.js);
    if (res != null) console.log(s.name, JSON.stringify(res));
    await new Promise((r) => setTimeout(r, 500));
  }
  await page.evaluate((s) => {
    document.querySelectorAll('.dbgdot').forEach((e) => e.remove());
    const c = window.capy;
    const V = c.camera.position.constructor;
    const r = c.renderer.domElement.getBoundingClientRect();
    for (const [x, y, z, col] of s.marks || []) {
      const v = new V(x, y, z).project(c.camera);
      const d = document.createElement('div');
      d.className = 'dbgdot';
      d.style.cssText = `position:fixed;left:${r.left + (v.x + 1) / 2 * r.width - 5}px;top:${r.top + (1 - v.y) / 2 * r.height - 5}px;width:10px;height:10px;border-radius:5px;background:${col};z-index:99999;border:2px solid #000;pointer-events:none`;
      document.body.appendChild(d);
    }
  }, s);
  await new Promise((r) => setTimeout(r, 300));
  await page.screenshot({ path: path.join(outDir, `${s.name}.png`) });
}
await browser.close();
