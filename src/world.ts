import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { fbm, rng } from './noise';
import { splitIntoChunks } from './chunks';
import { type DMapFile, type DesignedWorld, buildDesigned } from './designed';

// ---------------------------------------------------------------------------
// Sunny Meadow built from 3D tiles in the style of the painted tile art.
// The map is a grid of 1×1 cells. Each cell has a kind with its own level;
// where a cell is higher than its neighbour, a wall of rounded, mossy stones
// is stacked there (like the tile pieces), with grass hanging over the top.
// World units: 1 unit = one cell. x → screen right-down, z → screen left-down.
// ---------------------------------------------------------------------------

export const MAP_W = 90;
export const MAP_D = 56;
export const RES = 5; // ground samples per cell (cell edges fall exactly on samples)
export const PAD = 8; // extra ground around the play area (forest border)

export const HIGH = 3.4;
export const PLATEAU = 2.4;
export const TERRACE = 1.6;
export const MEADOW = 0.8;
export const BED = 0.0;
export const WATER = 0.45;
export const POOL_BED = 1.75;
export const POOL_WATER = 2.12;
const NO_WATER = -99;

/**
 * One of the six designed maps (?map=<key>), or null for Sunny Meadow. When set, the ground questions
 * below (height, kind, water, paths, bridges) are answered by designed.ts instead of the Sunny Meadow layout.
 */
export let designed: DesignedWorld | null = null;
export function useDesignedMap(m: DMapFile) {
  designed = buildDesigned(m, RES, PAD);
  FALLS.length = 0;
  FALLS.push(...designed.falls);
  // the water shader needs at least one waterfall: a harmless one far off the map
  if (!FALLS.length) FALLS.push({ dir: 'x', at: -60, a0: -60, a1: -59, top: 0, bottom: 0 });
  return designed;
}

// H back cliff above the upper pond (first waterfall)   P high cliff   o pool on the cliff   T raised paved terrace   M raised grassy mound   . meadow
// S stone steps going down toward +z (terrace → meadow). M is the orchard hill. The river is not on the grid: it winds
// along RIVER below, with curved stone banks.
const MAP = [
  'PPPPPPPPPPPPPPPPPPPPHHHHHHHHPPPPPP.......................PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP',
  'PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP.......................PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP',
  'PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP.......................PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP',
  'PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP...........................PPPPPPPPPPPPPPPPPPPPPPPPPPPPP',
  'PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP...........................MMMMMMMMMMMMMMMM.............',
  'PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP...........................MMMMMMMMMMMMMMMM.............',
  'PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP...........................MMMMMMMMMMMMMMMM.............',
  'PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP...........................MMMMMMMMMMMMMMMM.............',
  'PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP...........................MMMMMMMMMMMMMMMM.............',
  'PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP...................................S....................',
  'PPPPPPPPPPPPPPPPPPPPPPPPPPPPP.............................................................',
  'PPPPPPPPPPPPPPPPPPPPPPPPPPPPP.....................TTTTTT..................................',
  'PPPPPP........MMMMMMMMMMMMM.......................TTTTTT..................................',
  'PPPPPP........MMMMMMMMMMMMM.......................TTTTTT..................................',
  'PPPPPP........MMMMMMMMMMMMM.......................TTTTTT..................................',
  'PPPPPP........MMMMMMMMMMMMM.......................TTTTTT..................................',
  'PPPPPP........MMMMMMMMMMMMM.........................S.....................................',
  'PPPPPP........MMMMMMMMMMMMM...............................................................',
  'PPPPPP........MMMMMMMMMMMMM...............................................................',
  'PPPPPP........MMMMMMMMMMMMM...............................................................',
  'PPPPPP........MMMMMMMMMMMMM...............................................................',
  'PPPPPP........MMMMMMMMMMMMM...............................................................',
  'PPPPPP.................S..................................................................',
  'PPPPPP....................................................................................',
  'PPPPPP....................................................................................',
  'PPPPPP....................................................................................',
  'PPPPPP....................................................................................',
  'PPPPPP..............................................................MMMMMM................',
  'PPPPPP..............................................................MMMMMM................',
  'PPPPPP...........................................................MMMMMMMMMMM..............',
  'PPPPPP...........................................................MMMMMMMMMMM..............',
  'PPPPPP......................MMMMMMMM.............................MMMMMMMMMMM..............',
  'PPPPPP......................MMMMMMMM.............................MMMMMMMMMMM..............',
  'PPPPPP......................MMMMMMMM.............................MMMMMMMMMMM..............',
  'PPPPPP......................MMMMMMMM.............................MMMMMMMMMMM..............',
  'PPPPPP......................MMMMMMMM.............................MMMMMMMMMMM..............',
  '............................MMMMMMMM.............................MMMMMMMMMMM..............',
  '............................MMMMMMMM.................................S....................',
  '...............................S......MMMMMMMMMMM.........................................',
  '......................................MMMMMMMMMMM.........................................',
  '..........................................................................................',
  '..........................................................................................',
  '..........................................................................................',
  '..........................................................................................',
  '..........................................................................................',
  '..........................................................................................',
  '..........................................................................................',
  '..........................................................................................',
  '..........................................................................................',
  '..........................................................................................',
  '..........................................................................................',
  '..........................................................................................',
  '..........................................................................................',
  '..........................................................................................',
  '..........................................................................................',
  '..........................................................................................',
];

export type Kind = 'meadow' | 'terrace' | 'plateau' | 'high' | 'pool' | 'river' | 'stairs';

export function cellKind(cx: number, cz: number): Kind {
  const x = Math.max(0, Math.min(MAP_W - 1, cx));
  const z = Math.max(0, Math.min(MAP_D - 1, cz));
  switch (MAP[z][x]) {
    case 'H': return 'high';
    case 'P': return 'plateau';
    case 'o': return 'pool';
    case 'T': return 'terrace';
    case 'M': return 'terrace';
    case '~': return 'river';
    case 'S': return 'stairs';
    default: return 'meadow';
  }
}
type P2r = [number, number];
/** The first river's middle line, from the foot of the upper-pond waterfall into the lake. */
export const RIVER: P2r[] = [
  [34.6, 7.0], [37.5, 7.5], [39.6, 9.6], [40.3, 12.6], [41.8, 15.0], [44.5, 15.6], [47.2, 17.0], [48.0, 20.3],
  [47.2, 23.4], [46.6, 25.2], [46.6, 28.0], [46.8, 29.5],
];

/** A stream: middle line, half width, how fast it flows (1 = the river, small = a slow marsh channel). */
export interface Stream { pts: P2r[]; hw: number; speed: number; box: [number, number, number, number] }
function stream(pts: P2r[], hw: number, speed: number): Stream {
  const m = hw * 1.6 + 3; // points further than this from the line skip it (only near distances matter)
  const xs = pts.map((p) => p[0]);
  const zs = pts.map((p) => p[1]);
  return { pts, hw, speed, box: [Math.min(...xs) - m, Math.max(...xs) + m, Math.min(...zs) - m, Math.max(...zs) + m] };
}
/**
 * Built things that cross water or meet a path: [x, z, how far they hold the line still]. Bends fade out near them
 * so both ends of a boardwalk stay on dry land and a bridge always spans its river. (Bridges: same spots as BRIDGES.)
 */
const CROSSINGS: [number, number, number][] = [
  [23.1, 42.4, 1.2], [51.2, 43.2, 1.2], [68.0, 43.0, 1.2], [78.8, 42.5, 1.2], [36.0, 50.3, 1.2], [73.2, 51.5, 1.2], [78.4, 37.4, 1.6],
  [44.4, 15.55, 2.7], [46.6, 26.6, 2.7], [11.0, 31.9, 2.7], [61.5, 35.9, 2.7],
];
/**
 * Bend a channel's middle line into wandering loops (nature has no straight lines): points every ~1.4 units,
 * pushed sideways by slow noise, up to amp. The two ends and the boardwalk crossings stay where they are.
 */
function meander(pts: P2r[], amp: number, seed: number): P2r[] {
  const out: P2r[] = [];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) total += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
  let s = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(1, Math.ceil(len / 0.9));
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      const x = ax + (bx - ax) * t;
      const z = az + (bz - az) * t;
      const at = s + len * t;
      let a = amp * Math.min(1, at / 4, (total - at) / 4);
      for (const [cx, cz, hold] of CROSSINGS) a *= Math.min(1, Math.max(0, (Math.hypot(x - cx, z - cz) - hold) / 3.5));
      // big slow loops plus tighter bends every few units, so no stretch reads as a ruler line from the camera
      const off = ((fbm(at * 0.11, seed * 3.7, seed) - 0.5) * 5 + (fbm(at * 0.34, seed * 1.3 + 4, seed + 1) - 0.5) * 2.6) * a;
      out.push([x - ((bz - az) / len) * off, z + ((bx - ax) / len) * off]);
    }
    s += len;
  }
  out.push(pts[pts.length - 1]);
  return out;
}
export const STREAMS: Stream[] = [
  // RULE: every stream bends (meander); only the spots in CROSSINGS hold still
  stream(meander(RIVER, 0.75, 3), 1.05, 1),
  // west river: from the waterfall off the west cliff, under the west bridge, into the island pond
  stream(meander([[6.6, 26.0], [8.5, 26.8], [10.4, 28.4], [11.1, 30.6], [10.8, 33.0], [11.4, 35.2], [12.0, 37.0]], 0.6, 5), 0.8, 1),
  // the lake spills out at its east end, under a little bridge, down into the marsh
  stream(meander([[61.2, 33.0], [61.6, 35.5], [61.2, 38.2], [60.6, 41.5]], 0.5, 9), 0.75, 0.5),
  // the marsh: a wide slow channel in front of the old meadow, turning up the east side
  stream(meander([[13.5, 41.2], [19.0, 42.6], [26.0, 42.2], [32.0, 43.4], [39.0, 42.9], [46.0, 43.7], [53.0, 43.1], [60.0, 43.6],
    [66.0, 43.0], [72.0, 42.6], [77.0, 41.2], [80.6, 37.6], [81.8, 32.0], [82.6, 26.5], [84.4, 21.5]], 1.5, 7), 1.7, 0.25),
  // the outer channel joining the lotus pools along the front edge
  stream(meander([[5.0, 47.5], [15.5, 51.2], [27.0, 52.4], [38.5, 51.4], [50.0, 52.4], [62.0, 51.4], [73.0, 52.2], [82.5, 48.0], [85.0, 44.0]], 1.2, 11), 0.9, 0.15),
];

