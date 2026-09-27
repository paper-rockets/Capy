// ---------------------------------------------------------------------------
// The six designed maps (made in Capy/Map Designs with the Map Maker, copied into public/maps by
// tools/import_designed_maps.py) turned into the game's ground: the same painted ground, rocky cliffs
// and moving water as Sunny Meadow. world.ts hands its questions (height, kind, water...) to this when
// a designed map is loaded (?map=<key>).
//
// A map is a grid of squares, each with a level (0 = sea, 1-4 = land, # = the tall back bank) and
// maybe water. Here it becomes a fine grid of heights (RES points per square):
//  - outlines wander (nature has no straight lines), except at steps, bridges, plots and waterfalls
//  - cliffs lean and are steep enough to be drawn as rock; streams sit in rocky gorges
//  - flat land gets gentle rolling bumps, fading out near edges and built things
// ---------------------------------------------------------------------------
import { fbm } from './noise';

type Rect = [number, number, number, number]; // x0, z0, x1, z1 (the Map Maker's order)
type P2 = [number, number];

export interface DStep { dir: 'x' | 'z'; upper: number; lower: number; steps: number; rect: Rect; name?: string }
export interface DPic {
  n: string; x: number; z: number; w: number; kind: string; group: string; where: string;
  flip?: boolean; fw?: number; fd?: number; glow?: boolean;
  /** buildings: drawn this much smaller than the Map Maker's size, footprint too (softer-house test) */
  scale?: number;
}
export interface DMapFile {
  key: string; name: string; seed: number; W: number; D: number;
  levels: Record<string, number>; frame_h: number; water_drop: [number, number];
  cells: string[]; water: string[]; sand: string[];
  steps: DStep[];
  bridges: { kind: string; axis: 'x' | 'z'; level: number; rect: Rect; name?: string }[];
  boardwalks: { points: P2[]; level?: number; width?: number }[];
  paths: P2[][];
  plots: { rect: Rect; soil?: boolean; name?: string }[];
  crags: number[][];
  start: P2;
  spots?: { n: number; name: string; x: number; z: number }[];
  palette: Record<string, number[]>;
  night: boolean; l0: string;
  pictures: DPic[];
}
export interface DFall { dir: 'x' | 'z'; at: number; a0: number; a1: number; top: number; bottom: number }
export interface DBridge { x: number; z: number; axis: 'x' | 'z'; half: number; deck: number; arc: number; kind: string; width: number }
export type DKind = 'meadow' | 'stairs' | 'river' | 'high';

const FRAME = 5; // the tall back bank ('#')
const NO_WATER = -99;
const KINDS: DKind[] = ['meadow', 'stairs', 'river', 'high'];
const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const clampI = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
function segDist(px: number, pz: number, a: P2, b: P2): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz || 1e-9;
  const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / l2));
  return Math.hypot(a[0] + dx * t - px, a[1] + dz * t - pz);
}
function polyDist(px: number, pz: number, pts: P2[]): number {
  let d = 1e9;
  for (let i = 0; i + 1 < pts.length; i++) d = Math.min(d, segDist(px, pz, pts[i], pts[i + 1]));
  return d;
}
function rectDist(px: number, pz: number, [x0, z0, x1, z1]: Rect): number {
  const dx = Math.max(x0 - px, 0, px - x1);
  const dz = Math.max(z0 - pz, 0, pz - z1);
  return Math.hypot(dx, dz);
}
const inRect = (x: number, z: number, r: Rect) => x >= r[0] && x < r[2] && z >= r[1] && z < r[3];

/**
 * Nearest-source distance over a grid (two-pass chamfer): dist in grid steps, src = index of the nearest source.
 * Sources are the points where isSrc is 1.
 */
