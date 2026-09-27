import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { makeNoiseTexture } from './noise';
import {
  BOARD_Y, BRIDGES, FALLS, MAP_D, MAP_W, MEADOW, PAD, POOL_WATER, RES, WATER, bridgeAt, onBoardwalk, buildGround, buildStoneWalls, buildWater, buildWaterfall, groundHeight, kindAt,
  type GroundData, type GroundTextures, useDesignedMap, designed as designedWorld,
} from './world';
import type { DesignedWorld } from './designed';
import { placeDesigned } from './designed-props';
import { ELEV, animated, isBlocked, placeScene } from './props';
import { debugState, setupDebug } from './debug';
import { gradeOn, installGrade, refreshMaterials, setGrade } from './grade';
import { MOUNTAINS_ON, buildClouds, buildMountains } from './mountains';
import { loadDucks } from './ducks';
import { createHud } from './hud';
import { createMinimap } from './minimap';
import { addOutlines } from './outline';
import { flattenDepth } from './flatdepth';
import { CROPS, CROP_IDS, type Bed, type BedState, type Crop, type Garden, createGarden } from './garden';
import { type SaveData, agoText, clearSave, readSave, writeSave } from './save';
import { fx } from './fx';
import { buildBackdrop, skyTexture } from './backdrop';

const params = new URLSearchParams(location.search);
installGrade(params); // must run before anything is drawn
/** ?map=<key> opens one of the six designed maps instead of Sunny Meadow (just walking around, for now) */
const MAP_NAMES: Record<string, [string, string]> = {
  old_orchard: ['Old Orchard', 'Apple trees on the terraced hills'],
  bamboo_woods: ['Bamboo Woods', 'Tall bamboo and a quiet tea house'],
  lotus_marsh: ['Lotus Marsh', 'Boardwalks over the lily ponds'],
  mountain_springs: ['Mountain Springs', 'Hot springs high on the cliffs'],
  moonlit_lake: ['Moonlit Lake', 'A calm lake under the stars'],
  misty_highlands: ['Misty Highlands', 'Rock pillars above the clouds'],
};
const MAP_KEY = params.get('map') && MAP_NAMES[params.get('map')!] ? params.get('map')! : null;
const canvas = document.getElementById('game') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
// always full sharpness (the screen's own pixel density); ?dpr= overrides it for speed tests
const pixelRatio = Math.min(window.devicePixelRatio, Number(params.get('dpr')) || 2);
renderer.setPixelRatio(pixelRatio);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.localClippingEnabled = true; // swimming ducks: the part under the water line is cut away

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x7fae4a);

// Fixed game camera: rotated 45°, looking down 30° (matches the painted art).
const AZ = Math.PI / 4;
const camDir = new THREE.Vector3(Math.cos(ELEV) * Math.sin(AZ), Math.sin(ELEV), Math.cos(ELEV) * Math.cos(AZ));
let viewH = Number(params.get('zoom')) || 11; // world units visible top-to-bottom
// zoomed right out: the whole map fits top to bottom (its diamond's height on screen, plus a margin)
const WHOLE_VIEW = Math.round((MAP_W + MAP_D) * Math.SQRT1_2 * Math.sin(ELEV) + 4);
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
const camTarget = new THREE.Vector3(25, MEADOW, 7);

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  const aspect = w / h;
  camera.left = (-viewH * aspect) / 2;
  camera.right = (viewH * aspect) / 2;
  camera.top = viewH / 2;
  camera.bottom = -viewH / 2;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

function placeCamera() {
  camera.position.copy(camTarget).addScaledVector(camDir, 60);
  camera.lookAt(camTarget);
}

// Light (ground uses its own shader with the same sun direction).
// sunlight from the upper-left of the screen, like the painted art
const sun = new THREE.Vector3(-0.64, 0.77, 0.05).normalize();
scene.add(new THREE.HemisphereLight(0xeaf4ff, 0x7d8a45, 2.0));
const dl = new THREE.DirectionalLight(0xfff0d6, 1.9);
dl.position.copy(sun).multiplyScalar(20);
scene.add(dl);

const noiseTex = makeNoiseTexture(256);
// the waterfalls are painted pictures now (props.ts); the 3D sheets only give the foam and mist positions
// (made once the map is known: a designed map has its own waterfalls)
let falls: ReturnType<typeof buildWaterfall>[] = [];
let ground: GroundData;
let waterMat: THREE.ShaderMaterial;
let mountainMat: THREE.ShaderMaterial | null = null;
const clouds = buildClouds();

/** Painted ground textures (Codex/Gemini, made seamless by tools/import_codex_textures.py). */
const texLoader = new THREE.TextureLoader();
async function loadTex(file: string) {
  const t = await texLoader.loadAsync(`tex/${file}`);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  // extra-sharp filtering at an angle costs several texture reads per pixel on the tablet: off unless asked for
  t.anisotropy = Number(params.get('aniso')) || 1;
  return t;
}
/** Grass choices [name, picture, world units per repeat]: the user's picks (tools/import_grass.py). Debug panel switches them. */
const GRASS: [string, string, number][] = [
  ['Old painted', 'grass.jpg', 3.0],
  ['1 Soft teal', 'grass_g1.jpg', 3.5],
  ['2 Bright green', 'grass_g2.jpg', 4.0],
  ['3 Deep green', 'grass_g3.jpg', 4.0],
  ['4 Clover & flowers', 'grass_g4.jpg', 4.5],
];
let grassPick = Number(params.get('grass') ?? 4);
if (!GRASS[grassPick]) grassPick = 4;
async function loadGroundTextures(): Promise<GroundTextures> {
  const files = [GRASS[grassPick][1], 'path.jpg', 'soil.jpg', 'rockface.jpg', 'riverbed.jpg', 'paving.jpg', 'lip.png'];
  const [grass, path, soil, stone, riverbed, paving, lip] = await Promise.all(files.map(loadTex));
  lip.wrapT = THREE.ClampToEdgeWrapping;
  return { grass, grassScale: GRASS[grassPick][2], path, soil, stone, riverbed, paving, lip };
}
async function setGrass(n: number) {
  const [, file, scale] = GRASS[n];
  const old = ground.material.uniforms.uGrass.value as THREE.Texture;
  ground.material.uniforms.uGrass.value = await loadTex(file);
  ground.material.uniforms.uGrassScale.value = scale;
  if (mountainMat) {
    mountainMat.uniforms.uGrass.value = ground.material.uniforms.uGrass.value;
    mountainMat.uniforms.uGrassScale.value = scale;
  }
  old.dispose();
  grassPick = n;
}