/** Still water, as overlapping ovals: the big lake, then the west island pond and the marsh's lotus pools. */
const LAKE: [number, number, number, number][] = [
  [47.5, 31.2, 5.6, 3.1], [54.0, 32.6, 6.6, 3.2], [59.6, 31.2, 3.4, 2.6], [43.0, 32.6, 2.6, 2.2],
];
const POOLS: [number, number, number, number][] = [
  [12.4, 39.2, 2.6, 2.0], // west island pond
  [5.0, 47.5, 4.4, 3.4], [15.5, 51.6, 4.6, 2.5], [27.0, 52.6, 4.2, 2.3], [38.5, 51.6, 5.0, 2.7], [50.0, 52.6, 5.2, 2.2],
  [62.0, 51.6, 4.8, 2.7], [73.0, 52.4, 4.2, 2.4], [83.0, 47.5, 3.4, 4.2], [85.0, 30.0, 2.6, 3.6], [84.6, 20.0, 2.4, 2.0],
];
const ISLANDS: [number, number, number][] = [
  [51.0, 33.0, 1.25], [57.6, 32.8, 0.95], // in the lake
  [12.2, 39.0, 0.8], [5.3, 47.8, 1.4], [38.8, 51.8, 1.2], [62.3, 51.8, 1.1], [83.3, 47.2, 1.2], [85.3, 29.8, 1.0], [32.0, 43.4, 0.9],
];
export const LAKE_ISLANDS = ISLANDS;
/** The marsh: the new land in front of (and east of) the old meadow. */
export function inMarsh(x: number, z: number): boolean {
  return z > 40.5 || (x > 78.5 && z > 17);
}
function ovalSD(x: number, z: number, cx: number, cz: number, rx: number, rz: number): number {
  const k = Math.hypot((x - cx) / rx, (z - cz) / rz);
  return (k - 1) * Math.min(rx, rz);
}
/**
 * LOAD SPEED helper: for each 1×1 square around the map, which of n shapes can matter there, so the
 * millions of look-ups while the map is built only check those. at(i, x, z) = shape i's distance
 * at the square's middle; keep(v, smallest) decides from that. Squares outside = check every shape.
 */
const LIST_PAD = 14;
interface CellLists { start: Int32Array; items: Int16Array; w: number; d: number }
function cellLists(n: number, at: (i: number, x: number, z: number) => number, keep: (v: number, smallest: number) => boolean): CellLists {
  const w = MAP_W + LIST_PAD * 2;
  const d = MAP_D + LIST_PAD * 2;
  const start = new Int32Array(w * d + 1);
  const items: number[] = [];
  const vs = new Float64Array(n);
  for (let cz = 0; cz < d; cz++) {
    for (let cx = 0; cx < w; cx++) {
      start[cz * w + cx] = items.length;
      let m = 1e9;
      for (let i = 0; i < n; i++) {
        vs[i] = at(i, cx - LIST_PAD + 0.5, cz - LIST_PAD + 0.5);
        if (vs[i] < m) m = vs[i];
      }
      for (let i = 0; i < n; i++) if (keep(vs[i], m)) items.push(i);
    }
  }
  start[w * d] = items.length;
  return { start, items: Int16Array.from(items), w, d };
}
/** Which square of cellLists a point is in, or -1 outside them. */
function listCell(l: CellLists, x: number, z: number): number {
  const cx = Math.floor(x) + LIST_PAD;
  const cz = Math.floor(z) + LIST_PAD;
  return cx >= 0 && cz >= 0 && cx < l.w && cz < l.d ? cz * l.w + cx : -1;
}
const STILL = [...LAKE, ...POOLS];
let stillLists: CellLists | null = null;
/** Signed distance to the shore of still water (lake and pools): negative in the water. */
function lakeSD(x: number, z: number): number {
  let d = 1e9;
  // an oval's distance changes at most 1 per unit moved, and every point of a square is within √2/2
  // of its middle: an oval more than √2 behind the nearest one at the middle can never be nearest
  stillLists ??= cellLists(STILL.length, (i, px, pz) => ovalSD(px, pz, ...STILL[i]), (v, m) => v <= m + Math.SQRT2 + 1e-6);
  const cell = listCell(stillLists, x, z);
  if (cell >= 0) {
    for (let k = stillLists.start[cell], end = stillLists.start[cell + 1]; k < end; k++) {
      const [cx, cz, rx, rz] = STILL[stillLists.items[k]];
      d = Math.min(d, ovalSD(x, z, cx, cz, rx, rz));
    }
  } else {
    for (const [cx, cz, rx, rz] of STILL) d = Math.min(d, ovalSD(x, z, cx, cz, rx, rz));
  }
  if (d > 4) return d;
  d += (fbm(x * 0.35, z * 0.35, 51) - 0.5) * 1.1 + (fbm(x * 0.9, z * 0.9, 53) - 0.5) * 0.5;
  for (const [cx, cz, r] of ISLANDS) d = Math.max(d, r - Math.hypot(x - cx, z - cz));
  return d;
}
export function inLake(x: number, z: number): boolean {
  return lakeSD(x, z) < 0;
}
/**
 * LOAD SPEED: the ground asks "how far is the nearest stream?" a few million times while the map is built.
 * The marsh channels have ~60 bends each, so checking every bend every time took seconds on the tablet.
 * Instead, each stream keeps a list per 1×1 square of the only bends that can be nearest to any point
 * in that square (a bend further than the closest one + the square's width can never win). Same answers.
 */
interface SegIndex { x0: number; z0: number; w: number; start: Int32Array; segs: Int16Array }
const segIndexes: SegIndex[] = [];
function streamSegs(si: number): SegIndex {
  const found = segIndexes[si];
  if (found) return found;
  const s = STREAMS[si];
  const x0 = Math.floor(s.box[0]);
  const z0 = Math.floor(s.box[2]);
  const w = Math.floor(s.box[1]) - x0 + 1;
  const d = Math.floor(s.box[3]) - z0 + 1;
  const start = new Int32Array(w * d + 1);
  const segs: number[] = [];
  const n = s.pts.length - 1;
  const ds = new Float64Array(n);
  for (let cz = 0; cz < d; cz++) {
    for (let cx = 0; cx < w; cx++) {
      const px = x0 + cx + 0.5;
      const pz = z0 + cz + 0.5;
      let m = 1e9;
      for (let i = 0; i < n; i++) {
        ds[i] = segDist(px, pz, s.pts[i], s.pts[i + 1]);
        if (ds[i] < m) m = ds[i];
      }
      start[cz * w + cx] = segs.length;
      // every point of the square is within √2/2 of its middle
      for (let i = 0; i < n; i++) if (ds[i] <= m + Math.SQRT2 + 1e-6) segs.push(i);
    }
  }
  start[w * d] = segs.length;
  return (segIndexes[si] = { x0, z0, w, start, segs: Int16Array.from(segs) });
}
const riverOut = { d: 1e9, hw: 1, dir: [1, 0] as P2r, speed: 0 };
/** Nearest stream at a point. The answer object is reused: read it straight away. */
function riverInfo(x: number, z: number): { d: number; hw: number; dir: P2r; speed: number } {
  let best = 1e9;
  let bestD = 1e9;
  let bestHw = 1;
  let bestSpeed = 0;
  let bestS = -1;
  let bestSeg = 0;
  // the width wobble is the same for every stream: worked out once, and only when a stream is near
  let nA = NaN;
  let nB = NaN;
  for (let si = 0; si < STREAMS.length; si++) {
    const s = STREAMS[si];
    const [x0, x1, z0, z1] = s.box;
    if (x < x0 || x > x1 || z < z0 || z > z1) continue;
    const ix = streamSegs(si);
    const cell = (Math.floor(z) - ix.z0) * ix.w + (Math.floor(x) - ix.x0);
    let d = 1e9;
    let seg = 0;
    for (let k = ix.start[cell], end = ix.start[cell + 1]; k < end; k++) {
      const i = ix.segs[k];
      const [ax, az] = s.pts[i];
      const [bx, bz] = s.pts[i + 1];
      const dx = bx - ax;
      const dz = bz - az;
      const l2 = dx * dx + dz * dz;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
      const di = Math.hypot(ax + dx * t - x, az + dz * t - z);
      if (di < d) {
        d = di;
        seg = i;
      }
    }
    if (nA !== nA) {
      nA = fbm(x * 0.22, z * 0.22, 21);
      nB = fbm(x * 0.7, z * 0.7, 23);
    }
    // the width wanders: slow big changes plus smaller wiggles (wide marsh channels wiggle more)
    const hw = s.hw * (1 + (nA - 0.5) * 0.7) + (nB - 0.5) * 0.4 * s.hw;
    if (d - hw < best) {
      best = d - hw;
      bestD = d;
      bestHw = hw;
      bestSpeed = s.speed;
      bestS = si;
      bestSeg = seg;
    }
  }
  riverOut.d = bestD;
  riverOut.hw = bestHw;
  riverOut.speed = bestSpeed;
  if (bestS < 0) riverOut.dir = [1, 0];
  else {
    const p = STREAMS[bestS].pts;
    const dx = p[bestSeg + 1][0] - p[bestSeg][0];
    const dz = p[bestSeg + 1][1] - p[bestSeg][1];
    const l = Math.sqrt(dx * dx + dz * dz);
    riverOut.dir = [dx / l, dz / l];
  }
  return riverOut;
}
/** Signed distance to the nearest bank (streams, lake, pools): negative in the water. */
let wsdX = NaN;
let wsdZ = NaN;
let wsdV = 0;
function waterSD(x: number, z: number): number {
  // the same point is often asked twice in a row (its kind, then its height): remember the last answer
  if (x === wsdX && z === wsdZ) return wsdV;
  const r = riverInfo(x, z);
  wsdV = Math.min(r.d - r.hw, lakeSD(x, z));
  // ONE RULE: an island is always dry land, even where a stream runs through its pool (the lotus-pool channel
  // used to wash islands away, so a boardwalk out to one ended in open water)
  if (wsdV < 0) for (const [cx, cz, ir] of ISLANDS) wsdV = Math.max(wsdV, ir - Math.hypot(x - cx, z - cz));
  wsdX = x;
  wsdZ = z;
  return wsdV;
}
/**
 * The kind of ground at a point, with the grid edges pushed around by noise so hills and cliffs
 * have natural, wandering outlines instead of ruler-straight tile edges. Steps, the paved plaza,
 * the pools and the waterfall lips stay on the grid (they are built pieces).
 */