function distanceField(nx: number, nz: number, isSrc: Uint8Array): { dist: Float32Array; src: Int32Array } {
  const S = nx + 1;
  const N = S * (nz + 1);
  const dist = new Float32Array(N).fill(1e9);
  const src = new Int32Array(N).fill(-1);
  for (let k = 0; k < N; k++) if (isSrc[k]) { dist[k] = 0; src[k] = k; }
  const relax = (k: number, n: number) => {
    const s = src[n];
    if (s < 0) return;
    const si = s % S;
    const sj = (s - si) / S;
    const ki = k % S;
    const kj = (k - ki) / S;
    const d = Math.hypot(ki - si, kj - sj);
    if (d < dist[k]) { dist[k] = d; src[k] = s; }
  };
  for (let pass = 0; pass < 2; pass++) {
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
      const k = j * S + i;
      if (i > 0) relax(k, k - 1);
      if (j > 0) { relax(k, k - S); if (i > 0) relax(k, k - S - 1); if (i < nx) relax(k, k - S + 1); }
    }
    for (let j = nz; j >= 0; j--) for (let i = nx; i >= 0; i--) {
      const k = j * S + i;
      if (i < nx) relax(k, k + 1);
      if (j < nz) { relax(k, k + S); if (i < nx) relax(k, k + S + 1); if (i > 0) relax(k, k + S - 1); }
    }
  }
  return { dist, src };
}

