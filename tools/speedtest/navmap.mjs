// usage: node navmap.mjs x0 x1 z0 z1 [query]  -> ASCII of the walking grid (# = blocked, . = ok, M = Mochi)
import puppeteer from 'puppeteer-core';
const [, , x0, x1, z0, z1, q = ''] = process.argv;
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
await page.goto('http://localhost:8166/?nosave' + (q ? '&' + q : ''), { waitUntil: 'networkidle0', timeout: 180000 });
await page.waitForFunction(() => window.capy && document.getElementById('loading').classList.contains('done'), { timeout: 180000 });
const out = await page.evaluate((x0, x1, z0, z1) => {
  const c = window.capy; const ok = c.navOK(); const gw = 180; const rows = [];
  for (let j = z0 * 2; j < z1 * 2; j++) { let r = (j / 2).toFixed(1).padStart(5) + ' '; for (let i = x0 * 2; i < x1 * 2; i++) { const m = Math.floor(c.player.x * 2) === i && Math.floor(c.player.z * 2) === j; r += m ? 'M' : ok[j * gw + i] ? '.' : '#'; } rows.push(r); }
  return rows.join('\n');
}, +x0, +x1, +z0, +z1);
console.log(out);
await browser.close();
