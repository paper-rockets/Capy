// Long play test on the tablet: Mochi keeps running around the map for N minutes while we log
// fps, the graphics chip speed and its temperature every few seconds. The tablet slows its chip
// down when it gets warm, so this shows the speed a real play session settles at.
// usage: node sustain.mjs "<query>" [minutes=10]
import puppeteer from 'puppeteer-core';
import { execSync } from 'child_process';
const adb = (c) => execSync(`adb -s R52N606W6XR ${c}`, { encoding: 'utf8' }).trim();
const gpu = () => {
  const [clock, max, temp] = adb(`shell "cat /sys/kernel/gpu/gpu_clock /sys/kernel/gpu/gpu_max_clock /sys/kernel/gpu/gpu_tmu"`).split(/\s+/);
  return { mhz: Math.round(+clock / 1000), maxMhz: Math.round(+max / 1000), temp: parseFloat(temp) };
};
adb('reverse tcp:8166 tcp:8166');
adb('shell input keyevent KEYCODE_WAKEUP');
adb('shell svc power stayon usb');
try { adb('forward tcp:9471 localabstract:chrome_devtools_remote'); } catch {}
const q = process.argv[2] || 'p=1';
const minutes = Number(process.argv[3] || 10);
const url = `http://localhost:8166/?${q}`;
adb(`shell am start -a android.intent.action.VIEW -d "'${url}'" -n com.android.chrome/com.google.android.apps.chrome.Main`);
await new Promise((r) => setTimeout(r, 4000));
let browser = null;
for (let i = 0; i < 20 && !browser; i++) {
  try { browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9471', defaultViewport: null }); }
  catch { await new Promise((r) => setTimeout(r, 1500)); }
}
const pages = await browser.pages();
let page = null;
for (const p of pages) if (p.url().includes('localhost:8166') && !(await p.evaluate(() => document.hidden).catch(() => true))) page = p;
for (const p of pages) if (p !== page && p.url().includes('localhost:8166')) await p.close().catch(() => {});
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => window.capy && document.getElementById('loading').classList.contains('done'), { timeout: 180000, polling: 500 });
// Mochi runs a loop between these spots, over and over
const spots = [[46.2, 12.4], [54, 37.4], [35, 4.6], [26, 30], [66, 10], [46.2, 12.4]];
await page.evaluate((spots) => {
  let i = 0;
  setInterval(() => {
    const c = capy;
    if (c.player.path.length) return;
    i = (i + 1) % spots.length;
    const p = c.findPath(c.player.x, c.player.z, spots[i][0], spots[i][1]);
    c.player.path = p || [];
    c.player.running = true;
  }, 500);
}, spots);
const rows = [];
const t0 = Date.now();
while (Date.now() - t0 < minutes * 60000) {
  await new Promise((r) => setTimeout(r, 5000));
  const fps = parseFloat(await page.evaluate(() => document.getElementById('fps').textContent));
  const g = gpu();
  const row = { s: Math.round((Date.now() - t0) / 1000), fps, ...g };
  rows.push(row);
  console.log(`${String(row.s).padStart(4)} s  ${String(fps).padStart(3)} fps  chip ${g.mhz} MHz (cap ${g.maxMhz})  ${g.temp} °C`);
}
const last = rows.slice(-Math.floor(rows.length / 3)).map((r) => r.fps).sort((a, b) => a - b);
console.log(`last third: median ${last[Math.floor(last.length / 2)]} fps, lowest ${last[0]} fps`);
await page.evaluate(() => location.reload());
await browser.disconnect();