// RULE: nature has no straight lines. Cliffs, hills, ponds, rivers and banks all get wandering
// outlines. Only built things stay straight: stone steps, the paved plaza, and the short lip
// where a painted waterfall picture sits (the picture covers that edge).

/** Built places the ground must line up with: [x0, x1, z0, z1]. Worked out once, on first use. */
let builtRects: [number, number, number, number][] | null = null;
function getBuiltRects(): [number, number, number, number][] {
  if (builtRects) return builtRects;
  const r: [number, number, number, number][] = [];
  for (let cz = 0; cz < MAP_D; cz++) {
    for (let cx = 0; cx < MAP_W; cx++) {
      const c = MAP[cz][cx];
      if (c === 'S') r.push([cx - 0.15, cx + 1.15, cz - 0.15, cz + 1.15]);
      if (c === 'T') r.push([cx, cx + 1, cz, cz + 1]);
    }
  }
  for (const f of FALLS) {
    const a0 = f.a0 - 0.35;
    const a1 = f.a1 + 0.35;
    if (f.dir === 'x') r.push([f.at - 0.6, f.at + 0.6, a0, a1]);
    else r.push([a0, a1, f.at - 0.6, f.at + 0.6]);
  }
  builtRects = r;
  return r;
}
/**
 * How much the natural wobble applies at a point: 0 right at a built place, 1 from 2.2 units away.
 * LOAD SPEED: each 1×1 square keeps a list of only the built places within 2.2 of it (any other is
 * too far to matter), instead of measuring to all of them at every one of millions of points.
 */
const FADE_FAR = 2.2;
const BUILT_PAD = 14; // squares around the map covered by the lists (further out = check them all)
let builtLists: { start: Int32Array; items: Int16Array; w: number } | null = null;
function builtFade(x: number, z: number): number {
  const rects = getBuiltRects();
  if (!builtLists) {
    const w = MAP_W + BUILT_PAD * 2;
    const d = MAP_D + BUILT_PAD * 2;
    const start = new Int32Array(w * d + 1);
    const items: number[] = [];
    for (let cz = 0; cz < d; cz++) {
      for (let cx = 0; cx < w; cx++) {
        start[cz * w + cx] = items.length;
        const sx = cx - BUILT_PAD;
        const sz = cz - BUILT_PAD;
        rects.forEach(([x0, x1, z0, z1], i) => {
          const dx = Math.max(x0 - (sx + 1), 0, sx - x1);
          const dz = Math.max(z0 - (sz + 1), 0, sz - z1);
          if (Math.hypot(dx, dz) <= FADE_FAR + 1e-6) items.push(i);
        });
      }
    }
    start[w * d] = items.length;
    builtLists = { start, items: Int16Array.from(items), w };
  }
  const cx = Math.floor(x) + BUILT_PAD;
  const cz = Math.floor(z) + BUILT_PAD;
  let d = 1e9;
  if (cx >= 0 && cz >= 0 && cx < builtLists.w && cz < MAP_D + BUILT_PAD * 2) {
    const cell = cz * builtLists.w + cx;
    for (let k = builtLists.start[cell], end = builtLists.start[cell + 1]; k < end; k++) {
      const [x0, x1, z0, z1] = rects[builtLists.items[k]];
      const dx = Math.max(x0 - x, 0, x - x1);
      const dz = Math.max(z0 - z, 0, z - z1);
      d = Math.min(d, Math.hypot(dx, dz));
    }
  } else {
    for (const [x0, x1, z0, z1] of rects) {
      const dx = Math.max(x0 - x, 0, x - x1);
      const dz = Math.max(z0 - z, 0, z - z1);
      d = Math.min(d, Math.hypot(dx, dz));
    }
  }
  return smoothstepN(0.2, FADE_FAR, d);
}

/** The upper pond on the high cliff: a few overlapping ovals with a wobbly shore. Negative = water. */
const POND: [number, number, number, number][] = [
  [26.0, 4.6, 4.6, 2.6], // main pool
  [23.2, 2.5, 2.0, 1.6], // bay under the back-cliff waterfall
  [31.4, 6.95, 2.9, 1.15], // outlet toward the lower waterfall
  [21.7, 5.6, 1.5, 1.2], // small west bay
  [3.2, 26.0, 2.4, 2.2], // pool on the west cliff
  [5.0, 26.0, 1.3, 0.9], // its outlet to the west waterfall
];
function pondSD(x: number, z: number): number {
  // the two waterfall lips: the water must reach the edge exactly there
  // the waterfall lips: the water must reach the edge exactly there (behind a fall that drains a pool,
  // and under a fall that pours into one)
  for (const f of FALLS) {
    const along = f.dir === 'x' ? z : x;
    const across = f.dir === 'x' ? x : z;
    if (along <= f.a0 || along >= f.a1) continue;
    if (f.top === POOL_WATER && across > f.at - 1.4 && across < f.at) return -0.5;
    if (f.bottom > POOL_BED && across > f.at && across < f.at + 1.4) return -0.5;
  }
  let d = 1e9;
  for (const [cx, cz, rx, rz] of POND) d = Math.min(d, ovalSD(x, z, cx, cz, rx, rz));
  return d + (fbm(x * 0.45, z * 0.45, 55) - 0.5) * 1.6 + (fbm(x * 1.3, z * 1.3, 56) - 0.5) * 0.4;
}

