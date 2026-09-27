import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
await page.goto('http://localhost:8166/?nosave', { waitUntil: 'networkidle0', timeout: 180000 });
await page.waitForFunction(() => window.capy && window.capy.ducks, { timeout: 180000 });
console.log(await page.evaluate(() => {
  const out = [];
  const seen = new Set();
  window.capy.scene.traverse((o) => {
    if (o.name !== 'ducks') return;
    o.traverse((m) => {
      if (!m.isMesh || m.name === 'shadow') return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) {
        const k = m.name + mat.name;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(`${m.name} skinned=${!!m.isSkinnedMesh} ${mat.type} ${mat.name} color=${mat.color?.getHexString()} emissive=${mat.emissive?.getHexString()} map=${!!mat.map} rough=${mat.roughness} metal=${mat.metalness} verts=${m.geometry.attributes.position.count}`);
      }
    });
  });
  return out.join('\n');
}));
await browser.close();
