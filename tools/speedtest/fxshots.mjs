// Screenshots of the Round 7 effects in play: garden puffs, sparkles, dust, splash, floating icons.
// usage: node fxshots.mjs <outdir> [extra-query]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
const [, , outDir = 'fxshots', extra = ''] = process.argv;
fs.mkdirSync(outDir, { recursive: true });
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars'] });
const page = await browser.newPage();
await page.setViewport({ width: 1200, height: 800, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('console error', m.text().slice(0, 300)); });
await page.goto('http://localhost:8166/?nosave&at=58.5,19.6' + (extra ? '&' + extra : ''), { waitUntil: 'networkidle0', timeout: 240000 });
await page.waitForFunction(() => document.getElementById('loading').classList.contains('done'), { timeout: 240000 });
await new Promise((r) => setTimeout(r, 2500));
const shot = async (name, js, wait = 700, hideHud = true) => {
  await page.evaluate((hide) => {
    const canvas = window.capy.renderer.domElement;
    for (const e of document.body.children) if (e !== canvas) e.style.visibility = hide ? 'hidden' : '';
  }, hideHud);
  if (js) await page.evaluate(js);
  await new Promise((r) => setTimeout(r, wait));
  await page.screenshot({ path: path.join(outDir, name + '.png') });
  console.log('saved', name);
};
// garden, close up: every garden effect at once, plus the ripe shine that is always on over the carrots
await shot('garden', `(() => {
  const c = window.capy; c.setView(6.5);
  const g = (x, z) => c.groundHeight(x, z) + 0.3;
  const B = c.garden.beds;
  c.fx.play('dig', B[2].x, g(B[2].x, B[2].z), B[2].z);
  c.fx.play('water', B[5].x, g(B[5].x, B[5].z), B[5].z, { repeat: 3 });
  c.fx.play('sprout', B[4].x, g(B[4].x, B[4].z), B[4].z);
  c.fx.play('harvest', B[3].x, g(B[3].x, B[3].z), B[3].z);
  c.fx.pop('sun', B[3].x, g(B[3].x, B[3].z) + 0.6, B[3].z, 2);
})()`, 900);
// Mochi celebrates (quest done) and kicks up dust
await shot('celebrate', `(() => {
  const c = window.capy; c.setView(6.5);
  c.celebrate(true);
  const y = c.groundHeight(c.player.x, c.player.z);
  c.fx.play('dust', c.player.x - 0.45, y, c.player.z - 0.3, { shift: 0.05 });
  c.fx.play('dust', c.player.x - 0.75, y, c.player.z - 0.5, { shift: 0.05, delay: 0.1, flip: true });
})()`, 800);
// the lake: a splash and hearts
await shot('lake', `(() => {
  const c = window.capy; c.player.x = 54; c.player.z = 37.4; c.setView(6.5);
})()`, 3500);
await shot('lake_fx', `(() => {
  const c = window.capy;
  c.fx.play('splash', 54.6, 0.45, 35.6, { size: 0.9 });
  c.fx.pop('heart', 54.0, 0.9, 34.2, 3, 0.34);
  c.fx.play('sparkle', 53.4, 0.7, 34.8, { size: 1.2 });
})()`, 700);
// the new round buttons + a message with Mochi's face (screen pictures)
await shot('hud', `(() => {
  const c = window.capy; c.setView(11);
  c.hud.toast('What a gardener!', '4 crops picked. +1 Golden Leaf', 'mochi_proud', 20);
})()`, 900, false);
await browser.close();