// ---------------------------------------------------------------------------
// Steam and mist puffs (hot spring + waterfall base)
// ---------------------------------------------------------------------------
const puffTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,0.9)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.35)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();

interface Puff { s: THREE.Sprite; life: number; max: number; vx: number; vy: number; vz: number; size: number; base: THREE.Vector3; spread: number }
const puffs: Puff[] = [];
function emitter(base: THREE.Vector3, n: number, spread: number, rise: number, size: number, opacity: number) {
  for (let i = 0; i < n; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTex, transparent: true, depthWrite: false, opacity }));
    s.renderOrder = 4;
    s.name = 'puffs';
    scene.add(s);
    puffs.push({ s, life: (i / n) * 3, max: 3, vx: 0, vy: rise, vz: 0, size, base, spread });
  }
}
function updatePuffs(dt: number) {
  for (const p of puffs) {
    p.life += dt;
    if (p.life > p.max) {
      p.life = 0;
      p.vx = (Math.random() - 0.5) * 0.15;
      p.vz = (Math.random() - 0.5) * 0.15;
      p.s.position.set(p.base.x + (Math.random() - 0.5) * p.spread, p.base.y, p.base.z + (Math.random() - 0.5) * p.spread);
      (p.s.userData as { o?: number }).o = (p.s.material as THREE.SpriteMaterial).opacity || 0.5;
    }
    const t = p.life / p.max;
    p.s.position.x += p.vx * dt;
    p.s.position.y += p.vy * dt;
    p.s.position.z += p.vz * dt;
    p.s.scale.setScalar(p.size * (0.5 + t));
    const o = (p.s.userData as { o?: number }).o ?? 0.5;
    (p.s.material as THREE.SpriteMaterial).opacity = o * Math.sin(Math.PI * t);
  }
}

// ---------------------------------------------------------------------------
// Mochi
// ---------------------------------------------------------------------------
const mochi = new THREE.Group();
mochi.name = 'mochi';
const mochiCenter = new THREE.Vector3();
scene.add(mochi);
let mixer: THREE.AnimationMixer | null = null;
const actions = new Map<string, THREE.AnimationAction>();
let current = '';
let modelScale = 1;
const MOCHI_LEN = 1.25; // world units nose-to-tail

function play(name: string, timeScale = 1) {
  const a = actions.get(name);
  if (!a) return;
  a.timeScale = timeScale;
  if (current === name) return;
  const prev = actions.get(current);
  a.reset().play();
  if (prev) a.crossFadeFrom(prev, 0.2, false);
  current = name;
}

async function loadMochi() {
  const gltf = await new GLTFLoader().loadAsync('models/C02_mochi.glb');
  const model = gltf.scene;
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  modelScale = MOCHI_LEN / Math.max(size.x, size.z);
  model.scale.setScalar(modelScale);
  model.position.y = -box.min.y * modelScale;
  model.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) {
        mat.transparent = true; // draw after the sprites so depth sorting stays right
        mat.depthWrite = true;
      }
      m.renderOrder = 10;
      m.frustumCulled = false;
    }
  });
  addOutlines(model, 0.028); // dark outline like the painted art, so Mochi stands out on the grass
  if (!params.has('noflat')) flattenDepth(model, mochiCenter); // wholly in front of or behind each tree/bush picture, never cut in half
  mochi.add(model);
  mixer = new THREE.AnimationMixer(model);
  for (const clip of gltf.animations) actions.set(clip.name, mixer.clipAction(clip));
  console.log('Mochi clips:', [...actions.keys()].join(', '), 'size', size.toArray().map((v) => v.toFixed(2)));
  const sh = new THREE.Mesh(
    new THREE.CircleGeometry(0.42, 24).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x2c3a10, transparent: true, opacity: 0.28, depthWrite: false }),
  );
  sh.scale.set(1, 1, 0.7);
  sh.position.y = 0.03;
  sh.renderOrder = 0;
  mochi.add(sh);
  play('idle');
}

// Walkable ground = meadow level, not water, not inside objects. Bridge is walkable.
// Mochi stays near the middle of the deck, so his body never pokes through the front railing (0.62 out).
const DECK_HALF = 0.38;
function onBridge(x: number, z: number) {
  const on = bridgeAt(x, z);
  return !!on && Math.abs(on.off) < DECK_HALF;
}
/**
 * ONE RULE FOR EVERY BRIDGE (all maps): the bridge picture is solid - its sides, posts, stone feet and the
 * bushes at its corners - except the walking lane down the middle of the deck. So Mochi (and the ducklings,
 * who walk in his footsteps) can only get on at the two ends and never stand beside or behind a bridge,
 * where the flat picture and his 3D body would overlap.
 */
const BRIDGE_END = 0.9; // the solid part reaches this far past each end of the deck (the stone feet)
function besideBridge(x: number, z: number): boolean {
  const list: { x: number; z: number; axis: 'x' | 'z'; half: number; width?: number }[] = designedWorld ? designedWorld.bridges : BRIDGES;
  for (const b of list) {
    const a = Math.abs(b.axis === 'z' ? z - b.z : x - b.x);
    const off = Math.abs(b.axis === 'z' ? x - b.x : z - b.z);
    const side = b.width ? b.width / 2 + 0.5 : 1.5;
    if (a < b.half + BRIDGE_END && off >= DECK_HALF && off < side) return true;
  }
  return false;
}
function standHeight(x: number, z: number): number {
  const on = bridgeAt(x, z);
  if (on && Math.abs(on.off) < DECK_HALF) {
    return on.b.deck + Math.sin(Math.max(0, Math.min(1, on.t)) * Math.PI) * on.b.arc;
  }
  if (onBoardwalk(x, z)) return Math.max(BOARD_Y, groundHeight(x, z));
  return groundHeight(x, z);
}
function walkable(x: number, z: number): boolean {
  if (x < 0.5 || z < 0.5 || x > MAP_W - 0.5 || z > MAP_D - 0.5) return false;
  if (onBridge(x, z) || onBoardwalk(x, z)) return true;
  if (besideBridge(x, z)) return false;
  const k = kindAt(x, z);
  if (k !== 'meadow' && k !== 'terrace' && k !== 'stairs') return false;
  // keep a little way back from every cliff edge (the steps are the only way between levels)
  if (k !== 'stairs') {
    const h = groundHeight(x, z);
    for (const [ox, oz] of [[0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3], [0.25, 0.25], [-0.25, 0.25], [0.25, -0.25], [-0.25, -0.25]]) {
      const nk = kindAt(x + ox, z + oz);
      if (nk === 'stairs') continue;
      if (Math.abs(groundHeight(x + ox, z + oz) - h) > 0.15) return false;
    }
  }
  return !isBlocked(x, z);
}

