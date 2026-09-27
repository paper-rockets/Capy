// ---------------------------------------------------------------------------
// Round mini-map (bottom right), like the target picture: the land around Mochi seen from
// above, turned so "up" on the mini-map is "up" on the screen. Lost ducklings show as pins
// (on the rim when they are further away, pointing the way), Mama Duck as a little face.
// The ground picture is painted once in small slices after loading, so it adds nothing to the
// load time; the markers are redrawn about 10 times a second.
// ---------------------------------------------------------------------------

export interface MinimapWorld {
  mapW: number;
  mapD: number;
  /** what the ground builder already worked out at a point (no new sums) */
  sample(x: number, z: number): { kind: string; h: number; path: number; plaza: boolean };
}
export interface MinimapMarks {
  player: { x: number; z: number; heading: number };
  ducklings: { x: number; z: number; state: string }[];
  mama: { x: number; z: number } | null;
}

const CSS = `
  .mm { position: fixed; right: 14px; bottom: 14px; width: 168px; height: 168px; border-radius: 50%;
    background: #9cc86a; border: 6px solid #7a4d27; box-shadow: 0 0 0 3px #c79a62 inset, 0 4px 0 #4b2d15, 0 10px 20px rgba(0,0,0,0.3);
    overflow: visible; cursor: pointer; }
  .mm canvas { position: absolute; inset: 0; width: 100%; height: 100%; border-radius: 50%; }
  .mm .n { position: absolute; top: -15px; left: 50%; transform: translateX(-50%); width: 26px; height: 26px; border-radius: 50%;
    background: #fff6e4; border: 3px solid #7a4d27; font: 900 14px Nunito, sans-serif; color: #4a2d14; display: grid; place-items: center; }
  .mm .zoom { position: absolute; width: 36px; height: 36px; border-radius: 50%; background: #fff6e4; border: 3px solid #7a4d27;
    font: 900 22px/1 Nunito, sans-serif; color: #4a2d14; display: grid; place-items: center; box-shadow: 0 2px 0 #4b2d15; padding: 0; cursor: pointer; }
  .mm .zin { right: -10px; bottom: -8px; }
  .mm .zout { left: -10px; bottom: -8px; }
  @media (max-height: 520px) {
    .mm { width: 116px; height: 116px; right: 10px; bottom: 10px; border-width: 4px; }
    .mm .n { width: 20px; height: 20px; font-size: 11px; top: -11px; border-width: 2px; }
    .mm .zoom { width: 28px; height: 28px; font-size: 17px; border-width: 2px; }
  }
`;

const RANGE = 20; // world units from Mochi to the rim
const PER = 2; // ground picture samples per world unit

