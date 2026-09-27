// Cost of each layer on the tablet: switch one layer off at a time and see how much faster it gets.
// usage: node profile.mjs "<query>" [x,z]
import puppeteer from 'puppeteer-core';
import { execSync } from 'child_process';
const adb = (c) => execSync(`adb -s R52N606W6XR ${c}`, { encoding: 'utf8' }).trim();
adb('reverse tcp:8166 tcp:8166');
adb('shell input keyevent KEYCODE_WAKEUP');
try { adb('forward tcp:9471 localabstract:chrome_devtools_remote'); } catch {}
const q = process.argv[2] || 'p=1';
const at = process.argv[3] || '46.2,12.4';
const url = `http://localhost:8166/?${q}&at=${at}`;
adb(`shell am start -a android.intent.action.VIEW -d "'${url}'" -n com.android.chrome/com.google.android.apps.chrome.Main`);
await new Promise((r) => setTimeout(r, 4000));
let browser = null;
for (let i = 0; i < 20 && !browser; i++) {
  try { browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9471', defaultViewport: null }); }
  catch { await new Promise((r) => setTimeout(r, 1500)); }
}
let page = null;
for (const p of await browser.pages()) if (p.url().includes('localhost:8166') && !(await p.evaluate(() => document.hidden).catch(() => true))) page = p;
// old game tabs left open in the background slow the tablet down a lot: close them
for (const p of await browser.pages()) if (p !== page && p.url().includes('localhost:8166')) await p.close().catch(() => {});
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => window.capy && document.getElementById('loading').classList.contains('done'), { timeout: 180000, polling: 500 });
await new Promise((r) => setTimeout(r, 5000));
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const measure = async () => {
  await new Promise((r) => setTimeout(r, 1500));
  const vals = [];
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    vals.push(parseFloat(await page.evaluate(() => document.getElementById('fps').textContent)));
  }
  return median(vals);
};
const setVis = (names, v) => page.evaluate((names, v) => {
  capy.scene.traverse((o) => { if (names.includes(o.name)) o.visible = v; });
  if (names.includes('leaves')) document.getElementById('leaves').style.display = v ? '' : 'none';
}, names, v);
const out = {};
out['everything on'] = await measure();
for (const layer of ['ground', 'water', 'pictures', 'shadows', 'casts', 'decals', 'rocks', 'steps', 'fence', 'bridges', 'puffs', 'mochi', 'leaves']) {
  await setVis([layer], false);
  out['without ' + layer] = await measure();
  await setVis([layer], true);
}
// plain flat colour instead of the fancy shader: how much is the shader itself, not the area it covers
const swap = (layer, on) => page.evaluate((layer, on) => {
  let Ctor = null;
  capy.scene.traverse((o) => { if (!Ctor && o.isMesh && o.material && o.material.type === 'MeshBasicMaterial') Ctor = o.material.constructor; });
  capy.scene.traverse((o) => {
    if (o.name !== layer) return;
    o.traverse((m) => {
      if (!m.isMesh) return;
      if (on) { m.userData.realMat = m.material; m.material = new Ctor({ color: 0x66aa44, transparent: layer === 'water', opacity: 0.85, depthWrite: layer !== 'water' }); }
      else if (m.userData.realMat) m.material = m.userData.realMat;
    });
  });
}, layer, on);
for (const layer of ['ground', 'water', 'pictures']) {
  await swap(layer, true);
  out[layer + ' as plain colour'] = await measure();
  await swap(layer, false);
}
await setVis(['ground', 'water', 'pictures', 'shadows', 'casts', 'decals', 'rocks', 'steps', 'fence', 'bridges', 'puffs', 'mochi', 'leaves'], false);
out['nothing drawn (empty screen)'] = await measure();
await setVis(['ground', 'water', 'pictures', 'shadows', 'casts', 'decals', 'rocks', 'steps', 'fence', 'bridges', 'puffs', 'mochi', 'leaves'], true);
console.log(JSON.stringify({ q, at, gpu: await page.evaluate(() => document.getElementById('fps').textContent), out }, null, 1));
await browser.disconnect();