// Navigation grid (half-unit cells) + A*
const NAV = 2;
const gw = MAP_W * NAV;
const gd = MAP_D * NAV;
let navOK: Uint8Array;
let navH: Float32Array; // stand height of each square, worked out once (the route finder compares them a lot)
function buildNav() {
  navOK = new Uint8Array(gw * gd);
  navH = new Float32Array(gw * gd);
  for (let j = 0; j < gd; j++) {
    for (let i = 0; i < gw; i++) {
      const k = j * gw + i;
      navOK[k] = walkable((i + 0.5) / NAV, (j + 0.5) / NAV) ? 1 : 0;
      if (navOK[k]) navH[k] = standHeight((i + 0.5) / NAV, (j + 0.5) / NAV);
    }
  }
}
function findPath(sx: number, sz: number, tx: number, tz: number): THREE.Vector2[] | null {
  const si = Math.floor(sx * NAV);
  const sj = Math.floor(sz * NAV);
  let ti = Math.floor(tx * NAV);
  let tj = Math.floor(tz * NAV);
  if (!navOK[tj * gw + ti]) {
    // snap to nearest walkable cell around the tap
    let best = -1;
    let bd = 1e9;
    for (let dj = -6; dj <= 6; dj++) for (let di = -6; di <= 6; di++) {
      const i = ti + di;
      const j = tj + dj;
      if (i < 0 || j < 0 || i >= gw || j >= gd || !navOK[j * gw + i]) continue;
      const d = di * di + dj * dj;
      if (d < bd) { bd = d; best = j * gw + i; }
    }
    if (best < 0) return null;
    ti = best % gw;
    tj = Math.floor(best / gw);
  }
  const start = sj * gw + si;
  const goal = tj * gw + ti;
  const g = new Float32Array(gw * gd).fill(1e9);
  const from = new Int32Array(gw * gd).fill(-1);
  const closed = new Uint8Array(gw * gd);
  // squares still to look at, kept as a heap so the most promising one comes out first
  // (the big map made the old list scan take up to 0.3 s per tap on a PC)
  const hf: number[] = [];
  const hc: number[] = [];
  const push = (f: number, c: number) => {
    let i = hf.length;
    hf.push(f);
    hc.push(c);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (hf[p] <= f) break;
      hf[i] = hf[p]; hc[i] = hc[p];
      hf[p] = f; hc[p] = c;
      i = p;
    }
  };
  const pop = (): number => {
    const top = hc[0];
    const lf = hf.pop()!;
    const lc = hc.pop()!;
    if (hf.length) {
      hf[0] = lf; hc[0] = lc;
      let i = 0;
      for (;;) {
        const a = i * 2 + 1;
        const b = a + 1;
        let m = i;
        if (a < hf.length && hf[a] < hf[m]) m = a;
        if (b < hf.length && hf[b] < hf[m]) m = b;
        if (m === i) break;
        [hf[i], hf[m]] = [hf[m], hf[i]];
        [hc[i], hc[m]] = [hc[m], hc[i]];
        i = m;
      }
    }
    return top;
  };
  g[start] = 0;
  push(0, start);
  while (hf.length) {
    const cur = pop();
    if (closed[cur]) continue;
    if (cur === goal) break;
    closed[cur] = 1;
    const ci = cur % gw;
    const cj = Math.floor(cur / gw);
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const ni = ci + di;
      const nj = cj + dj;
      if (ni < 0 || nj < 0 || ni >= gw || nj >= gd) continue;
      const n = nj * gw + ni;
      if (!navOK[n] || closed[n]) continue;
      if (di && dj && (!navOK[cj * gw + ni] || !navOK[nj * gw + ci])) continue;
      if (Math.abs(navH[cur] - navH[n]) > 0.45) continue;
      const ng = g[cur] + (di && dj ? 1.414 : 1);
      if (ng < g[n]) {
        g[n] = ng;
        from[n] = cur;
        push(ng + Math.hypot(ti - ni, tj - nj), n);
      }
    }
  }
  if (from[goal] < 0 && goal !== start) return null;
  const pts: THREE.Vector2[] = [];
  for (let c = goal; c !== start && c >= 0; c = from[c]) pts.push(new THREE.Vector2((c % gw + 0.5) / NAV, (Math.floor(c / gw) + 0.5) / NAV));
  pts.reverse();
  return pts;
}

// ?at=x,z starts Mochi somewhere else (handy for checking one spot)
const startAt = (params.get('at') || '46.2,12.4').split(',').map(Number);
const player = { x: startAt[0], z: startAt[1], heading: Math.PI * 0.25, path: [] as THREE.Vector2[], running: false };
let dustT = 0; // time to the next dust puff while running
const keys = new Set<string>();
window.addEventListener('keydown', (e) => keys.add(e.key.toLowerCase()));
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));

const ray = new THREE.Raycaster();
const tapRing = new THREE.Mesh(
  new THREE.RingGeometry(0.22, 0.32, 32).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0xfff6d0, transparent: true, depthWrite: false }),
);
tapRing.renderOrder = 5;
tapRing.visible = false;
scene.add(tapRing);
let tapT = 0;

// "Mochi is here" marker: a bright pin that floats over Mochi when zoomed out
const finder = (() => {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 96;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ff5a36';
  g.strokeStyle = '#fff';
  g.lineWidth = 6;
  g.beginPath();
  g.arc(32, 32, 24, Math.PI, 0);
  g.lineTo(32, 90);
  g.closePath();
  g.fill();
  g.stroke();
  g.fillStyle = '#fff';
  g.beginPath();
  g.arc(32, 32, 9, 0, Math.PI * 2);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, depthWrite: false }));
  sp.center.set(0.5, 0);
  sp.scale.set(0.8, 1.2, 1);
  sp.renderOrder = 20;
  sp.visible = false;
  return sp;
})();
scene.add(finder);