let wkX = NaN;
let wkZ = NaN;
let wkV: Kind = 'meadow';
function warpedKind(x: number, z: number): Kind {
  // the same point is often asked twice in a row (its kind, then its height): remember the last answer
  if (x === wkX && z === wkZ) return wkV;
  wkV = warpedKindNew(x, z);
  wkX = x;
  wkZ = z;
  return wkV;
}
function warpedKindNew(x: number, z: number): Kind {
  const cx = Math.floor(x);
  const cz = Math.floor(z);
  const k = cellKind(cx, cz);
  if (k === 'stairs') return k;
  // push the grid edges around: big slow bends, medium wiggles and a little fine ragged edge.
  // The push fades out near built places so they still line up.
  const w = builtFade(x, z);
  const wx = x + ((fbm(x * 0.3, z * 0.3, 61) - 0.5) * 3.2 + (fbm(x * 0.9, z * 0.9, 63) - 0.5) * 1.2 + (fbm(x * 2.3, z * 2.3, 65) - 0.5) * 0.35) * w;
  const wz = z + ((fbm(x * 0.3 + 17, z * 0.3, 62) - 0.5) * 3.2 + (fbm(x * 0.9, z * 0.9 + 9, 64) - 0.5) * 1.2 + (fbm(x * 2.3 + 5, z * 2.3, 66) - 0.5) * 0.35) * w;
  let k2 = cellKind(Math.floor(wx), Math.floor(wz));
  if (k2 === 'stairs') k2 = k;
  if ((k2 === 'plateau' || k2 === 'high') && pondSD(x, z) < 0) return 'pool';
  return k2;
}
function smoothstepN(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
function gridKind(x: number, z: number): Kind {
  return warpedKind(x, z);
}
export const kindAt = (x: number, z: number): Kind => {
  if (designed) return designed.kindAt(x, z);
  const k = gridKind(x, z);
  if (k !== 'meadow') return k;
  return waterSD(x, z) < 0 ? 'river' : 'meadow';
};
/** The raised terrace is paved with stone (the house plot); the mound stays grassy. */
export function isPlaza(x: number, z: number): boolean {
  if (designed) return false;
  const cx = Math.max(0, Math.min(MAP_W - 1, Math.floor(x)));
  const cz = Math.max(0, Math.min(MAP_D - 1, Math.floor(z)));
  return MAP[cz][cx] === 'T';
}
export const isWet = (k: Kind) => k === 'river' || k === 'pool';

/** Floor height of a cell kind (stairs: their top). */
function kindHeight(k: Kind): number {
  switch (k) {
    case 'high': return HIGH;
    case 'plateau': return PLATEAU;
    case 'pool': return POOL_BED;
    case 'terrace': return TERRACE;
    case 'stairs': return TERRACE;
    case 'river': return BED;
    default: return MEADOW;
  }
}

/** Height of the walkable surface at a point. */
export function groundHeight(x: number, z: number): number {
  if (designed) return designed.groundHeight(x, z);
  const cz = Math.floor(z);
  const k = warpedKind(x, z);
  if (k === 'meadow') {
    // meadow, with the river cut into it: steep stone banks that follow the curve
    const wob = (fbm(x * 1.2, z * 1.2, 4) - 0.5) * 0.14;
    const bank = Math.max(0, Math.min(1, (waterSD(x, z) + wob + 0.1) / 0.24));
    const n = fbm(x * 0.5, z * 0.5, 2);
    const top = MEADOW + (n - 0.5) * 0.03;
    const bed = BED + (n - 0.5) * 0.2;
    return bed + (top - bed) * (bank * bank * (3 - 2 * bank));
  }
  if (k === 'stairs') {
    // four steps from the terrace down to the meadow
    const step = Math.min(3, Math.floor(Math.max(0, z - cz) * 4));
    return TERRACE - ((TERRACE - MEADOW) * (step + 1)) / 4 + 0.02;
  }
  const wet = isWet(k);
  return kindHeight(k) + (fbm(x * 0.5, z * 0.5, 2) - 0.5) * (wet ? 0.2 : 0.03);
}

/** Water surface covering this point, or NO_WATER. */
export function waterLevel(x: number, z: number): number {
  if (designed) return designed.waterLevel(x, z);
  const k = warpedKind(x, z);
  if (k === 'pool' || k === 'plateau' || k === 'high') return POOL_WATER;
  // the pond's water runs right up to the lip of the waterfall
  for (const f of FALLS) {
    if (f.top !== POOL_WATER || f.dir !== 'x') continue;
    if (x >= f.at && x < f.at + 0.45 && z > f.a0 - 0.1 && z < f.a1 + 0.1) return POOL_WATER;
  }
  return waterSD(x, z) < 0.7 ? WATER : NO_WATER;
}

/** Distance from a point to the river bank (0 inside the river). */
export function riverDistance(x: number, z: number): number {
  return Math.max(0, waterSD(x, z));
}

/** Downstream direction of the river. */
export function riverFlow(x: number, z: number): [number, number] {
  if (designed) return designed.flow(x, z);
  const r = riverInfo(x, z);
  // the lake and pools are nearly still: a slow drift, fading out away from where a stream comes in
  if (r.d > r.hw + 0.5 && lakeSD(x, z) < 0.7) return [r.dir[0] * 0.12, r.dir[1] * 0.12];
  return [r.dir[0] * r.speed, r.dir[1] * r.speed];
}

// ---------------------------------------------------------------------------
// Paths, garden, bridge, landmarks
// ---------------------------------------------------------------------------

type P2 = [number, number];

/** Wooden bridges. axis = the direction you walk across (the river runs the other way). */
export interface Bridge { x: number; z: number; axis: 'x' | 'z'; half: number; deck: number; arc: number }
export const BRIDGES: Bridge[] = [
  { x: 44.4, z: 15.55, axis: 'z', half: 1.95, deck: MEADOW + 0.05, arc: 0.22 },
  { x: 46.6, z: 26.6, axis: 'x', half: 1.95, deck: MEADOW + 0.05, arc: 0.22 },
  { x: 11.0, z: 31.9, axis: 'x', half: 1.95, deck: MEADOW + 0.05, arc: 0.22 }, // west river
  { x: 61.5, z: 35.9, axis: 'x', half: 1.95, deck: MEADOW + 0.05, arc: 0.22 }, // lake outflow
];
/** Where along a bridge a point is: t 0..1 end to end, off = sideways distance. */
export function bridgeAt(x: number, z: number): { b: Bridge; t: number; off: number } | null {
  if (designed) return designed.bridgeAt(x, z);
  for (const b of BRIDGES) {
    const a = b.axis === 'z' ? z - b.z : x - b.x;
    const off = b.axis === 'z' ? x - b.x : z - b.z;
    if (Math.abs(a) < b.half + 0.3) return { b, t: (a + b.half) / (2 * b.half), off };
  }
  return null;
}
export const GARDEN = { x0: 55.6, x1: 61.4, z0: 17.6, z1: 21.4 };
/** Garden: two rows of four beds with a walkway between them, gates at both ends of the walkway. */
export const BED_HALF = 0.52;
export const GARDEN_WALK_Z = 19.5;
export const GARDEN_GATE = { z0: 18.7, z1: 20.3 }; // wide enough for Mochi on the half-unit walking grid
export const GARDEN_BEDS: { x: number; z: number }[] = [18.3, 20.7].flatMap((z) => [56.47, 57.82, 59.17, 60.52].map((x) => ({ x, z })));
export const PLOT = { x: 52.5, z: 13.0 }; // empty paved terrace, kept for a house later
export const SPRING = { x: 53.2, z: 21.6 };
export const ORCHARD = { x0: 14.6, x1: 26.4, z0: 12.4, z1: 21.6 };
/** Waterfalls: the water drops over an edge running along z (dir 'x', falls toward +x) or along x (dir 'z'). */
export interface Fall { dir: 'x' | 'z'; at: number; a0: number; a1: number; top: number; bottom: number }
export const FALLS: Fall[] = [
  { dir: 'x', at: 34.0, a0: 6.04, a1: 7.96, top: POOL_WATER, bottom: WATER - 0.05 }, // upper pond → river
  { dir: 'z', at: 1.0, a0: 22.1, a1: 23.9, top: HIGH, bottom: POOL_WATER - 0.03 }, // back cliff → upper pond
  { dir: 'x', at: 6.0, a0: 25.2, a1: 26.8, top: POOL_WATER, bottom: WATER - 0.05 }, // west cliff pool → west river
];
export const FALL = { x: FALLS[0].at, z0: FALLS[0].a0, z1: FALLS[0].a1 };

/**
 * RULE (nature has no straight lines) for paths: corners are rounded off and long straight pieces wander a
 * little from side to side. The two ends stay exactly where they are (they meet steps, bridges, boardwalks, gates).
 */
function wander(p: P2[], seed: number): P2[] {
  let q = p;
  for (let it = 0; it < 2; it++) {
    const r: P2[] = [q[0]];
    for (let k = 0; k < q.length - 1; k++) {
      const [ax, az] = q[k];
      const [bx, bz] = q[k + 1];
      r.push([ax * 0.75 + bx * 0.25, az * 0.75 + bz * 0.25], [ax * 0.25 + bx * 0.75, az * 0.25 + bz * 0.75]);
    }
    r.push(q[q.length - 1]);
    q = r;
  }
  return meander(q, 0.3, 30 + seed);
}
export const PATHS: P2[][] = ([
  // orchard steps → east through the woods → first bridge (south end)
  [[23.5, 23.1], [26.5, 23.4], [30.5, 22.6], [35.5, 21.0], [39.5, 19.3], [42.4, 18.2], [44.4, 17.6]],
  // first bridge (north end) → north to the stone arch at the forest edge
  [[44.4, 13.5], [45.2, 11.2], [46.6, 8.4], [47.4, 5.4], [47.3, 2.4]],
  // branch west to the cave under the high cliff
  [[46.2, 9.3], [42.5, 5.4], [38.6, 4.2], [35.4, 3.6]],
  // first bridge → the plaza steps → east to the house plots
  [[44.4, 13.5], [47.4, 13.4], [49.2, 16.6], [52.5, 17.3], [55.5, 16.4], [60.5, 15.6], [65.5, 13.8], [70.5, 12.0], [76.0, 11.2]],
  // plaza steps → hot spring
  [[52.5, 17.3], [52.8, 19.2], [53.4, 23.6]],
  // spring path → through the garden (the walkway between the beds, gate to gate) → the east meadow
  [[52.85, 19.5], [62.6, 19.5]],
  // orchard path → second bridge (west end)
  [[30.5, 22.6], [33.2, 25.3], [37.5, 26.6], [41.4, 26.8], [44.6, 26.6]],
  // second bridge (east end) → hot spring → east meadow → north to the plots
  [[48.6, 26.6], [51.3, 25.4], [53.4, 23.6], [57.5, 24.2], [62.5, 23.8], [67.0, 21.2], [70.0, 17.0], [70.5, 12.0]],
  // around the lake: east shore, over the outflow bridge, south shore, west shore back to the second bridge path
  [[57.5, 24.2], [62.0, 27.2], [64.3, 30.8], [63.9, 34.4], [63.5, 35.9], [59.5, 35.9], [57.0, 37.4], [50.0, 37.6], [43.5, 36.6], [39.3, 34.0], [38.6, 30.0], [39.6, 27.0]],
  // south-west meadow
  [[26.5, 23.4], [24.0, 27.5], [22.6, 32.5], [23.5, 38.0]],
  // up the steps to the raised meadow under the north-east ridge
  [[70.5, 12.0], [69.5, 10.6], [69.5, 8.4], [69.2, 6.0]],
  // lake path → steps up the south-east lookout hill
  [[63.5, 35.9], [66.5, 38.3], [69.5, 38.4], [69.5, 36.4], [70.2, 32.5]],
  // south-west path → steps up the little wooded hill
  [[23.0, 34.5], [27.5, 38.9], [31.5, 39.0], [31.5, 37.2], [31.8, 34.5]],
  // --- the new land ---
  // orchard steps → west to the west bridge, and over it to the foot of the west waterfall
  [[23.5, 23.1], [19.5, 24.8], [15.5, 28.0], [13.0, 31.8]],
  [[9.0, 31.8], [7.8, 30.4], [7.6, 28.8]],
  // down to the three marsh boardwalks (south-west meadow, south shore of the lake, south-east hill)
  [[23.5, 38.0], [23.2, 40.0]],
  [[50.0, 37.6], [51.0, 40.0]],
  [[66.5, 38.3], [67.8, 40.0]],
  // along the strip of land in the middle of the marsh
  [[9.5, 44.0], [14.0, 46.4], [19.0, 47.0], [23.4, 46.0], [28.0, 46.8], [34.0, 47.6], [40.0, 46.8], [45.0, 47.6], [51.5, 46.4],
    [57.0, 47.6], [62.0, 47.0], [68.2, 46.2], [73.0, 47.4], [77.5, 46.2]],
  // east edge: from the house plots path down past the lotus pools to the east boardwalk
  [[76.0, 11.2], [79.5, 13.5], [81.0, 17.0], [80.0, 20.5], [79.4, 25.0], [79.0, 30.0], [78.4, 35.0], [78.4, 36.6]],
] as P2[][]).map((p, i) => (p.length >= 3 ? wander(p, i) : p));

/** Wooden boardwalks over the marsh (built in 3D, walkable): middle lines. */
export const BOARDWALKS: P2[][] = [
  [[23.2, 40.0], [23.0, 42.4], [23.4, 46.0]],
  [[51.0, 40.0], [51.2, 43.2], [51.5, 46.4]],
  [[67.8, 40.0], [68.0, 43.0], [68.2, 46.2]],
  [[77.5, 46.2], [79.0, 44.2], [78.6, 41.0], [78.4, 38.6], [78.4, 36.6]],
  // out to the island in a lotus pool, and a zig-zag over the east pool
  [[34.0, 47.6], [34.6, 50.0], [38.0, 51.1]], // ends on the island at 38.8, 51.8
  [[73.0, 47.4], [72.2, 50.2], [74.6, 51.0], [74.4, 54.9]], // reaches the south shore
];
export const BOARD_Y = MEADOW + 0.1; // deck height
export const BOARD_HALF = 0.5; // half the deck's width
/** On a boardwalk deck? (a little wider than the deck, so the walking grid always has a joined-up line of squares) */
export function onBoardwalk(x: number, z: number): boolean {
  if (designed) return designed.onBoardwalk(x, z);
  for (const b of BOARDWALKS) if (lineDist(x, z, b).d < BOARD_HALF + 0.05) return true;
  return false;
}

function segDist(px: number, pz: number, a: P2, b: P2): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len2 = dx * dx + dz * dz;
  let t = ((px - a[0]) * dx + (pz - a[1]) * dz) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(a[0] + dx * t - px, a[1] + dz * t - pz);
}
export function lineDist(px: number, pz: number, line: P2[]): { d: number } {
  let d = 1e9;
  for (let i = 0; i < line.length - 1; i++) d = Math.min(d, segDist(px, pz, line[i], line[i + 1]));
  return { d };
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Every path piece, for the per-square lists below. */
const PATH_SEGS: [P2, P2][] = PATHS.flatMap((p) => p.slice(0, -1).map((a, i): [P2, P2] => [a, p[i + 1]]));
let pathLists: CellLists | null = null;
export function pathMask(x: number, z: number): number {
  if (designed) return designed.pathMask(x, z);
  let d = 1e9;
  // only pieces within 0.9 of a square matter there: further away the mask below is 0 whatever the wobble
  pathLists ??= cellLists(PATH_SEGS.length, (i, px, pz) => segDist(px, pz, PATH_SEGS[i][0], PATH_SEGS[i][1]), (v) => v <= 0.9 + Math.SQRT1_2 + 1e-6);
  const cell = listCell(pathLists, x, z);
  if (cell >= 0) {
    for (let k = pathLists.start[cell], end = pathLists.start[cell + 1]; k < end; k++) {
      const [a, b] = PATH_SEGS[pathLists.items[k]];
      d = Math.min(d, segDist(x, z, a, b));
    }
  } else {
    for (const p of PATHS) d = Math.min(d, lineDist(x, z, p).d);
  }
  const wob = (fbm(x * 1.6, z * 1.6, 40) - 0.5) * 0.26;
  return 1 - smoothstep(0.5, 0.68, d + wob);
}

// ---------------------------------------------------------------------------
// Ground mesh (the flat tops of every tile; the steep bits between levels are
// hidden behind stone walls, so they are painted as dark gaps)
// ---------------------------------------------------------------------------

const C = (hex: number) => new THREE.Color(hex);
const GRASS_A = C(0x9cc449);
const GRASS_B = C(0x72a83a);
const GRASS_WARM = C(0xb6ca58);
const PATH_A = C(0xe0b173);
const PATH_EDGE = C(0xc79258);
const SOIL = C(0x6e4a30);
const BED_C = C(0x8d8672);

export interface GroundData {
  /** the ground, cut into tiles (only tiles on screen are drawn) */
  mesh: THREE.Group;
  material: THREE.ShaderMaterial;
  heights: Float32Array; // (nx+1)*(nz+1)
  nx: number;
  nz: number;
  /** per ground point, worked out while building (the mini-map reuses them): kind, path weight, paving */
  kinds: Kind[];
  path: Float32Array;
  pave: Float32Array;
}

export interface GroundTextures {
  grass: THREE.Texture;
  /** world units per repeat of the grass picture */
  grassScale: number;
  path: THREE.Texture;
  soil: THREE.Texture;
  stone: THREE.Texture;
  riverbed: THREE.Texture;
  paving: THREE.Texture;
  lip: THREE.Texture;
}

export function buildGround(noiseTex: THREE.Texture, sunDir: THREE.Vector3, tex: GroundTextures): GroundData {
  const nx = (MAP_W + PAD * 2) * RES;
  const nz = (MAP_D + PAD * 2) * RES;
  const count = (nx + 1) * (nz + 1);
  const pos = new Float32Array(count * 3);
  const mats = new Float32Array(count * 4); // grass, path, soil, riverbed weights
  const pave = new Float32Array(count); // stone paving weight
  const aoAttr = new Float32Array(count);
  const tint = new Float32Array(count * 3); // big soft grass patches, worked out once here instead of every frame
  const topAttr = new Float32Array(count);
  const heights = new Float32Array(count);

  // kind worked out right after the height of the same point: the slow part is shared (see warpedKind)
  const kinds: Kind[] = new Array(count);
  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      heights[j * (nx + 1) + i] = groundHeight(i / RES - PAD, j / RES - PAD);
      kinds[j * (nx + 1) + i] = kindAt(i / RES - PAD, j / RES - PAD);
    }
  }
  const hAt = (i: number, j: number) => heights[Math.max(0, Math.min(nz, j)) * (nx + 1) + Math.max(0, Math.min(nx, i))];

  // Designed maps: the top of the wall above every point, found by carrying each cliff's top edge down its face
  // (highest points first; only down from points that are themselves on a wall, so a flat ledge between two
  // cliffs starts the lower cliff afresh). The rock picture is hung from this, so long sloping walls show whole
  // stones instead of streaks.
  let wallTop: Float32Array | null = null;
  if (designed) {
    const W1 = nx + 1;
    const steepV = new Uint8Array(count);
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
      const g = Math.hypot(hAt(i + 1, j) - hAt(i - 1, j), hAt(i, j + 1) - hAt(i, j - 1)) * RES / 2;
      steepV[j * W1 + i] = g > 1.2 ? 1 : 0;
    }
    wallTop = new Float32Array(heights);
    const order = new Uint32Array(count);
    for (let k = 0; k < count; k++) order[k] = k;
    order.sort((a, b) => heights[b] - heights[a]);
    for (let q = 0; q < count; q++) {
      const k = order[q];
      const i = k % W1;
      const j = (k - i) / W1;
      let t = wallTop[k];
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ii = i + di;
        const jj = j + dj;
        if (ii < 0 || jj < 0 || ii > nx || jj > nz) continue;
        const n = jj * W1 + ii;
        if (steepV[n] && heights[n] > heights[k] + 0.01 && wallTop[n] > t) t = wallTop[n];
      }
      wallTop[k] = t;
    }
  }

  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      const k = j * (nx + 1) + i;
      const x = i / RES - PAD;
      const z = j / RES - PAD;
      const h = heights[k];
      let top = h;
      let low = h;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const v = hAt(i + di, j + dj);
        top = Math.max(top, v);
        low = Math.min(low, v);
      }
      if (wallTop) top = Math.max(top, wallTop[k]);
      // cliff vertices nudged sideways a little so walls are not ruler-flat
      const cliff = top - low > 0.3 ? 1 : 0;
      pos[k * 3] = x + cliff * (fbm(x * 1.7, z * 1.7 + h, 31) - 0.5) * 0.12;
      pos[k * 3 + 1] = h;
      pos[k * 3 + 2] = z + cliff * (fbm(x * 1.7 + 9, z * 1.7 + h, 32) - 0.5) * 0.12;
      topAttr[k] = top;

      let sum = 0;
      const R = 4;
      for (const [di, dj] of [[R, 0], [-R, 0], [0, R], [0, -R], [R, R], [-R, -R], [R, -R], [-R, R]]) sum += hAt(i + di, j + dj);
      aoAttr[k] = Math.max(0.62, Math.min(1.04, 1 - (sum / 8 - h) * 0.38));

      // grass patches: cool deep green ↔ sunny green, with warm yellow-green spots
      const n1 = smoothstep(0.32, 0.68, fbm(x * 0.09, z * 0.09, 201));
      const n2 = smoothstep(0.56, 0.78, fbm(x * 0.17 + 3, z * 0.17, 202)) * 0.7;
      let tr = 0.8 + (1.07 - 0.8) * n1;
      let tg = 0.9 + (1.04 - 0.9) * n1;
      let tb = 1.0 + (0.9 - 1.0) * n1;
      tr += (1.13 - tr) * n2;
      tg += (1.02 - tg) * n2;
      tb += (0.72 - tb) * n2;
      tint[k * 3] = tr;
      tint[k * 3 + 1] = tg;
      tint[k * 3 + 2] = tb;

      const kind = kinds[k];
      const wet = isWet(kind) ? 1 : 0;
      const plaza = isPlaza(x, z) && kind === 'terrace' ? 1 : 0;
      // dirt paths stay on walkable ground: where a path runs over a cliff edge its colour would smear down the wall
      const slope = Math.hypot(hAt(i + 1, j) - hAt(i - 1, j), hAt(i, j + 1) - hAt(i, j - 1)) * RES / 2;
      const flat = 1 - smoothstep(0.7, 1.4, slope);
      const pm = kind === 'meadow' || kind === 'stairs' ? pathMask(x, z) * flat : 0;
      const pw = kind === 'stairs' ? 1 : pm * (1 - wet) * (1 - plaza);
      mats[k * 4] = Math.max(0, 1 - pw - wet - plaza);
      mats[k * 4 + 1] = pw;
      mats[k * 4 + 2] = 0; // soil: unused since the garden became grass + a walkway (kept for later ground kinds)
      mats[k * 4 + 3] = wet;
      pave[k] = plaza;
    }
  }

  const index: number[] = [];
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i;
      index.push(a, a + nx + 1, a + 1, a + 1, a + nx + 1, a + nx + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aMat', new THREE.BufferAttribute(mats, 4));
  geo.setAttribute('aPave', new THREE.BufferAttribute(pave, 1));
  geo.setAttribute('aAO', new THREE.BufferAttribute(aoAttr, 1));
  geo.setAttribute('aTint', new THREE.BufferAttribute(tint, 3));
  geo.setAttribute('aTop', new THREE.BufferAttribute(topAttr, 1));
  geo.setIndex(index);
  geo.computeVertexNormals();

  // SPEED: the ground covers the whole screen, so every texture read here is paid ~2 million times a frame
  // (measured on the tablet: this shader alone took it from 54 fps to 15). Grass = ONE texture read.
  // Path, soil, riverbed, paving and cliff stone are only read where they are: their weights come from
  // the vertices, so whole areas skip them together.
  void noiseTex;
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uSun: { value: sunDir },
      uGrass: { value: tex.grass },
      uGrassScale: { value: tex.grassScale },
      uPath: { value: tex.path },
      uSoil: { value: tex.soil },
      uStone: { value: tex.stone },
      uBed: { value: tex.riverbed },
      uPave: { value: tex.paving },
      uLip: { value: tex.lip },
    },
    vertexShader: /* glsl */ `
      attribute vec4 aMat;
      attribute float aPave;
      attribute float aAO;
      attribute vec3 aTint;
      attribute float aTop;
      varying vec4 vMat;
      varying float vPave;
      varying vec3 vNormal;
      varying vec3 vWorld;
      varying float vAO;
      varying vec3 vTint;
      varying float vTop;
      void main() {
        vMat = aMat; vPave = aPave; vNormal = normal; vWorld = position; vAO = aAO; vTint = aTint; vTop = aTop;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uGrass;
      uniform float uGrassScale;
      uniform sampler2D uPath;
      uniform sampler2D uSoil;
      uniform sampler2D uStone;
      uniform sampler2D uBed;
      uniform sampler2D uPave;
      uniform sampler2D uLip;
      uniform vec3 uSun;
      varying vec4 vMat;
      varying float vPave;
      varying vec3 vNormal;
      varying vec3 vWorld;
      varying float vAO;
      varying vec3 vTint;
      varying float vTop;

      void main() {
        vec3 N = normalize(vNormal);
        vec2 p = vWorld.xz;
        // texture reads inside the "only where needed" branches below use these, so the
        // pixels at the edge of a path still pick the right level of detail
        vec2 dx = dFdx(p);
        vec2 dy = dFdy(p);
        vec3 col = texture(uGrass, p / uGrassScale).rgb * vTint;
        float other = vMat.y + vMat.z + vMat.w + vPave;
        if (other > 0.003) {
          vec3 o = vec3(0.0);
          if (vMat.y > 0.003) o += textureGrad(uPath, p / 2.6, dx / 2.6, dy / 2.6).rgb * vMat.y;
          if (vMat.z > 0.003) o += textureGrad(uSoil, p / 2.2, dx / 2.2, dy / 2.2).rgb * vMat.z;
          if (vMat.w > 0.003) o += textureGrad(uBed, p / 2.4, dx / 2.4, dy / 2.4).rgb * (0.85 * vMat.w);
          if (vPave > 0.003) o += textureGrad(uPave, p / 2.8, dx / 2.8, dy / 2.8).rgb * vPave;
          col = (col * vMat.x + o) / max(0.001, vMat.x + other);
        }

        // cliff sides: painted stone wall anchored at the top edge, grass lip hanging over it.
        // Steepness from the smooth normal, and also from the triangle itself: a sheer wall only one grid step
        // tall has half-flat normals at both edges and would otherwise show the ground stretched down it
        vec3 fN = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
        float steep = max(smoothstep(0.35, 0.6, 1.0 - N.y), smoothstep(0.55, 0.75, 1.0 - abs(fN.y)));
        if (steep > 0.003) {
          float u = (vWorld.x - vWorld.z) / 2.0;
          float below = vTop - vWorld.y;
          vec2 wdx = vec2(dFdx(u), dFdx(below));
          vec2 wdy = vec2(dFdy(u), dFdy(below));
          vec3 wall = textureGrad(uStone, vec2(u, 1.0 - below / 1.6), vec2(wdx.x, -wdx.y / 1.6), vec2(wdy.x, -wdy.y / 1.6)).rgb;
          vec4 lip = textureGrad(uLip, vec2(u * 2.0 / 1.1, 1.0 - clamp(below / 0.34, 0.0, 1.0)), vec2(wdx.x * 2.0 / 1.1, -wdx.y / 0.34), vec2(wdy.x * 2.0 / 1.1, -wdy.y / 0.34));
          wall = mix(wall, lip.rgb, lip.a * step(0.7, vTop));
          col = mix(col, wall, steep);
        }

        float ndl = max(dot(N, normalize(uSun)), 0.0);
        vec3 light = vec3(0.68, 0.7, 0.75) + vec3(0.55, 0.5, 0.4) * ndl;
        col *= light * vAO;
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
  const path = new Float32Array(count);
  for (let k = 0; k < count; k++) path[k] = mats[k * 4 + 1];
  return { mesh: splitIntoChunks(geo, mat, 0, 0, 'ground'), material: mat, heights, nx, nz, kinds, path, pave };
}

// ---------------------------------------------------------------------------
// Stone walls: rounded, slightly lumpy stones stacked in courses, mossy on top
// ---------------------------------------------------------------------------

function makeStoneGeometry(): THREE.BufferGeometry {
  let g: THREE.BufferGeometry = new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g);
  const p = g.attributes.position as THREE.BufferAttribute;
  const r = 0.26;
  const v = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    c.set(Math.max(-0.5 + r, Math.min(0.5 - r, v.x)), Math.max(-0.5 + r, Math.min(0.5 - r, v.y)), Math.max(-0.5 + r, Math.min(0.5 - r, v.z)));
    const d = v.clone().sub(c);
    if (d.lengthSq() > 1e-6) d.normalize().multiplyScalar(r);
    v.copy(c).add(d);
    // lumpy: stones are hand-cut, not machined
    const n = fbm(v.x * 2.3 + 5, v.y * 2.3 + v.z * 1.7, 77, 2);
    v.multiplyScalar(0.92 + n * 0.16);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

interface Stone { x: number; y: number; z: number; sx: number; sy: number; sz: number; ry: number; rz: number; tone: number }

export interface StoneWalls { stones: THREE.InstancedMesh; lips: THREE.Mesh }

export function buildStoneWalls(noiseTex: THREE.Texture): StoneWalls {
  const R = rng(4242);
  const stones: Stone[] = [];
  const lipPos: number[] = [];
  const lipCol: number[] = [];
  const lipIdx: number[] = [];

  /** Stack a wall along a cell edge. The wall faces +x (axis 'z') or +z (axis 'x'). */
  const wall = (x0: number, z0: number, axis: 'x' | 'z', top: number, bottom: number, noLip = false) => {
    const height = top - bottom;
    const courses = Math.max(1, Math.round(height / 0.4));
    const ch = height / courses;
    for (let c = 0; c < courses; c++) {
      let along = -0.06 - R() * 0.12 * (c % 2);
      while (along < 1.0) {
        const w = 0.3 + R() * 0.3;
        const mid = Math.min(along + w / 2, 1.02);
        const out = 0.05 + R() * 0.05;
        const y = bottom + ch * (c + 0.5) + (R() - 0.5) * 0.04;
        const sx = w * 0.97;
        const sy = ch * (0.9 + R() * 0.12);
        const sz = 0.34 + R() * 0.08;
        if (axis === 'x') stones.push({ x: x0 + mid, y, z: z0 + out - 0.1, sx, sy, sz, ry: (R() - 0.5) * 0.12, rz: (R() - 0.5) * 0.1, tone: R() });
        else stones.push({ x: x0 + out - 0.1, y, z: z0 + mid, sx: sz, sy, sz: sx, ry: (R() - 0.5) * 0.12, rz: (R() - 0.5) * 0.1, tone: R() });
        along += w;
      }
    }
    if (noLip) return;
    // grass hanging over the top edge: a strip with a ragged lower edge
    const segs = 8;
    const base = lipPos.length / 3;
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      const drop = 0.07 + R() * 0.14;
      const o1 = 0.03;
      const o2 = 0.1 + R() * 0.04;
      const topY = top + 0.02;
      if (axis === 'x') {
        lipPos.push(x0 + t, topY, z0 - 0.02 + o1, x0 + t, top - drop, z0 + o2);
      } else {
        lipPos.push(x0 - 0.02 + o1, topY, z0 + t, x0 + o2, top - drop, z0 + t);
      }
      const g = 0.9 + R() * 0.2;
      lipCol.push(0.56 * g, 0.72 * g, 0.28 * g, 0.36 * g, 0.5 * g, 0.17 * g);
      if (s < segs) {
        const a = base + s * 2;
        lipIdx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
      }
    }
  };

  for (let cz = -3; cz < MAP_D + 3; cz++) {
    for (let cx = -3; cx < MAP_W + 3; cx++) {
      const k = cellKind(cx, cz);
      if (k === 'river' || k === 'pool') continue;
      const top = k === 'stairs' ? MEADOW : kindHeight(k);
      // only the two sides that face the camera can be seen
      for (const [dx, dz, axis] of [[1, 0, 'z'], [0, 1, 'x']] as [number, number, 'x' | 'z'][]) {
        const nk = cellKind(cx + dx, cz + dz);
        if (nk === 'stairs' && dz === 1) continue;
        const nbottom = kindHeight(nk === 'stairs' ? 'meadow' : nk);
        if (top - nbottom < 0.3) continue;
        const notch = cx === 4 && cz === 4 && dz === 1; // rim next to the waterfall notch stays open at the top
        void notch;
        void axis;
      }
      // stone steps: four treads going down toward +z, with a stone cheek on the visible side
      if (k === 'stairs') {
        for (let s = 0; s < 4; s++) {
          const y = TERRACE - (TERRACE - MEADOW) * (s + 1) / 4;
          let along = 0.02;
          while (along < 0.98) {
            const w = 0.3 + R() * 0.25;
            stones.push({ x: cx + Math.min(along + w / 2, 0.98), y: y - 0.06, z: cz + s * 0.25 + 0.14, sx: w * 0.96, sy: 0.22, sz: 0.3, ry: (R() - 0.5) * 0.06, rz: 0, tone: 0.3 + R() * 0.5 });
            along += w;
          }
        }
        if (cellKind(cx + 1, cz) !== 'stairs') {
          for (let s = 0; s < 3; s++) {
            const hgt = (TERRACE - MEADOW) * (1 - s / 3);
            stones.push({ x: cx + 1.02, y: MEADOW + hgt / 2, z: cz + 0.18 + s * 0.3, sx: 0.3, sy: hgt, sz: 0.34, ry: 0, rz: 0, tone: R() });
          }
        }
      }
    }
  }

  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.Float32BufferAttribute(lipPos, 3));
  lg.setAttribute('color', new THREE.Float32BufferAttribute(lipCol, 3));
  lg.setIndex(lipIdx);
  lg.computeVertexNormals();
  const lips = new THREE.Mesh(lg, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  return { stones: stoneMesh(stones, noiseTex), lips };
}

/** Rounded mossy stones, all drawn together (walls, steps). */
function stoneMesh(stones: Stone[], noiseTex: THREE.Texture): THREE.InstancedMesh {
  const geo = makeStoneGeometry();
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uNoise = { value: noiseTex };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWN;\nvarying vec3 vWP;\nvarying float vLocalY;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vLocalY = position.y;
        vWN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);
        vWP = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uNoise;\nvarying vec3 vWN;\nvarying vec3 vWP;\nvarying float vLocalY;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float mn = texture2D(uNoise, vWP.xz * 0.45 + vWP.y * 0.3).g;
        float moss = smoothstep(0.3, 0.8, vWN.y) * smoothstep(0.38, 0.62, mn);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.42, 0.57, 0.2), moss * 0.9);
        // speckles and a darker underside so every stone reads as a rounded lump
        float sp = texture2D(uNoise, vWP.xz * 2.5 + vWP.y * 1.9).a;
        diffuseColor.rgb *= 0.9 + sp * 0.18;
        diffuseColor.rgb *= mix(0.72, 1.0, smoothstep(-0.5, 0.2, vLocalY));`);
  };
  const inst = new THREE.InstancedMesh(geo, mat, stones.length);
  inst.name = 'steps';
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const col = new THREE.Color();
  const lilac = new THREE.Color(0x9a8f96);
  const warm = new THREE.Color(0xb8aea4);
  stones.forEach((s, i) => {
    e.set(0, s.ry, s.rz);
    q.setFromEuler(e);
    m.compose(new THREE.Vector3(s.x, s.y, s.z), q, new THREE.Vector3(s.sx, s.sy, s.sz));
    inst.setMatrixAt(i, m);
    col.copy(lilac).lerp(warm, s.tone);
    inst.setColorAt(i, col);
  });
  inst.instanceMatrix.needsUpdate = true;
  if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
  inst.frustumCulled = false;
  return inst;
}