export function buildDesigned(m: DMapFile, RES: number, PAD: number) {
  const t0 = performance.now();
  const { W, D } = m;
  const seed = m.seed || 1;
  const [dropTop, dropBed] = m.water_drop || [0.8, 1.5];
  const LH = (l: number) => (l === FRAME ? m.frame_h : m.levels[String(l)]);
  const surface = (l: number) => (l === 0 ? LH(0) : LH(l) - dropTop);

  // --- the squares
  const lv = new Int8Array(W * D);
  const wetC = new Uint8Array(W * D);
  for (let z = 0; z < D; z++) {
    for (let x = 0; x < W; x++) {
      const ch = m.cells[z][x];
      const l = ch === '#' ? FRAME : Number(ch) || 0;
      lv[z * W + x] = l;
      wetC[z * W + x] = l >= 1 && l <= 4 && m.water[z][x] === '~' ? 1 : 0;
    }
  }
  // past the edge of the map: sea in front (toward the camera), the tall back bank behind
  const L = (x: number, z: number) => (x >= W || z >= D ? 0 : x < 0 || z < 0 ? FRAME : lv[z * W + x]);
  const WET = (x: number, z: number) => x >= 0 && z >= 0 && x < W && z < D && wetC[z * W + x] === 1;

  // --- waterfalls: water spilling over a level edge toward the camera (+x or +z), into lower water or the sea
  const falls: DFall[] = [];
  for (const dir of ['x', 'z'] as const) {
    for (let a = 0; a < (dir === 'x' ? W - 1 : D - 1); a++) {
      let run: { b0: number; up: number; low: number } | null = null;
      const alongN = dir === 'x' ? D : W;
      for (let b = 0; b <= alongN; b++) {
        let hit: { up: number; low: number } | null = null;
        if (b < alongN) {
          const [x, z, x2, z2] = dir === 'x' ? [a, b, a + 1, b] : [b, a, b, a + 1];
          const up = L(x, z);
          const low = L(x2, z2);
          if (WET(x, z) && up >= 1 && up <= 4 && ((WET(x2, z2) && low < up) || low === 0)) hit = { up, low };
        }
        if (run && (!hit || hit.up !== run.up || hit.low !== run.low)) {
          falls.push({ dir, at: a + 1, a0: run.b0, a1: b, top: surface(run.up), bottom: surface(run.low) });
          run = null;
        }
        if (hit && !run) run = { b0: b, ...hit };
      }
    }
  }

  // --- bridges in the game's form (walk across along axis)
  const bridges: DBridge[] = m.bridges.map((b) => {
    const [x0, z0, x1, z1] = b.rect;
    const along = b.axis === 'x' ? x1 - x0 : z1 - z0;
    const across = b.axis === 'x' ? z1 - z0 : x1 - x0;
    return { x: (x0 + x1) / 2, z: (z0 + z1) / 2, axis: b.axis, half: along / 2, deck: LH(b.level) + 0.05, arc: b.kind === 'bridge' ? 0.22 : 0.05, kind: b.kind, width: across };
  });

  // --- the fine grid
  const nx = (W + PAD * 2) * RES;
  const nz = (D + PAD * 2) * RES;
  const S = nx + 1;
  const N = S * (nz + 1);
  const X = (i: number) => i / RES - PAD;

  // built things keep their shape: the wobble fades out near them
  const soft: [Rect, number, number][] = [];
  for (const s of m.steps) {
    const [x0, z0, x1, z1] = s.rect;
    soft.push([s.dir === 'z' ? [x0 - 1, z0 - 2, x1 + 1, z1 + 2] : [x0 - 2, z0 - 1, x1 + 2, z1 + 1], 0.2, 2.5]);
  }
  for (const b of m.bridges) soft.push([b.rect, 0.2, 2.5]);
  for (const p of m.plots) soft.push([p.rect, 0.3, 2.5]);
  for (const f of falls) {
    const r: Rect = f.dir === 'x' ? [f.at - 0.6, f.a0 - 0.35, f.at + 0.6, f.a1 + 0.35] : [f.a0 - 0.35, f.at - 0.6, f.a1 + 0.35, f.at + 0.6];
    soft.push([r, 0.2, 2.2]);
  }
  const fade = new Float32Array(N);
  const stepAt = new Int16Array(N).fill(-1);
  const pathW = new Float32Array(N);
  const pathSegs: [P2, P2][] = m.paths.filter((p) => p.length > 1).flatMap((p) => p.slice(0, -1).map((a, i): [P2, P2] => [a, p[i + 1]]));
  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      const k = j * S + i;
      const x = X(i);
      const z = X(j);
      let f = 1;
      for (const [r, a, b] of soft) { const d = rectDist(x, z, r); if (d < b) f = Math.min(f, smooth(a, b, d)); }
      for (const bw of m.boardwalks) { const d = polyDist(x, z, bw.points); if (d < 2.5) f = Math.min(f, smooth(0.6, 2.5, d)); }
      fade[k] = f;
      m.steps.forEach((s, n) => { if (inRect(x, z, s.rect)) stepAt[k] = n; });
      let pd = 9;
      if (x > -1 && z > -1 && x < W + 1 && z < D + 1) for (const [a, b] of pathSegs) { const d = segDist(x, z, a, b); if (d < pd) pd = d; }
      const wob = (fbm(x * 1.6, z * 1.6, seed + 40) - 0.5) * 0.26;
      pathW[k] = 1 - smooth(0.55, 0.75, pd + wob);
    }
  }

  // level and water at every point: the four nearest squares blended, with the outline pushed around by noise
  const lvS = new Int8Array(N);
  const wetS = new Uint8Array(N);
  const rockS = new Uint8Array(N);
  const h = new Float32Array(N);
  // squares under stone steps count as the steps' lower level when drawing outlines: the Map Maker paints the
  // steps' squares as the upper level, which left thin walls of upper ground poking out along both sides
  const stepLow = new Int8Array(W * D).fill(-1);
  for (const s of m.steps) {
    const [x0, z0, x1, z1] = s.rect;
    for (let z = Math.max(0, Math.floor(z0)); z < Math.min(D, Math.ceil(z1)); z++) {
      for (let x = Math.max(0, Math.floor(x0)); x < Math.min(W, Math.ceil(x1)); x++) {
        if (inRect(x + 0.5, z + 0.5, s.rect)) stepLow[z * W + x] = s.lower;
      }
    }
  }
  const rank = (x: number, z: number) => (x >= 0 && z >= 0 && x < W && z < D && stepLow[z * W + x] >= 0 ? stepLow[z * W + x] : L(x, z));
  const crags = m.crags.map((c) => [c[0], c[1], c[2], c[3], c[4], LH(Math.max(1, Math.min(4, L(Math.floor(c[0]), Math.floor(c[1])))))]);
  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      const k = j * S + i;
      const x = X(i);
      const z = X(j);
      const f = fade[k];
      const ox = ((fbm(x * 0.3, z * 0.3, seed + 61) - 0.5) * 2.6 + (fbm(x * 0.9, z * 0.9, seed + 63) - 0.5) * 1.0 + (fbm(x * 2.3, z * 2.3, seed + 65) - 0.5) * 0.3) * f;
      const oz = ((fbm(x * 0.3 + 17, z * 0.3, seed + 62) - 0.5) * 2.6 + (fbm(x * 0.9, z * 0.9 + 9, seed + 64) - 0.5) * 1.0 + (fbm(x * 2.3 + 5, z * 2.3, seed + 66) - 0.5) * 0.3) * f;
      const u = x + ox - 0.5;
      const v = z + oz - 0.5;
      const i0 = Math.floor(u);
      const j0 = Math.floor(v);
      const fu = u - i0;
      const fv = v - j0;
      const r00 = rank(i0, j0);
      const r10 = rank(i0 + 1, j0);
      const r01 = rank(i0, j0 + 1);
      const r11 = rank(i0 + 1, j0 + 1);
      let R = 0;
      for (let t = 1; t <= 5; t++) {
        const val = (r00 >= t ? 1 : 0) * (1 - fu) * (1 - fv) + (r10 >= t ? 1 : 0) * fu * (1 - fv) + (r01 >= t ? 1 : 0) * (1 - fu) * fv + (r11 >= t ? 1 : 0) * fu * fv;
        if (val > 0.5) R = t;
        else break;
      }
      // water: its own (smaller) wobble, only where the square below is the same level
      const wx = x + ((fbm(x * 0.5, z * 0.5, seed + 21) - 0.5) * 1.1 + (fbm(x * 1.3, z * 1.3, seed + 22) - 0.5) * 0.45) * f - 0.5;
      const wz = z + ((fbm(x * 0.5, z * 0.5, seed + 23) - 0.5) * 1.1 + (fbm(x * 1.3, z * 1.3, seed + 24) - 0.5) * 0.45) * f - 0.5;
      const p0 = Math.floor(wx);
      const q0 = Math.floor(wz);
      const fw = wx - p0;
      const fq = wz - q0;
      const wt = (cx: number, cz: number) => (WET(cx, cz) && L(cx, cz) === R ? 1 : 0);
      const wv = wt(p0, q0) * (1 - fw) * (1 - fq) + wt(p0 + 1, q0) * fw * (1 - fq) + wt(p0, q0 + 1) * (1 - fw) * fq + wt(p0 + 1, q0 + 1) * fw * fq;
      let wet = (R >= 1 && R <= 4 && wv > 0.5) || R === 0;
      let hh: number;
      if (R === FRAME) hh = m.frame_h + (fbm(x * 0.13, z * 0.13, seed + 90) - 0.5) * 3.2;
      else if (R === 0) hh = LH(0) - 1.3 + (fbm(x * 0.4, z * 0.4, seed + 91) - 0.5) * 0.4;
      else if (wet) hh = LH(R) - dropBed + (fbm(x * 0.5, z * 0.5, seed + 2) - 0.5) * 0.2;
      else hh = LH(R);
      // rock spires
      for (const c of crags) {
        const q = Math.hypot((x - c[0]) / c[2], (z - c[1]) / c[3]) + (fbm(x * 0.8, z * 0.8, seed + 95) - 0.5) * 0.5;
        if (q < 1) {
          const hc = c[5] + c[4] * (1 - 0.35 * q * q);
          if (hc > hh) { hh = hc; rockS[k] = 1; wet = false; }
        }
      }
      // stone steps: straight treads, going down toward +x or +z
      const st = stepAt[k];
      if (st >= 0) {
        const s = m.steps[st];
        const [x0, z0, x1, z1] = s.rect;
        const t = Math.max(0, Math.min(0.999, s.dir === 'z' ? (z - z0) / (z1 - z0) : (x - x0) / (x1 - x0)));
        const sn = Math.floor(t * s.steps) + 1;
        hh = LH(s.upper) - ((LH(s.upper) - LH(s.lower)) * sn) / s.steps;
        wet = false;
        rockS[k] = 0;
        R = s.lower;
      }
      lvS[k] = R;
      wetS[k] = wet ? 1 : 0;
      h[k] = hh;
    }
  }

  // --- distances: to the nearest water, and to the nearest edge (a level change, water or steps)
  const isWetSrc = wetS;
  const water = distanceField(nx, nz, isWetSrc);
  const edge = new Uint8Array(N);
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    const k = j * S + i;
    if (wetS[k] || stepAt[k] >= 0 || rockS[k]) { edge[k] = 1; continue; }
    for (const n of [k - 1, k + 1, k - S, k + S]) {
      if (n < 0 || n >= N) continue;
      if (lvS[n] !== lvS[k] || wetS[n]) { edge[k] = 1; break; }
    }
  }
  const edges = distanceField(nx, nz, edge);

  // --- gentle rolling bumps on open land (none near edges, steps, plots, bridges)
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    const k = j * S + i;
    const l = lvS[k];
    if (wetS[k] || rockS[k] || stepAt[k] >= 0 || l < 1 || l > 4) continue;
    const x = X(i);
    const z = X(j);
    const fb = smooth(0.8, 2.8, edges.dist[k] / RES) * smooth(0.3, 1.0, fade[k]);
    if (fb <= 0) continue;
    h[k] += ((fbm(x * 0.085, z * 0.085, seed + 80) - 0.5) * 1.3 + (fbm(x * 0.26, z * 0.26, seed + 81) - 0.5) * 0.3) * fb;
  }

  // --- banks: land dips down into the water beside it (rocky, steep, a little uneven)
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    const k = j * S + i;
    if (wetS[k] || stepAt[k] >= 0) continue;
    const d = water.dist[k] / RES;
    if (d > 0.5) continue;
    const s = water.src[k];
    const bed = h[s];
    if (bed >= h[k]) continue;
    const x = X(i);
    const z = X(j);
    const t = smooth(0.0, 0.42, d + (fbm(x * 1.4, z * 1.4, seed + 7) - 0.5) * 0.18);
    h[k] = bed + (h[k] - bed) * t;
  }

  // --- cliffs lean back instead of standing straight up: the low side is raised and the top worn down
  // toward each other at a steepness that changes along the cliff (still steep enough to be drawn as rock)
  {
    const lean = new Float32Array(N);
    const keep = new Float32Array(N); // 0 = keep as it is (water, steps, near built things and paths)
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
      const k = j * S + i;
      const x = X(i);
      const z = X(j);
      lean[k] = ((4.2 * (0.7 + 0.6 * fbm(x * 0.35, z * 0.35, seed + 33))) / RES);
      keep[k] = wetS[k] || stepAt[k] >= 0 ? 0 : smooth(0.15, 0.7, fade[k]);
    }
    let Dh = new Float32Array(N);
    let Eh = new Float32Array(N);
    for (let k = 0; k < N; k++) { Dh[k] = wetS[k] ? -1e9 : h[k]; Eh[k] = h[k]; }
    let Dn = new Float32Array(Dh);
    let En = new Float32Array(Eh);
    const nb: [number, number, number][] = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [-1, 1, 1.414], [1, -1, 1.414], [-1, -1, 1.414]];
    for (let it = 0; it < 12; it++) {
      for (let j = 1; j < nz; j++) for (let i = 1; i < nx; i++) {
        const k = j * S + i;
        const st = lean[k];
        let dmax = Dh[k];
        let emin = Eh[k];
        for (const [di, dj, fac] of nb) {
          const n = k + di + dj * S;
          const dv = Dh[n] - st * fac;
          const ev = Eh[n] + st * fac;
          if (dv > dmax) dmax = dv;
          if (ev < emin) emin = ev;
        }
        Dn[k] = dmax;
        En[k] = emin;
      }
      [Dh, Dn] = [Dn, Dh];
      [Eh, En] = [En, Eh];
    }
    for (let k = 0; k < N; k++) {
      const w = keep[k];
      if (w <= 0) continue;
      const up = Math.max(h[k], Dh[k]);
      const dn = Math.min(h[k], Eh[k]);
      h[k] += w * ((up + dn) / 2 - h[k]);
    }
  }

  // --- what kind of ground each point is, and the water over it
  const kindS = new Uint8Array(N); // index into KINDS
  const levelW = new Float32Array(N).fill(NO_WATER);
  for (let k = 0; k < N; k++) {
    if (stepAt[k] >= 0) kindS[k] = 1;
    else if (wetS[k]) kindS[k] = 2;
    else if (rockS[k] || lvS[k] === FRAME) kindS[k] = 3;
    else kindS[k] = 0;
    const s = water.src[k];
    if (wetS[k]) levelW[k] = surface(lvS[k]);
    else if (s >= 0 && water.dist[k] / RES < 0.7) levelW[k] = surface(lvS[s]);
  }

  // --- which way the water flows: down each stream toward where it leaves (a waterfall, the sea, the edge)
  const flowC = new Float32Array(W * D * 2);
  {
    const dist = new Int32Array(W * D).fill(-1);
    const q: number[] = [];
    for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
      if (!wetC[z * W + x]) continue;
      const l = lv[z * W + x];
      let out = x === 0 || z === 0 || x === W - 1 || z === D - 1;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nl = L(x + dx, z + dz);
        if (nl === 0 || (WET(x + dx, z + dz) && nl < l)) out = true;
      }
      if (out) { dist[z * W + x] = 0; q.push(z * W + x); }
    }
    for (let qi = 0; qi < q.length; qi++) {
      const c = q[qi];
      const x = c % W;
      const z = (c - x) / W;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = x + dx;
        const zz = z + dz;
        if (xx < 0 || zz < 0 || xx >= W || zz >= D) continue;
        const n = zz * W + xx;
        if (!wetC[n] || dist[n] >= 0 || lv[n] !== lv[c]) continue;
        dist[n] = dist[c] + 1;
        q.push(n);
      }
    }
    for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
      const c = z * W + x;
      if (!wetC[c] || dist[c] < 0) continue;
      let fx = 0;
      let fz = 0;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = x + dx;
        const zz = z + dz;
        if (xx < 0 || zz < 0 || xx >= W || zz >= D) { fx += dx; fz += dz; continue; }
        const n = zz * W + xx;
        const nl = lv[n];
        if (nl === 0 || (wetC[n] && nl < lv[c])) { fx += dx; fz += dz; }
        else if (wetC[n] && dist[n] >= 0 && dist[n] < dist[c]) { fx += dx; fz += dz; }
      }
      // ponds (lots of water around) barely move
      let around = 0;
      for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) if (WET(x + dx, z + dz)) around++;
      const speed = around >= 19 ? 0.15 : 1;
      const l = Math.hypot(fx, fz) || 1;
      flowC[c * 2] = (fx / l) * speed;
      flowC[c * 2 + 1] = (fz / l) * speed;
    }
  }
  const idx = (x: number, z: number) => clampI(Math.round((z + PAD) * RES), 0, nz) * S + clampI(Math.round((x + PAD) * RES), 0, nx);
  console.log(`designed map ${m.key}: ground worked out in ${Math.round(performance.now() - t0)} ms, ${falls.length} waterfalls`);

  return {
    map: m,
    falls,
    bridges,
    LH,
    /** height of the ground (water bed under water), smooth between the grid points */
    groundHeight(x: number, z: number): number {
      const u = clampI((x + PAD) * RES, 0, nx);
      const v = clampI((z + PAD) * RES, 0, nz);
      const i0 = Math.min(nx - 1, Math.floor(u));
      const j0 = Math.min(nz - 1, Math.floor(v));
      const fu = u - i0;
      const fv = v - j0;
      const k = j0 * S + i0;
      return h[k] * (1 - fu) * (1 - fv) + h[k + 1] * fu * (1 - fv) + h[k + S] * (1 - fu) * fv + h[k + S + 1] * fu * fv;
    },
    kindAt: (x: number, z: number): DKind => KINDS[kindS[idx(x, z)]],
    waterLevel: (x: number, z: number): number => levelW[idx(x, z)],
    pathMask: (x: number, z: number): number => pathW[idx(x, z)],
    flow(x: number, z: number): [number, number] {
      if (lvS[idx(x, z)] === 0) return [0.06, 0.03]; // the sea: a slow drift
      // blend the flow of the squares around, so the streaks turn smoothly with the stream
      let fx = 0;
      let fz = 0;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const cx = clampI(Math.floor(x) + dx, 0, W - 1);
        const cz = clampI(Math.floor(z) + dz, 0, D - 1);
        const w = dx === 0 && dz === 0 ? 2 : 1;
        fx += flowC[(cz * W + cx) * 2] * w;
        fz += flowC[(cz * W + cx) * 2 + 1] * w;
      }
      return [fx / 10, fz / 10];
    },
    bridgeAt(x: number, z: number): { b: DBridge; t: number; off: number } | null {
      for (const b of bridges) {
        const a = b.axis === 'z' ? z - b.z : x - b.x;
        const off = b.axis === 'z' ? x - b.x : z - b.z;
        if (Math.abs(a) < b.half + 0.3 && Math.abs(off) < b.width / 2 + 0.4) return { b, t: (a + b.half) / (2 * b.half), off };
      }
      return null;
    },
    onBoardwalk(x: number, z: number): boolean {
      for (const bw of m.boardwalks) if (polyDist(x, z, bw.points) < (bw.width || 1.0) / 2 + 0.05) return true;
      return false;
    },
    /** is this point on an open square of land (for placing things)? */
    stepRects: m.steps.map((s) => s.rect),
    nearStep(x: number, z: number, pad: number): boolean {
      return m.steps.some((s) => rectDist(x, z, s.rect) < pad);
    },
    isWater: (x: number, z: number) => wetS[idx(x, z)] === 1,
  };
}
export type DesignedWorld = ReturnType<typeof buildDesigned>;