// ---------------------------------------------------------------------------
// Gardening: tap a bed → Mochi walks to it → the tool in hand decides what happens
// ---------------------------------------------------------------------------
let garden: Garden | null = null;
let task: { bed: Bed; heading: number } | null = null;
let busy = 0; // seconds left of a garden action (Mochi stands still meanwhile)
let busyDone: (() => void) | null = null;
let busyHeading = 0;
let harvested = 0;
const HARVEST_GOAL = 4;
const GROW_SECS = Number(params.get('grow')) || 25;
/** saves the game now (does nothing until the player has picked New game or Continue) */
let saveNow = () => {};

function startBusy(clip: string, secs: number, done: (() => void) | null) {
  busy = secs;
  busyDone = done;
  play(clip);
}
/** Where a bed's effects start: the middle of its soil. */
const bedTop = (bed: Bed) => [bed.x, groundHeight(bed.x, bed.z) + 0.3, bed.z] as const;
/** A quest is finished: sparkles burst over Mochi, a star (and a golden leaf) float up, and he bounces. */
function celebrate(leaf: boolean) {
  const y = standHeight(player.x, player.z);
  fx.play('sparkle', player.x, y + 0.55, player.z, { size: 2.4 });
  fx.pop('star', player.x - 0.2, y + 1.1, player.z, 1, 0.5);
  if (leaf) fx.pop('leaf', player.x + 0.25, y + 1.1, player.z, 1, 0.5, 0.35);
}
function goTend(bed: Bed) {
  const spot = garden!.standSpot(bed);
  player.path = [];
  task = null;
  if (Math.hypot(spot.x - player.x, spot.z - player.z) < 0.35) {
    tend(bed, spot.heading);
    return;
  }
  const path = findPath(player.x, player.z, spot.x, spot.z);
  if (!path) return;
  path.push(new THREE.Vector2(spot.x, spot.z));
  player.path = path;
  player.running = Math.hypot(spot.x - player.x, spot.z - player.z) > 5;
  task = { bed, heading: spot.heading };
  tapRing.position.set(spot.x, standHeight(spot.x, spot.z) + 0.05, spot.z);
  tapRing.visible = true;
  tapT = 0;
}
function tend(bed: Bed, heading: number) {
  const g = garden!;
  const tool = hud.tool();
  busyHeading = heading;
  player.heading = heading;
  const empty = bed.stage === 0;
  const ripe = bed.stage === 3;
  const thirsty = g.needsWater(bed);
  if (tool === 'hammer') { hud.toast('Hammer', 'Building and fixing things comes later!', 'mochi_think', 3); return; }
  if ((tool === 'hand' || tool === 'seeds') && empty) {
    hud.choose('What shall we plant?', CROP_IDS.map((c) => ({ id: c, icon: `crop_${c}`, label: CROPS[c].name })), (id) => {
      if (!id) return;
      // two puffs of dirt while Mochi digs
      fx.play('dig', ...bedTop(bed), { delay: 0.25 });
      fx.play('dig', ...bedTop(bed), { delay: 1.0, flip: true });
      startBusy('dig', 1.8, () => { g.plant(bed, id as Crop); saveNow(); });
    });
    return;
  }
  if ((tool === 'hand' || tool === 'water') && thirsty) {
    fx.play('water', ...bedTop(bed), { delay: 0.15, repeat: 3 });
    startBusy('work', 1.8, () => { g.water(bed); saveNow(); });
    return;
  }
  if ((tool === 'hand' || tool === 'basket') && ripe) {
    startBusy('interact', 1.5, () => {
      const crop = g.harvest(bed);
      if (!crop) return;
      const c = CROPS[crop];
      fx.play('harvest', ...bedTop(bed));
      fx.pop('sun', bed.x, groundHeight(bed.x, bed.z) + 0.9, bed.z, 2);
      hud.add('sun', c.sun);
      harvested++;
      hud.quest({ id: 'garden', count: Math.min(harvested, HARVEST_GOAL), done: harvested >= HARVEST_GOAL });
      if (harvested === HARVEST_GOAL) {
        hud.add('leaves', 1);
        celebrate(true);
        hud.toast('What a gardener!', `${HARVEST_GOAL} crops picked. +1 Golden Leaf`, 'mochi_proud', 5);
      } else hud.toast(`${c.plural} picked!`, `+${c.sun} Sun Points`, `crop_${crop}`, 3);
      startBusy('happy_bounce', 1.2, null);
      saveNow();
    });
    return;
  }
  // this tool can't help here: say what the bed needs
  if (empty) hud.toast('Nothing planted yet', 'Use the seeds (3) or your hand (1) to plant something.', 'tool_seeds', 3.5);
  else if (thirsty) hud.toast('This plant is thirsty', 'Use the watering can (2) or your hand (1).', 'tool_water', 3.5);
  else if (ripe) hud.toast('Ready to pick!', 'Use the basket (5) or your hand (1).', 'tool_basket', 3.5);
  else hud.toast('Growing…', `The ${CROPS[bed.crop!].name.toLowerCase()} is growing. Come back soon!`, `crop_${bed.crop}`, 3);
}