/** The designed map's stone steps: a row of stones on every tread, and stone cheeks on the side you can see. */
export function buildDesignedSteps(noiseTex: THREE.Texture): THREE.InstancedMesh {
  const R = rng(4343);
  const stones: Stone[] = [];
  const dm = designed!;
  for (const s of dm.map.steps) {
    const [x0, z0, x1, z1] = s.rect;
    const hu = dm.LH(s.upper);
    const hl = dm.LH(s.lower);
    const alongZ = s.dir === 'z';
    const len = alongZ ? z1 - z0 : x1 - x0;
    const [c0, c1] = alongZ ? [x0, x1] : [z0, z1]; // across the steps
    const depth = len / s.steps;
    for (let n = 1; n <= s.steps; n++) {
      const y = hu - ((hu - hl) * n) / s.steps;
      const mid = (alongZ ? z0 : x0) + (n - 0.5) * depth;
      let across = c0 + 0.02;
      while (across < c1 - 0.02) {
        const w = Math.min(0.3 + R() * 0.25, c1 - 0.02 - across);
        const c = across + w / 2;
        if (w > 0.08) {
          if (alongZ) stones.push({ x: c, y: y - 0.06, z: mid, sx: w * 0.96, sy: 0.22, sz: depth * 1.15, ry: (R() - 0.5) * 0.06, rz: 0, tone: 0.3 + R() * 0.5 });
          else stones.push({ x: mid, y: y - 0.06, z: c, sx: depth * 1.15, sy: 0.22, sz: w * 0.96, ry: (R() - 0.5) * 0.06, rz: 0, tone: 0.3 + R() * 0.5 });
        }
        across += w;
      }
      // cheek on the side facing the camera, down to the ground beside the steps
      const sx = alongZ ? x1 + 0.1 : mid;
      const sz = alongZ ? mid : z1 + 0.1;
      const foot = groundHeight(alongZ ? x1 + 0.35 : mid, alongZ ? mid : z1 + 0.35);
      const hgt = y + 0.05 - foot;
      if (hgt > 0.15) {
        if (alongZ) stones.push({ x: sx, y: foot + hgt / 2, z: sz, sx: 0.3, sy: hgt, sz: depth * 1.2, ry: 0, rz: 0, tone: R() });
        else stones.push({ x: sx, y: foot + hgt / 2, z: sz, sx: depth * 1.2, sy: hgt, sz: 0.3, ry: 0, rz: 0, tone: R() });
      }
    }
  }
  const inst = stoneMesh(stones, noiseTex);
  inst.name = 'steps';
  return inst;
}

