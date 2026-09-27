// Speed test on the tablet: Chrome on the tablet loads the PC dev server over USB (adb reverse), nothing installed.
// usage: node tablet.mjs "<query>" ["<query>" ...]   e.g. node tablet.mjs "dpr=1.5" "dpr=1"
// --shot=<dir> also saves a screenshot from the tablet for each run.
import puppeteer from 'puppeteer-core';
import { execSync } from 'child_process';
const adb = (c) => execSync(`adb -s R52N606W6XR ${c}`, { encoding: 'utf8' }).trim();
adb('reverse tcp:8166 tcp:8166');
adb('shell input keyevent KEYCODE_WAKEUP');
adb('shell svc power stayon usb');
try { adb('forward tcp:9471 localabstract:chrome_devtools_remote'); } catch {}
const shotDir = (process.argv.find((a) => a.startsWith('--shot=')) || '').slice(7);
const configs = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const results = {};
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
for (const q of configs) {
  const url = `http://localhost:8166/?${q}`;
  adb(`shell am start -a android.intent.action.VIEW -d "'${url}'" -n com.android.chrome/com.google.android.apps.chrome.Main`);
  await new Promise((r) => setTimeout(r, 4000));
  let browser = null;
  for (let i = 0; i < 20 && !browser; i++) {
    try { browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9471', defaultViewport: null }); }
    catch { await new Promise((r) => setTimeout(r, 1500)); }
  }
  if (!browser) throw new Error('could not reach Chrome on the tablet');
  const pages = await browser.pages();
  let page = null;
  for (const p of pages) if (p.url().includes('localhost:8166') && !(await p.evaluate(() => document.hidden).catch(() => true))) page = p;
  if (!page) for (const p of pages) if (p.url().includes('localhost:8166')) page = p;
  if (!page) { console.log('no page for', q, pages.map((p) => p.url())); await browser.disconnect(); continue; }
  // old game tabs left open in the background slow the tablet down a lot (60 -> 38 fps with 3 of them): close them
  for (const p of pages) if (p !== page && p.url().includes('localhost:8166')) await p.close().catch(() => {});
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 }); // always a fresh load
  const t0 = Date.now();
  await page.waitForFunction(() => window.capy && document.getElementById('loading').classList.contains('done'), { timeout: 180000, polling: 500 });
  const loadS = ((Date.now() - t0) / 1000).toFixed(1);
  await new Promise((r) => setTimeout(r, 5000)); // warm up
  const samples = {};
  const run = async (label, setup, secs) => {
    await page.evaluate(setup);
    await new Promise((r) => setTimeout(r, 1500));
    const vals = [];
    for (let i = 0; i < secs; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const t = await page.evaluate(() => document.getElementById('fps').textContent);
      vals.push(parseFloat(t));
    }
    let chip = '?';
    try { const [c, m] = adb('shell "cat /sys/kernel/gpu/gpu_clock /sys/kernel/gpu/gpu_max_clock"').split(/\s+/); chip = `${Math.round(+c / 1000)}/${Math.round(+m / 1000)} MHz`; } catch {}
    samples[label] = { median: median(vals), min: Math.min(...vals), chip, all: vals.join(' ') };
    console.error(`${q} | ${label}: median ${samples[label].median}, min ${samples[label].min}, chip ${chip}`);
    if (shotDir) {
      const name = `${shotDir}/${q.replace(/[^a-z0-9]+/gi, '_') || 'default'}_${label.replace(/\W+/g, '_')}.png`;
      await page.screenshot({ path: name });
    }
  };
  await run('start', `capy.player.x=46.2; capy.player.z=12.4; capy.player.path=[];`, 8);
  await run('run to lake', `{const c=capy; const p=c.findPath(c.player.x,c.player.z,54,37.4); c.player.path=p||[]; c.player.running=true;}`, 10);
  await run('forest+falls', `capy.player.x=35; capy.player.z=4.6; capy.player.path=[];`, 8);
  await run('marsh boardwalk', `capy.player.x=23.2; capy.player.z=43.0; capy.player.path=[];`, 8);
  await run('marsh walk east', `{const c=capy; c.player.x=40; c.player.z=46.8; const p=c.findPath(40,46.8,74.2,53.4); c.player.path=p||[]; c.player.running=true;}`, 10);
  await run('whole map', `capy.setView(64);`, 8);
  await page.evaluate(() => capy.setView(11));
  const info = await page.evaluate(() => {
    const gl = capy.renderer.getContext();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      gpu: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : '?',
      maxTex: gl.getParameter(gl.MAX_TEXTURE_SIZE),
      canvas: capy.renderer.domElement.width + 'x' + capy.renderer.domElement.height,
      dpr: devicePixelRatio,
      fpsText: document.getElementById('fps').textContent,
    };
  });
  results[q] = { loadS, ...info, samples };
  await browser.disconnect();
}
console.log(JSON.stringify(results, null, 1));