canvas.addEventListener('pointerdown', (e) => {
  if (debugState.freeCam) return; // debug free camera: taps and drags move the view, Mochi stays put
  const ndc = new THREE.Vector2((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObject(ground.mesh)[0];
  if (hud.choosing()) hud.closeChooser();
  if (busy > 0) return;
  const bed = garden && viewH < WHOLE_VIEW - 1 && !debugState.tapTeleport ? garden.pick(ndc, camera, hit?.point ?? null) : null;
  if (bed) {
    goTend(bed);
    return;
  }
  if (!hit) return;
  task = null;
  if (debugState.tapTeleport) {
    player.x = hit.point.x;
    player.z = hit.point.z;
    player.path = [];
    return;
  }
  const path = findPath(player.x, player.z, hit.point.x, hit.point.z);
  if (!path || !path.length) return;
  player.path = path;
  const last = path[path.length - 1];
  const dist = Math.hypot(last.x - player.x, last.y - player.z);
  player.running = dist > 5;
  tapRing.position.set(last.x, standHeight(last.x, last.y) + 0.05, last.y);
  tapRing.visible = true;
  tapT = 0;
});

// speeds from clips_index.csv (model units/s at 1x), converted to world units
const WALK_TS = 1.7;
function walkSpeed() { return 0.5 * modelScale * WALK_TS; }
function runSpeed() { return 1.8 * modelScale; }

function updatePlayer(dt: number) {
  // keyboard: W/A/S/D move in screen directions
  let kx = 0;
  let kz = 0;
  if (keys.has('w') || keys.has('arrowup')) { kx -= 1; kz -= 1; }
  if (keys.has('s') || keys.has('arrowdown')) { kx += 1; kz += 1; }
  if (keys.has('a') || keys.has('arrowleft')) { kx -= 1; kz += 1; }
  if (keys.has('d') || keys.has('arrowright')) { kx += 1; kz -= 1; }
  let moving = false;
  let speed = walkSpeed();
  if (busy > 0) {
    // digging, watering or picking: stand still facing the bed
    busy -= dt;
    player.heading = busyHeading;
    if (busy <= 0) {
      busy = 0;
      const done = busyDone;
      busyDone = null;
      done?.();
    }
    kx = kz = 0;
  }
  if (busy > 0) {
    // (keys and taps wait until the action is finished)
  } else if (kx || kz) {
    player.path = [];
    task = null;
    const l = Math.hypot(kx, kz);
    const nx = player.x + (kx / l) * speed * dt;
    const nz = player.z + (kz / l) * speed * dt;
    const hNow = standHeight(player.x, player.z);
    const ok = (x: number, z: number) => walkable(x, z) && Math.abs(standHeight(x, z) - hNow) < 0.45;
    if (ok(nx, nz)) { player.x = nx; player.z = nz; }
    else if (ok(nx, player.z)) player.x = nx;
    else if (ok(player.x, nz)) player.z = nz;
    player.heading = Math.atan2(kx, kz);
    moving = true;
  } else if (player.path.length) {
    speed = player.running ? runSpeed() : walkSpeed();
    const next = player.path[0];
    const dx = next.x - player.x;
    const dz = next.y - player.z;
    const d = Math.hypot(dx, dz);
    const stepLen = speed * dt;
    if (d <= stepLen) {
      player.x = next.x;
      player.z = next.y;
      player.path.shift();
      if (player.path.length < 3) player.running = false;
      if (!player.path.length && task) {
        const t = task;
        task = null;
        tend(t.bed, t.heading);
      }
    } else {
      player.x += (dx / d) * stepLen;
      player.z += (dz / d) * stepLen;
    }
    if (d > 0.01) {
      const want = Math.atan2(dx, dz);
      let diff = want - player.heading;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      player.heading += diff * Math.min(1, dt * 12);
    }
    moving = true;
  }
  if (busy > 0) { /* the action's own clip keeps playing */ }
  else if (moving) play(player.running && player.path.length ? 'run' : 'walk', player.running && player.path.length ? 1 : WALK_TS);
  else play('idle');
  const y = standHeight(player.x, player.z);
  // little dust puffs kicked up behind him while he runs (not on wooden bridges and boardwalks)
  dustT -= dt;
  if (moving && busy <= 0 && player.running && player.path.length && dustT <= 0) {
    dustT = 0.2;
    if (!onBridge(player.x, player.z) && !onBoardwalk(player.x, player.z)) {
      const back = 0.42 + Math.random() * 0.1;
      const side = (Math.random() - 0.5) * 0.3;
      const sx = Math.sin(player.heading);
      const sz = Math.cos(player.heading);
      fx.play('dust', player.x - sx * back + sz * side, y, player.z - sz * back - sx * side, { shift: 0.05, size: 0.5 + Math.random() * 0.2, flip: Math.random() < 0.5 });
    }
  }
  mochi.position.set(player.x, y, player.z);
  mochiCenter.copy(mochi.position);
  // On a deck he is drawn as if standing a little further back, so the front railing picture always covers
  // his feet across his whole body (never half in front of it and half behind).
  if (onBridge(player.x, player.z)) {
    mochiCenter.x -= 0.45;
    mochiCenter.z -= 0.45;
  }
  // On a bridge Mochi always faces along the deck: turned sideways, his body poked out past the
  // painted front railing and looked cut in half by the bridge picture.
  let face = player.heading;
  const on = bridgeAt(player.x, player.z);
  if (on && Math.abs(on.off) < DECK_HALF) {
    const along = on.b.axis === 'z' ? 0 : Math.PI / 2;
    face = Math.cos(player.heading - along) >= 0 ? along : along + Math.PI;
  }
  let turn = face - mochi.rotation.y;
  turn = Math.atan2(Math.sin(turn), Math.cos(turn));
  mochi.rotation.y += turn * Math.min(1, dt * 14);
}

// ---------------------------------------------------------------------------
// HUD bits
// ---------------------------------------------------------------------------
const fpsEl = document.getElementById('fps')!;
const compare = document.getElementById('compare') as HTMLImageElement;
// the target picture is 2.3 MB: only fetched the first time Compare is pressed (faster start, phone link)
document.getElementById('btn-compare')!.addEventListener('click', () => {
  if (!compare.src) compare.src = 'target.png';
  compare.classList.toggle('on');
});
// Full screen (hides the browser's address bar and buttons). Phones that can't do it don't show the button.
const fullBtn = document.getElementById('btn-full') as HTMLButtonElement;
if (!document.fullscreenEnabled) fullBtn.style.display = 'none';
fullBtn.addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
});
document.addEventListener('fullscreenchange', () => {
  const on = !!document.fullscreenElement;
  (fullBtn.querySelector('img') as HTMLImageElement).src = on ? 'ui/btn_full_exit.webp' : 'ui/btn_full.webp';
  fullBtn.title = on ? 'Leave full screen' : 'Full screen';
});

function zoom(dir: 1 | -1) {
  if (dir > 0) viewH = Math.max(6, viewH - 1.5);
  else viewH = Math.min(WHOLE_VIEW, viewH < 20 ? viewH + 1.5 : viewH + 8);
  resize();
}
/** The map tool / tapping the mini-map: whole map, and back to where you were. */
let viewBeforeMap = 11;
function toggleWholeMap(on = viewH < WHOLE_VIEW - 1) {
  if (on) { viewBeforeMap = viewH; viewH = WHOLE_VIEW; }
  else viewH = viewBeforeMap < WHOLE_VIEW - 1 ? viewBeforeMap : 11;
  resize();
  if (hud.tool() === 'map' && !on) hud.selectTool('hand');
  else if (on && hud.tool() !== 'map') hud.selectTool('map');
}

const hud = MAP_KEY ? createHud({ name: MAP_NAMES[MAP_KEY][0], blurb: MAP_NAMES[MAP_KEY][1] })
  : createHud({ name: 'Sunny Meadow', blurb: 'A peaceful valley for capybaras and friends' });
let duckUpdate: ((dt: number, time: number, player: { x: number; z: number }, viewH: number) => void) | null = null;
let minimapUpdate: ((now: number) => void) | null = null;