// ---------------------------------------------------------------------------
// Water: one mesh for the river and the high pool, animated in the shader.
// ---------------------------------------------------------------------------

/** fallBases: where each waterfall (in FALLS order) hits the water below, for the foam. */
export function buildWater(ground: GroundData, noiseTex: THREE.Texture, fallBases: THREE.Vector3[]): { object: THREE.Group; material: THREE.ShaderMaterial } {
  const { nx, nz, heights } = ground;
  const step = 2;
  const wx = Math.floor(nx / step);
  const wz = Math.floor(nz / step);
  const pos: number[] = [];
  const depth: number[] = [];
  const flow: number[] = [];
  const idxMap = new Int32Array((wx + 1) * (wz + 1)).fill(-1);
  const levels = new Float32Array((wx + 1) * (wz + 1));
  const below = new Uint8Array((wx + 1) * (wz + 1));

  for (let j = 0; j <= wz; j++) {
    for (let i = 0; i <= wx; i++) {
      const gi = i * step;
      const gj = j * step;
      const x = gi / RES - PAD;
      const z = gj / RES - PAD;
      const k = j * (wx + 1) + i;
      levels[k] = waterLevel(x, z);
      below[k] = heights[gj * (nx + 1) + gi] < levels[k] - 0.005 ? 1 : 0;
    }
  }
  const vid = (i: number, j: number) => {
    const k = j * (wx + 1) + i;
    if (idxMap[k] >= 0) return idxMap[k];
    const gi = i * step;
    const gj = j * step;
    const x = gi / RES - PAD;
    const z = gj / RES - PAD;
    pos.push(x, levels[k], z);
    depth.push(Math.max(0, levels[k] - heights[gj * (nx + 1) + gi]));
    if (designed) {
      const f = designed.flow(x, z);
      flow.push(f[0], f[1]);
    } else if (levels[k] > WATER + 0.5) {
      // pools up on the cliffs drift toward the waterfall that drains them
      let fx = FALL.x;
      let fz = (FALL.z0 + FALL.z1) / 2;
      let best = 1e9;
      for (const f of FALLS) {
        if (f.top !== POOL_WATER || f.dir !== 'x') continue;
        const d = Math.hypot(f.at - x, (f.a0 + f.a1) / 2 - z);
        if (d < best) { best = d; fx = f.at; fz = (f.a0 + f.a1) / 2; }
      }
      const dx = fx - x;
      const dz = fz - z;
      const l = Math.hypot(dx, dz) || 1;
      flow.push((dx / l) * 0.25, (dz / l) * 0.25);
    } else {
      const f = riverFlow(x, z);
      flow.push(f[0], f[1]);
    }
    idxMap[k] = pos.length / 3 - 1;
    return idxMap[k];
  };
  const index: number[] = [];
  for (let j = 0; j < wz; j++) {
    for (let i = 0; i < wx; i++) {
      const ks = [j * (wx + 1) + i, j * (wx + 1) + i + 1, (j + 1) * (wx + 1) + i, (j + 1) * (wx + 1) + i + 1];
      if (!(below[ks[0]] || below[ks[1]] || below[ks[2]] || below[ks[3]])) continue;
      const l0 = levels[ks[0]];
      if (l0 === NO_WATER || levels[ks[1]] !== l0 || levels[ks[2]] !== l0 || levels[ks[3]] !== l0) continue;
      const a = vid(i, j);
      const b = vid(i + 1, j);
      const c = vid(i, j + 1);
      const d = vid(i + 1, j + 1);
      index.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aDepth', new THREE.Float32BufferAttribute(depth, 1));
  geo.setAttribute('aFlow', new THREE.Float32BufferAttribute(flow, 2));
  geo.setIndex(index);

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    // each fall: where it lands (xyz) and which way it faces (w: 0 = falls toward +x, 1 = toward +z)
    uniforms: { uTime: { value: 0 }, uNoise: { value: noiseTex }, uFalls: { value: fallBases.map((b, i) => new THREE.Vector4(b.x, b.y, b.z, FALLS[i].dir === 'z' ? 1 : 0)) } },
    vertexShader: /* glsl */ `
      attribute float aDepth;
      attribute vec2 aFlow;
      varying float vDepth;
      varying vec2 vFlow;
      varying vec3 vWorld;
      void main() {
        vDepth = aDepth; vFlow = aFlow; vWorld = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform sampler2D uNoise;
      uniform vec4 uFalls[${FALLS.length}];
      varying float vDepth;
      varying vec2 vFlow;
      varying vec3 vWorld;
      void main() {
        vec2 p = vWorld.xz;
        float speed = length(vFlow);
        vec2 dir = speed > 0.001 ? vFlow / speed : vec2(1.0, 0.0);
        vec2 side = vec2(-dir.y, dir.x);
        vec2 q = vec2(dot(p, dir) * 0.55, dot(p, side) * 1.1);
        float t = uTime * (0.3 + 0.7 * speed);
        float n1 = texture2D(uNoise, q * 0.09 - vec2(t * 0.045, 0.0)).g;
        float n2 = texture2D(uNoise, q * 0.16 - vec2(t * 0.07, 0.13)).b;
        float ripple = n1 * 0.6 + n2 * 0.4;
        float d = vDepth;
        vec3 col = mix(vec3(0.55, 0.9, 0.86), vec3(0.13, 0.62, 0.72), smoothstep(0.02, 0.4, d));
        col += (ripple - 0.5) * 0.16;
        float hl = smoothstep(0.7, 0.8, n2 * 0.5 + n1 * 0.6);
        col = mix(col, vec3(0.92, 1.0, 0.98), hl * 0.6);
        float streak = texture2D(uNoise, vec2(dot(p, dir) * 0.035 - t * 0.03, dot(p, side) * 0.3)).a;
        col = mix(col, vec3(0.95, 1.0, 1.0), smoothstep(0.74, 0.84, streak) * 0.45 * smoothstep(0.1, 0.5, speed));
        float shore = 1.0 - smoothstep(0.0, 0.1 + ripple * 0.06, d);
        float fallFoam = 0.0;
        for (int i = 0; i < ${FALLS.length}; i++) {
          vec4 f = uFalls[i];
          // the foam patch is longer along the fall's width than away from it
          float fd = length((p - f.xz) * mix(vec2(0.8, 0.6), vec2(0.6, 0.8), f.w));
          fallFoam = max(fallFoam, (1.0 - smoothstep(0.3, mix(1.5, 1.3, f.w) + ripple * 0.5, fd)) * step(abs(vWorld.y - f.y), 0.4));
        }
        float foamN = texture2D(uNoise, p * 0.35 - dir * t * 0.3).a;
        float foam = max(shore * smoothstep(0.35, 0.55, foamN + shore * 0.3), fallFoam * smoothstep(0.3, 0.6, foamN + fallFoam * 0.4));
        col = mix(col, vec3(0.97, 1.0, 1.0), clamp(foam, 0.0, 1.0));
        float alpha = max(mix(0.72, 0.93, smoothstep(0.0, 0.35, d)), foam);
        gl_FragColor = vec4(col, alpha);
        #include <colorspace_fragment>
      }
    `,
  });
  return { object: splitIntoChunks(geo, mat, 1, 0, 'water'), material: mat };
}