export function createMinimap(world: MinimapWorld, onTap: () => void, onZoom: (dir: 1 | -1) => void) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const box = document.createElement('div');
  box.className = 'mm';
  box.innerHTML = `<canvas></canvas><div class="n">N</div><button class="zoom zout" aria-label="Zoom out">−</button><button class="zoom zin" aria-label="Zoom in">+</button>`;
  document.body.appendChild(box);
  const canvas = box.querySelector('canvas')!;
  const g = canvas.getContext('2d')!;
  box.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.classList.contains('zin')) onZoom(1);
    else if (t.classList.contains('zout')) onZoom(-1);
    else onTap();
  });

  // --- the ground, painted once (in slices, a few rows per frame)
  const base = document.createElement('canvas');
  base.width = world.mapW * PER;
  base.height = world.mapD * PER;
  const bg = base.getContext('2d')!;
  const img = bg.createImageData(base.width, base.height);
  const COL: Record<string, [number, number, number]> = {
    meadow: [140, 198, 90], terrace: [172, 214, 104], plateau: [112, 160, 80], high: [96, 140, 72],
    pool: [94, 200, 224], river: [94, 200, 224], stairs: [196, 178, 150],
  };
  let row = 0;
  const paintRows = (n: number) => {
    for (let k = 0; k < n && row < base.height; k++, row++) {
      const z = (row + 0.5) / PER;
      for (let col = 0; col < base.width; col++) {
        const x = (col + 0.5) / PER;
        const p = world.sample(x, z);
        let [r, gg, b] = COL[p.kind] ?? COL.meadow;
        if (p.kind !== 'river' && p.kind !== 'pool') {
          if (p.plaza) [r, gg, b] = [214, 204, 184];
          else if (p.path > 0.5) [r, gg, b] = [236, 198, 128];
          // a darker rim where the ground drops away, so hills and cliffs read
          if (p.h - world.sample(x + 0.5, z).h > 0.4 || p.h - world.sample(x, z + 0.5).h > 0.4) { r *= 0.62; gg *= 0.62; b *= 0.62; }
        }
        const i = (row * base.width + col) * 4;
        img.data[i] = r; img.data[i + 1] = gg; img.data[i + 2] = b; img.data[i + 3] = 255;
      }
    }
    bg.putImageData(img, 0, 0);
  };

  const pics: Record<string, HTMLImageElement> = {};
  for (const n of ['pin_duckling', 'mama_talk']) { pics[n] = new Image(); pics[n].src = `ui/${n}.webp`; }

  let last = 0;
  function update(now: number, marks: () => MinimapMarks) {
    if (row < base.height) paintRows(base.height); // look-ups only: all at once is quick
    if (now - last < 100) return;
    last = now;
    const m = marks();
    const size = Math.round(box.clientWidth * Math.min(2, window.devicePixelRatio));
    if (canvas.width !== size) { canvas.width = canvas.height = size; }
    const R = size / 2;
    const k = R / RANGE; // pixels per world unit
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, size, size);
    // world → mini-map: centred on Mochi, turned 45° so the screen's "up" (toward -x -z) is up
    g.setTransform(1, 0, 0, 1, R, R);
    g.rotate(Math.PI / 4);
    g.scale(k, k);
    g.translate(-m.player.x, -m.player.z);
    g.imageSmoothingEnabled = true;
    g.drawImage(base, 0, 0, world.mapW, world.mapD);
    // screen position of a world point (for markers drawn upright)
    const at = (x: number, z: number) => {
      const dx = (x - m.player.x) * k;
      const dz = (z - m.player.z) * k;
      return [R + (dx - dz) * Math.SQRT1_2, R + (dx + dz) * Math.SQRT1_2];
    };
    g.setTransform(1, 0, 0, 1, 0, 0);
    const pinH = size * 0.16;
    const icon = (p: HTMLImageElement, x: number, z: number, h: number, clampToRim: boolean) => {
      let [sx, sy] = at(x, z);
      const dx = sx - R;
      const dy = sy - R;
      const d = Math.hypot(dx, dy);
      const maxD = R - h * 0.55;
      if (d > maxD) {
        if (!clampToRim) return;
        sx = R + (dx / d) * maxD;
        sy = R + (dy / d) * maxD;
      }
      if (p.complete && p.naturalWidth) g.drawImage(p, sx - (h * p.naturalWidth) / p.naturalHeight / 2, sy - h * 0.9, (h * p.naturalWidth) / p.naturalHeight, h);
    };
    if (m.mama) icon(pics.mama_talk, m.mama.x, m.mama.z, pinH * 0.95, true);
    for (const d of m.ducklings) if (d.state === 'lost') icon(pics.pin_duckling, d.x, d.z, pinH, true);
    // Mochi: an orange arrow in the middle, pointing where he faces
    const hx = Math.sin(m.player.heading);
    const hz = Math.cos(m.player.heading);
    const ax = (hx - hz) * Math.SQRT1_2;
    const ay = (hx + hz) * Math.SQRT1_2;
    const s = size * 0.07;
    g.beginPath();
    g.moveTo(R + ax * s * 1.3, R + ay * s * 1.3);
    g.lineTo(R - ax * s * 0.8 - ay * s * 0.9, R - ay * s * 0.8 + ax * s * 0.9);
    g.lineTo(R - ax * s * 0.35, R - ay * s * 0.35);
    g.lineTo(R - ax * s * 0.8 + ay * s * 0.9, R - ay * s * 0.8 - ax * s * 0.9);
    g.closePath();
    g.fillStyle = '#ff7a2e';
    g.strokeStyle = '#fff';
    g.lineWidth = size * 0.018;
    g.lineJoin = 'round';
    g.fill();
    g.stroke();
  }
  return { update };
}