let frames = 0;
let fpsT = 0;
let last = performance.now();
let time = 0;

let backdropUpdate: ((time: number) => void) | null = null;
/** sky behind the mountains, used only when zoomed out (close up the plain green costs nothing to draw) */
let skyTex: THREE.Texture | null = null;
const meadowGreen = scene.background;

async function start() {
  const status = document.getElementById('loading-status')!;
  fx.init(scene);
  let dmap: DesignedWorld | null = null;
  if (MAP_KEY) {
    status.textContent = 'Opening the map…';
    const r = await fetch(`maps/${MAP_KEY}.json`);
    if (!r.ok) throw new Error(`could not load the map ${MAP_KEY}`);
    dmap = useDesignedMap(await r.json());
    scene.background = new THREE.Color(0x63c3d4); // the sea, out past the edge of the island
  }
  falls = FALLS.map((f) => buildWaterfall(noiseTex, f));
  status.textContent = 'Painting the ground…';
  const textures = await loadGroundTextures();
  ground = buildGround(noiseTex, sun, textures);
  scene.add(ground.mesh);
  const water = buildWater(ground, noiseTex, falls.map((f) => f.base));
  waterMat = water.material;
  scene.add(water.object);
  if (dmap) {
    await startDesigned(dmap, status);
    return;
  }
  scene.add(buildStoneWalls(noiseTex).stones); // the stone steps
  // painted mountains and clouds along the two back edges (?nobackdrop = without, to compare)
  const backdropP = MOUNTAINS_ON || params.has('nobackdrop') ? null : buildBackdrop();
  // old 3D mountains and clouds: off unless ?mountains
  if (MOUNTAINS_ON) {
    const mountains = buildMountains(sun, { rock: textures.stone, grass: textures.grass, grassScale: textures.grassScale });
    mountainMat = (mountains.children[0].children[0] as THREE.Mesh).material as THREE.ShaderMaterial;
    scene.add(mountains);
    scene.add(clouds.group);
  }
  status.textContent = 'Placing trees and flowers…';
  await placeScene(scene, noiseTex);
  if (backdropP) {
    const backdrop = await backdropP;
    scene.add(backdrop.group);
    backdropUpdate = backdrop.update;
    skyTex = skyTexture();
  }
  emitter(new THREE.Vector3(falls[0].base.x + 0.2, WATER + 0.1, falls[0].base.z), 9, 1.2, 0.45, 1.0, 0.55);
  emitter(new THREE.Vector3(falls[1].base.x, POOL_WATER + 0.1, falls[1].base.z + 0.2), 7, 1.1, 0.4, 0.9, 0.5);
  emitter(new THREE.Vector3(falls[2].base.x + 0.2, WATER + 0.1, falls[2].base.z), 7, 1.0, 0.45, 0.9, 0.5);
  status.textContent = 'Waking up Mochi…';
  await loadMochi();
  buildNav();
  garden = await createGarden(scene, { growSecs: GROW_SECS });
  status.textContent = 'Finding Mama Duck…';
  const ducks = await loadDucks(scene, { standHeight, isWater: (x, z) => kindAt(x, z) === 'river' }, {
    found(n, total) {
      hud.add('sun', 10);
      hud.quest({ id: 'ducks', count: n, total, done: n === total });
      if (n === 1) hud.toast('A lost duckling!', 'It is sad and misses its mama. Lead it to Mama Duck on the lake.', 'duckling_sad', 5);
      else if (n === total) hud.toast('That was the last one!', 'Bring them all to Mama Duck on the lake.', 'duckling_call');
      else hud.toast('Another lost duckling!', `${n} of ${total} found. It will follow you.`, n % 2 ? 'duckling_sad' : 'duckling_call');
      saveNow();
    },
    home(n, total) {
      hud.add('sun', 25);
      hud.quest({ id: 'home', count: n, total, text: 'Bring them home to Mama', done: n === total });
      if (n === total) {
        hud.quest({ id: 'ducks', done: true });
        hud.add('hearts', 1);
        hud.add('leaves', 1);
        celebrate(true);
        hud.toast('The duck family is together!', 'Mama Duck is so happy. +1 Friendship, +1 Golden Leaf', 'duck_family', 7);
      } else hud.toast('Back with Mama!', `${n} of ${total} ducklings are home.`, n === 1 ? 'mama_happy' : 'duckling_happy');
      saveNow();
    },
  });
  duckUpdate = ducks.update;
  // round mini-map: the ground picture comes from what the ground builder already worked out
  const sample = (x: number, z: number) => {
    const i = Math.max(0, Math.min(ground.nx, Math.round((x + PAD) * RES)));
    const j = Math.max(0, Math.min(ground.nz, Math.round((z + PAD) * RES)));
    const k = j * (ground.nx + 1) + i;
    return { kind: ground.kinds[k], h: ground.heights[k], path: ground.path[k], plaza: ground.pave[k] > 0.5 };
  };
  const minimap = createMinimap({ mapW: MAP_W, mapD: MAP_D, sample }, () => toggleWholeMap(), zoom);
  minimapUpdate = (now: number) => minimap.update(now, () => {
    const st = ducks.status();
    return { player, ducklings: st.ducklings, mama: st.mama };
  });
  // tool bar: the hand walks and picks things up; the others come with gardening; the map shows everything
  hud.tools([
    ['hand', 'tool_hand', 'Hand'], ['water', 'tool_water', 'Watering can'], ['seeds', 'tool_seeds', 'Seeds'],
    ['hammer', 'tool_hammer', 'Hammer'], ['basket', 'tool_basket', 'Basket'], ['map', 'tool_map', 'Map'],
  ], (id) => {
    if (id === 'map') { if (viewH < WHOLE_VIEW - 1) toggleWholeMap(true); }
    else if (viewH >= WHOLE_VIEW - 1) toggleWholeMap(false);
  });
  hud.quest({ id: 'ducks', icon: 'pin_duckling', text: `Find Mama Duck's lost ducklings`, sub: 'Look for the duckling pins', count: 0, total: ducks.total });
  hud.quest({ id: 'home', icon: 'duck_family', text: 'Bring them home to Mama', sub: 'She waits on the lake', count: 0, total: ducks.total });
  hud.quest({ id: 'garden', icon: 'crop_carrot', text: 'Grow and harvest crops', sub: 'The garden is next to the plaza', count: 0, total: HARVEST_GOAL });
  document.getElementById('loading')!.classList.add('done');
  void setupSaving(ducks); // shows Continue / New game when there is a save
  setupDebug({
    scene, player, navOK: () => navOK, navSize: { w: gw, d: gd, per: NAV }, findPath, groundHeight, kindAt,
    snapCamera: () => { camTarget.x = player.x; camTarget.z = player.z; },
    camAt: () => [camTarget.x, camTarget.z],
    setView: (v: number) => { viewH = v; resize(); },
    getView: () => viewH,
    wholeView: WHOLE_VIEW,
    grassNames: GRASS.map((g) => g[0]),
    getGrass: () => grassPick,
    setGrass,
    getGrade: () => gradeOn,
    setGrade: (on: boolean) => { setGrade(on); refreshMaterials(scene); },
  }, params.has('debug'));
  (window as unknown as Record<string, unknown>).capy = { scene, camera, renderer, player, walkable, findPath, groundHeight, kindAt, ducks: ducks.status, garden, save: () => saveNow(), readSave, tend: (i: number) => garden && goTend(garden.beds[i]), busy: () => busy, navOK: () => navOK, setView: (v: number) => { viewH = v; resize(); }, fx, celebrate, hud };
  requestAnimationFrame(loop);
}