// ---------------------------------------------------------------------------
// Waterfall: a curved sheet from the pool's notch down to the river.
// ---------------------------------------------------------------------------

export function buildWaterfall(noiseTex: THREE.Texture, fall: Fall): { mesh: THREE.Mesh; base: THREE.Vector3 } {
  const { at: edge, a0: z0, a1: z1 } = fall;
  const topY = fall.top;
  const botY = fall.bottom;
  const put = (along: number, y: number, across: number) => (fall.dir === 'x' ? pos.push(along, y, across) : pos.push(across, y, along));
  const segZ = 6;
  const segY = 12;
  const pos: number[] = [];
  const uv: number[] = [];
  for (let j = 0; j <= segY; j++) {
    const t = j / segY;
    for (let i = 0; i <= segZ; i++) {
      const s = i / segZ;
      const out = Math.sin(Math.min(1, t * 1.6) * Math.PI * 0.5) * 0.45 + t * 0.18;
      put(edge - 0.02 + out, topY + (botY - topY) * t, z0 + (z1 - z0) * s);
      uv.push(s, t);
    }
  }
  const index: number[] = [];
  for (let j = 0; j < segY; j++) {
    for (let i = 0; i < segZ; i++) {
      const a = j * (segZ + 1) + i;
      index.push(a, a + 1, a + segZ + 1, a + 1, a + segZ + 2, a + segZ + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(index);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 }, uNoise: { value: noiseTex } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform sampler2D uNoise;
      varying vec2 vUv;
      void main() {
        float streak = texture2D(uNoise, vec2(vUv.x * 0.9, vUv.y * 0.35 - uTime * 0.9)).b;
        float streak2 = texture2D(uNoise, vec2(vUv.x * 1.7 + 0.3, vUv.y * 0.6 - uTime * 1.4)).a;
        float s = streak * 0.6 + streak2 * 0.4;
        vec3 col = mix(vec3(0.6, 0.9, 0.93), vec3(1.0), smoothstep(0.45, 0.75, s));
        col = mix(col, vec3(1.0), smoothstep(0.7, 1.0, vUv.y));
        float side = smoothstep(0.0, 0.12, vUv.x) * smoothstep(1.0, 0.88, vUv.x);
        gl_FragColor = vec4(col, (0.72 + 0.28 * s) * side);
        #include <colorspace_fragment>
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 2;
  const base = fall.dir === 'x' ? new THREE.Vector3(edge + 0.6, botY + 0.05, (z0 + z1) / 2) : new THREE.Vector3((z0 + z1) / 2, botY + 0.05, edge + 0.6);
  return { mesh, base };
}
