// ---------------------------------------------------------------------------
// Everything that stands on a designed map: its own pictures (placed in the Map Maker), painted bridges,
// boardwalks, stone steps, painted waterfalls, and mossy rocks at the foot of every cliff you can see.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { buildDesignedSteps, designed, groundHeight, isWet, kindAt } from './world';
import { ELEV, FALL_PICS, type RockPlace, blockers, buildBoardwalks, buildRockBatch, flushSprites, placePaintedFall, queueSprite, bridgeFit, BRIDGE_RAIL } from './props';
import { fbm, rng } from './noise';

/** Moving a picture's base toward the camera by a in x, z AND y keeps it on the same spot on screen. */
const TOWARD = 1 / Math.sqrt(3);
const ROCKS = ['b11', 'b12', 'b13', 'b10', 'b14'];
const DIAG = Math.SQRT1_2;

export async function placeDesigned(scene: THREE.Scene, noise: THREE.Texture): Promise<THREE.Vector3[]> {
  const dm = designed!;
  const m = dm.map;
  const R = rng(m.seed * 7 + 3);
  const placed: { x: number; z: number; r: number }[] = [];
  const onCrossing = (x: number, z: number) => dm.bridges.some((b) => {
    const along = b.axis === 'z' ? z - b.z : x - b.x;
    const off = b.axis === 'z' ? x - b.x : z - b.z;
    return b.kind !== 'stepping stones' && Math.abs(along) < b.half + 0.5 && Math.abs(off) < b.width / 2 + 1.3;
  });
  const free = (x: number, z: number, r: number) => placed.every((p) => Math.hypot(x - p.x, z - p.z) >= (r + p.r) * 0.9);

  // nearest dry ground within 1.5 units, stepping out in rings (with a small margin so the base isn't on the shore line)
  const SHORE_SNAP = /lantern|bush|flower|tree|mushroom|bamboo|basket|cart|hay|barrel|bench|sign|deco prop/; // (rocks in water look natural)
  // (only ground near the water's own height: never up a cliff onto a pillar or terrace)
  const nearestDry = (x: number, z: number): [number, number] | null => {
    const lvl = dm.waterLevel(x, z);
    for (let r = 0.3; r <= 1.5; r += 0.2) {
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        const qx = x + Math.cos(a) * r, qz = z + Math.sin(a) * r;
        const ox = qx + Math.cos(a) * 0.3, oz = qz + Math.sin(a) * 0.3;
        if (!isWet(kindAt(qx, qz)) && !isWet(kindAt(ox, oz)) && Math.abs(groundHeight(ox, oz) - lvl) < 0.8) return [ox, oz];
      }
    }
    return null;
  };
  // --- the map's own pictures, where the Map Maker put them
  for (let p of m.pictures) {
    const kind = p.kind.toLowerCase();
    const group = p.group.toLowerCase();
    if (p.fw && p.fd) {
      // a building filling a plot: its picture stands on the plot's front corner, centred on the plot on screen
      // (a smaller house keeps the plot's middle and shrinks its footprint with it)
      const sc = p.scale ?? 1;
      const pw = p.w * sc;
      const fw = p.fw * sc;
      const fd = p.fd * sc;
      const dx = (fw - fd) / 2 / Math.SQRT2;
      const a = 0.3 * TOWARD;
      const anchor = 0.5 + dx / pw;
      queueSprite(p.n, p.x, p.z, { width: pw, front: [fw / 2 + a, fd / 2 + a], y: groundHeight(p.x, p.z) + a, anchor: p.flip ? 1 - anchor : anchor, flip: p.flip, shadow: 0 });
      for (let x = p.x - fw / 2 + 0.6; x <= p.x + fw / 2 - 0.5; x += 0.9) {
        for (let z = p.z - fd / 2 + 0.6; z <= p.z + fd / 2 - 0.5; z += 0.9) blockers.push({ x, z, r: 0.6 });
      }
      placed.push({ x: p.x, z: p.z, r: Math.max(fw, fd) / 2 });
      continue;
    }
    // plants and rocks the Map Maker left on a bridge's crossing would poke through the bridge picture
    if (onCrossing(p.x, p.z)) continue;
    const push = Math.min(1.2, 0.35 * p.w);
    const a = push * TOWARD;
    const tree = kind.includes('tree') || /tree|pine|bamboo/.test(group);
    const rock = kind.includes('rock') || group.includes('rock');
    const prop = /lantern|cart|basket|hay|prop|sign|well|bench|barrel/.test(kind);
    const block = tree ? (p.w < 2 ? 0.3 : 0.42) : rock ? Math.min(0.9, 0.3 * p.w) : prop ? 0.3 : 0;
    // ONE RULE: a standing land thing (lantern, plant, small prop) that ended up in water steps to the nearest dry
    // spot close by; with no shore close by it is left out, so nothing floats on a pond. Things placed in water on
    // purpose keep their spot: rocks, baths, spouts, boats, gates, buildings; and anything on a boardwalk deck.
    if (p.where === 'land' && SHORE_SNAP.test(kind) && !/cliff rock|bath/.test(kind) && isWet(kindAt(p.x, p.z)) && !dm.onBoardwalk(p.x, p.z)) {
      const dry = nearestDry(p.x, p.z);
      if (!dry) { console.warn(`left out: ${p.kind} (${p.n}) stands in open water at ${p.x}, ${p.z}`); continue; }
      p = { ...p, x: dry[0], z: dry[1] };
    }
    // water plants float on the water, not on the bed below it
    const onWater = isWet(kindAt(p.x, p.z));
    const y = onWater ? Math.max(groundHeight(p.x, p.z), dm.waterLevel(p.x, p.z)) + 0.01 : groundHeight(p.x, p.z);
    queueSprite(p.n, p.x, p.z, {
      width: p.w, front: [a, a], y: y + a, anchor: 0.5, flip: p.flip, block,
      shadow: tree && !kind.includes('backdrop') ? 0.5 : 0,
    });
    placed.push({ x: p.x, z: p.z, r: Math.max(0.2, p.w * 0.3) });
  }

  // --- bridges: the painted wooden bridge, sized to each crossing (stepping stones: boulders)
  const RAIL = BRIDGE_RAIL;
  const rocks3d: RockPlace[] = [];
  for (const b of dm.bridges) {
    if (b.kind === 'stepping stones') {
      const n = Math.max(1, Math.round((b.half * 2) / 0.9));
      for (let t = 0; t <= n; t++) {
        const along = -b.half + (b.half * 2 * t) / n;
        const x = b.axis === 'x' ? b.x + along : b.x;
        const z = b.axis === 'z' ? b.z + along : b.z;
        rocks3d.push({ x, y: b.deck - 0.3, z, sx: 0.42, sy: 0.3, sz: 0.42, ry: R() * 6.28, shape: Math.floor(R() * 5) });
      }
      continue;
    }
    const f = bridgeFit(b);
    const o = { width: f.width, flip: f.flip, y: f.y, anchor: f.anchor, shear: f.shear, front: [0, 0] as [number, number], shadow: 0 };
    queueSprite('f02', b.x, b.z, { ...o, decal: true });
    const line: [number, number, number, number] = b.axis === 'z' ? [b.x + RAIL, b.z - 3, b.x + RAIL, b.z + 3] : [b.x - 3, b.z + RAIL, b.x + 3, b.z + RAIL];
    queueSprite('f02r', b.x, b.z, { ...o, line });
    for (let t = -1; t <= 1; t += 0.5) placed.push({ x: b.x + (b.axis === 'x' ? t * b.half : 0), z: b.z + (b.axis === 'z' ? t * b.half : 0), r: 0.9 });
  }
  const nearBridge = (x: number, z: number, pad: number) => dm.bridges.some((b) => {
    const along = b.axis === 'z' ? z - b.z : x - b.x;
    const off = b.axis === 'z' ? x - b.x : z - b.z;
    return Math.abs(along) < b.half + pad + 0.3 && Math.abs(off) < b.width / 2 + pad;
  });

  // --- boardwalks (3D planks, walkable) and stone steps
  if (m.boardwalks.length) scene.add(buildBoardwalks(m.boardwalks.map((b) => b.points)));
  scene.add(buildDesignedSteps(noise));

  // --- painted waterfalls on every fall you can see; mist where they land
  const mist: THREE.Vector3[] = [];
  const inFall = (x: number, z: number) => dm.falls.some((f) => {
    const a = f.dir === 'x' ? z : x;
    const b = f.dir === 'x' ? x : z;
    return a > f.a0 - 0.3 && a < f.a1 + 0.3 && b > f.at - 0.9 && b < f.at + 1.9;
  });
  for (const f of dm.falls) {
    placePaintedFall(f, FALL_PICS[f.a1 - f.a0 >= 2.5 ? 0 : 1]);
    const mid = (f.a0 + f.a1) / 2;
    mist.push(f.dir === 'x' ? new THREE.Vector3(f.at + 0.6, f.bottom + 0.1, mid) : new THREE.Vector3(mid, f.bottom + 0.1, f.at + 0.6));
  }

  // --- rocks along every cliff you can see: painted mossy rocks at the foot of dry cliffs (bigger under
  // taller cliffs), 3D boulders standing in the water along rocky banks
  const STEP = 0.42;
  for (let z = -2; z < m.D + 2; z += STEP) {
    for (let x = -2; x < m.W + 2; x += STEP) {
      const h = groundHeight(x, z);
      for (const [dx, dz] of [[1, 0], [0, 1]]) {
        const lx = x + dx * STEP * 1.6;
        const lz = z + dz * STEP * 1.6;
        const low = groundHeight(lx, lz);
        const drop = h - low;
        if (drop < 0.5) continue;
        const wetBelow = isWet(kindAt(lx, lz));
        if (dm.nearStep(lx, lz, 0.6) || dm.nearStep(x, z, 0.6) || inFall(x, z) || inFall(lx, lz) || nearBridge(lx, lz, 0.4)) continue;
        const n = fbm(x * 0.8, z * 0.8, 77);
        if (R() > (wetBelow ? 0.16 : 0.22 + n * 0.45)) continue;
        const fx = lx + (R() - 0.3) * 0.35 * (dx || 0.4);
        const fz = lz + (R() - 0.3) * 0.35 * (dz || 0.4);
        if (wetBelow) {
          const lvl = dm.waterLevel(fx, fz);
          if (lvl < -50) continue;
          const size = 0.28 + R() * 0.25 + n * 0.15;
          rocks3d.push({ x: fx, y: lvl - size * 0.35, z: fz, sx: size * (0.9 + R() * 0.4), sy: size * (1.0 + R() * 0.5), sz: size * (0.9 + R() * 0.4), ry: R() * 6.28, shape: Math.floor(R() * 5) });
        } else {
          if (dm.pathMask(fx, fz) > 0.2 || isWet(kindAt(fx, fz))) continue;
          const big = Math.min(1.8, 0.75 + drop * 0.3) * (0.8 + R() * 0.45);
          if (!free(fx, fz, big * 0.35)) continue;
          placed.push({ x: fx, z: fz, r: big * 0.35 });
          queueSprite(ROCKS[Math.floor(R() * ROCKS.length)], fx, fz, { width: big, r: 0.2, block: big * 0.35, flip: R() < 0.5, shadow: 0 });
        }
      }
    }
  }
  // --- mossy rocks up the faces of the taller cliffs, so no big bare rock wall is left
  for (let z = -1; z < m.D + 1; z += 0.5) {
    for (let x = -1; x < m.W + 1; x += 0.5) {
      const jx = x + (R() - 0.5) * 0.4;
      const jz = z + (R() - 0.5) * 0.4;
      const h = groundHeight(jx, jz);
      const face = Math.max(h - groundHeight(jx + 0.25, jz), h - groundHeight(jx, jz + 0.25));
      if (face < 0.35 || R() > 0.13) continue;
      if (isWet(kindAt(jx, jz)) || dm.nearStep(jx, jz, 0.8) || inFall(jx, jz) || nearBridge(jx, jz, 0.5)) continue;
      const size = 0.6 + R() * 0.55;
      if (!free(jx, jz, size * 0.3)) continue;
      placed.push({ x: jx, z: jz, r: size * 0.3 });
      queueSprite(ROCKS[Math.floor(R() * ROCKS.length)], jx, jz, { width: size, r: 0.05, y: h - 0.08, flip: R() < 0.5, shadow: 0 });
    }
  }
  buildRockBatch(scene, rocks3d);
  await flushSprites(scene, noise);
  return mist;
}