/** New game / Continue / Start over, and saving by itself. ?nosave = never read or write the save (tests). */
async function setupSaving(ducks: Awaited<ReturnType<typeof loadDucks>>) {
  const snapshot = (): SaveData => ({
    v: 1,
    savedAt: Date.now(),
    player: { x: player.x, z: player.z, heading: player.heading },
    counters: { sun: hud.get('sun'), hearts: hud.get('hearts'), leaves: hud.get('leaves') },
    harvested,
    garden: garden!.state(),
    ducks: ducks.save(),
  });
  const fresh = snapshot(); // how a new game starts
  let saving = false;
  saveNow = () => { if (saving) writeSave(snapshot()); };
  setInterval(saveNow, 5000);
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveNow(); });
  window.addEventListener('pagehide', () => saveNow());

  /** Put the whole game back as it was in a save (or as a new game). Returns how many plants grew meanwhile. */
  const apply = (d: SaveData, timeAway: boolean): number => {
    task = null;
    busy = 0;
    busyDone = null;
    player.path = [];
    hud.closeChooser();
    if (viewH >= WHOLE_VIEW - 1) toggleWholeMap(false);
    const okSpot = walkable(d.player.x, d.player.z);
    player.x = okSpot ? d.player.x : fresh.player.x;
    player.z = okSpot ? d.player.z : fresh.player.z;
    player.heading = d.player.heading || 0;
    camTarget.set(player.x, MEADOW, player.z);
    hud.set('sun', d.counters.sun || 0);
    hud.set('hearts', d.counters.hearts || 0);
    hud.set('leaves', d.counters.leaves || 0);
    harvested = d.harvested || 0;
    hud.quest({ id: 'garden', count: Math.min(harvested, HARVEST_GOAL), done: harvested >= HARVEST_GOAL });
    // watered plants keep growing while you're away (one step each: they need water again after that)
    const away = timeAway ? Math.max(0, (Date.now() - d.savedAt) / 1000) : 0;
    let grew = 0;
    const beds: BedState[] = d.garden.map((b) => {
      const crop = b.crop && CROP_IDS.includes(b.crop) ? b.crop : null;
      const st: BedState = { crop, stage: crop ? Math.max(1, Math.min(3, b.stage | 0)) : 0, wet: !!b.wet && !!crop, grow: Number(b.grow) || 0 };
      if (st.wet && st.stage < 3 && st.grow + away >= GROW_SECS) { st.stage++; st.wet = false; st.grow = 0; grew++; }
      else if (st.wet) st.grow += away;
      return st;
    });
    garden!.load(beds);
    ducks.load(d.ducks, player);
    const st = ducks.status();
    hud.quest({ id: 'ducks', count: st.found, done: st.found === st.total });
    hud.quest({ id: 'home', count: st.home, done: st.home === st.total });
    return grew;
  };
  const newGame = () => {
    apply(fresh, false);
    clearSave();
    saving = !params.has('nosave');
    saveNow();
    // the story starts: Mama Duck asks for help
    setTimeout(() => hud.toast('Mama Duck', `Oh no! My ${ducks.total} little ducklings wandered off. Can you help me find them?`, 'mama_sad', 7), 1200);
  };
  const askStartOver = async (): Promise<boolean> => (await hud.dialog('Start over?',
    'The garden, the ducklings and all your points go back to the very beginning.', 'mochi_surprised',
    [{ id: 'yes', label: 'Yes, start over', style: 'warn' }, { id: 'no', label: 'No, keep my game', style: 'plain' }])) === 'yes';

  // Menu button (top right): keep playing or start over
  document.getElementById('btn-menu')!.addEventListener('click', async () => {
    if (hud.dialogOpen()) return;
    const pick = await hud.dialog('Menu', 'Your game saves by itself, so you can stop any time.', 'mochi_happy',
      [{ id: 'play', label: 'Keep playing' }, { id: 'over', label: 'Start over', style: 'plain' }]);
    if (pick === 'over' && await askStartOver()) newGame();
  });

  const saved = params.has('nosave') ? null : readSave();
  if (!saved) { newGame(); return; }
  const home = saved.ducks.chicks.filter((c) => c === 'home').length;
  const growing = saved.garden.filter((b) => b.crop).length;
  for (;;) {
    const pick = await hud.dialog('Welcome back!',
      `<img src="ui/icon_sun.webp" alt=""> ${saved.counters.sun} Sun Points · ${home} of ${ducks.total} ducklings home · ${growing} ${growing === 1 ? 'plant' : 'plants'} in the garden<br><small>Saved ${agoText(saved.savedAt)}</small>`,
      'mochi_happy', [{ id: 'continue', label: 'Continue' }, { id: 'new', label: 'New game', style: 'plain' }]);
    if (pick === 'continue') {
      const grew = apply(saved, true);
      saving = true;
      saveNow();
      hud.toast('Welcome back!', grew ? 'Your plants grew while you were away. Go and see!' : 'Your game is just as you left it.', grew ? 'crop_carrot' : 'mochi_happy', 5);
      return;
    }
    if (await askStartOver()) { newGame(); return; }
  }
}

/** A designed map: its pictures, rocks and waterfalls, then Mochi at the entrance. Just walking around for now. */
async function startDesigned(dmap: DesignedWorld, status: HTMLElement) {
  status.textContent = 'Placing trees and flowers…';
  const mist = await placeDesigned(scene, noiseTex);
  for (const b of mist.slice(0, 10)) emitter(b, 6, 1.0, 0.45, 0.9, 0.5);
  status.textContent = 'Waking up Mochi…';
  await loadMochi();
  buildNav();
  // start at the map's entrance (the nearest square Mochi can stand on)
  const [sx, sz] = dmap.map.start;
  let best = -1;
  let bd = 1e9;
  for (let k = 0; k < navOK.length; k++) {
    if (!navOK[k]) continue;
    const d = Math.hypot((k % gw + 0.5) / NAV - sx, (Math.floor(k / gw) + 0.5) / NAV - sz);
    if (d < bd) { bd = d; best = k; }
  }
  if (best >= 0 && !params.has('at')) {
    player.x = (best % gw + 0.5) / NAV;
    player.z = (Math.floor(best / gw) + 0.5) / NAV;
  }
  camTarget.set(player.x, MEADOW, player.z);
  const sample = (x: number, z: number) => {
    const i = Math.max(0, Math.min(ground.nx, Math.round((x + PAD) * RES)));
    const j = Math.max(0, Math.min(ground.nz, Math.round((z + PAD) * RES)));
    const k = j * (ground.nx + 1) + i;
    return { kind: ground.kinds[k], h: ground.heights[k], path: ground.path[k], plaza: ground.pave[k] > 0.5 };
  };
  const minimap = createMinimap({ mapW: MAP_W, mapD: MAP_D, sample }, () => toggleWholeMap(), zoom);
  minimapUpdate = (now: number) => minimap.update(now, () => ({ player, ducklings: [], mama: null }));
  hud.tools([['hand', 'tool_hand', 'Hand'], ['map', 'tool_map', 'Map']], (id) => {
    if (id === 'map') { if (viewH < WHOLE_VIEW - 1) toggleWholeMap(true); }
    else if (viewH >= WHOLE_VIEW - 1) toggleWholeMap(false);
  });
  hud.quest({ id: 'explore', icon: 'tool_map', text: `Explore ${dmap.map.name}`, sub: 'Tap anywhere to walk' });
  document.getElementById('loading')!.classList.add('done');
  setupDebug({
    scene, player, navOK: () => navOK, navSize: { w: gw, d: gd, per: NAV }, findPath, groundHeight, kindAt,
    snapCamera: () => { camTarget.x = player.x; camTarget.z = player.z; },
    camAt: () => [camTarget.x, camTarget.z],
    setView: (v: number) => { viewH = v; resize(); },
    getView: () => viewH,
    wholeView: WHOLE_VIEW,
    spots: (dmap.map.spots ?? []).map((s) => [s.name, s.x, s.z] as [string, number, number]),
    grassNames: GRASS.map((g) => g[0]),
    getGrass: () => grassPick,
    setGrass,
    getGrade: () => gradeOn,
    setGrade: (on: boolean) => { setGrade(on); refreshMaterials(scene); },
  }, params.has('debug'));
  (window as unknown as Record<string, unknown>).capy = { scene, camera, renderer, player, walkable, findPath, groundHeight, kindAt, designed: dmap, busy: () => busy, navOK: () => navOK, setView: (v: number) => { viewH = v; resize(); } };
  requestAnimationFrame(loop);
}

function loop(now: number) {
  const gapMs = now - last;
  const dtReal = gapMs / 1000;
  const dt = Math.min(0.05, dtReal);
  last = now;
  time += dt;
  updatePlayer(dt);
  mixer?.update(dt);
  duckUpdate?.(dt, time, player, viewH);
  garden?.update(dt, time, viewH);
  minimapUpdate?.(now);
  updatePuffs(dt);
  fx.update(dt);
  backdropUpdate?.(time);
  if (skyTex) scene.background = viewH > 16 ? skyTex : meadowGreen;
  clouds.update(time);
  waterMat.uniforms.uTime.value = time;
  for (const f of falls) (f.mesh.material as THREE.ShaderMaterial).uniforms.uTime.value = time;
  for (const m of animated) m.uniforms.uTime.value = time;
  if (tapRing.visible) {
    tapT += dt;
    tapRing.scale.setScalar(1 + tapT * 1.5);
    (tapRing.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - tapT * 1.6);
    if (tapT > 0.7) tapRing.visible = false;
  }
  // camera follows Mochi gently
  const tx = player.x;
  const tz = player.z;
  const far = Math.max(0, Math.min(1, (viewH - 20) / (WHOLE_VIEW - 20))); // 0 = follow Mochi, 1 = frame the whole map
  const aimX = tx + (MAP_W / 2 - tx) * far;
  const aimZ = tz + (MAP_D / 2 - tz) * far;
  camTarget.x += (aimX - camTarget.x) * Math.min(1, dt * 2.5);
  camTarget.z += (aimZ - camTarget.z) * Math.min(1, dt * 2.5);
  if (far === 0) {
    camTarget.x = Math.max(3, Math.min(MAP_W - 3, camTarget.x));
    camTarget.z = Math.max(3, Math.min(MAP_D - 3, camTarget.z));
  }
  if (debugState.freeCam) { camTarget.x = debugState.camX; camTarget.z = debugState.camZ; } // debug: look anywhere
  // marker over Mochi when zoomed out, so you can see where he goes
  finder.visible = viewH > 16;
  if (finder.visible) {
    const s = viewH / 22;
    finder.scale.set(0.8 * s, 1.2 * s, 1);
    finder.position.set(player.x, standHeight(player.x, player.z) + 1.4 * s + Math.sin(time * 4) * 0.15 * s, player.z);
  }
  camTarget.y = MEADOW;
  placeCamera();
  renderer.render(scene, camera);
  // measure real frame time; a long gap means the page was hidden or throttled,
  // so restart the measurement instead of treating it as a slow device
  if (gapMs > 150 || document.hidden) {
    frames = 0;
    fpsT = 0;
  } else {
    frames++;
    fpsT += dtReal;
  }
  if (fpsT >= 0.5) {
    const fps = frames / fpsT;
    fpsEl.textContent = `${Math.round(fps)} fps · ${renderer.info.render.calls} draws · ${pixelRatio.toFixed(2)}x`;
    frames = 0;
    fpsT = 0;
  }
  requestAnimationFrame(loop);
}

camTarget.set(player.x, MEADOW, player.z);
placeCamera();
start().catch((e) => {
  console.error(e);
  document.getElementById('loading-status')!.textContent = 'Error: ' + (e instanceof Error ? e.message : String(e));
});
