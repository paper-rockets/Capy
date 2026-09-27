import * as THREE from 'three';
import { MAP_D, MAP_W, PAD, groundHeight } from './world';
import { ELEV } from './props';
import { rng } from './noise';

// ---------------------------------------------------------------------------
// The two back edges of the meadow: painted mountains standing in the mist (Codex Round 7, M1),
// in two rows (the back row bigger and hazier), and painted clouds (M2) drifting slowly in front.
// Scenery only. One picture (public/backdrop/sheet.webp, packed by tools/cut_round7.py) and two
// draws: the mountains never move, the clouds' corners are moved a little every frame.
// Their misty feet hide the straight line where the ground ends.
// ---------------------------------------------------------------------------

interface SheetPic { x: number; y: number; w: number; h: number; anchor: number }
interface Sheet { w: number; h: number; pictures: Record<string, SheetPic> }

const DIAG = Math.SQRT1_2;
const RIGHT = new THREE.Vector3(DIAG, 0, -DIAG);
/** the forest border's last ring of pines stands 5.8 behind the edges: the mountains start just behind it */
const FRONT_ROW = 6.9;
const BACK_ROW = 15;

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
/** ground height at the nearest point of the map (the border ground carries the edge's height outwards) */
const edgeHeight = (x: number, z: number) => groundHeight(clamp(x, 0.05, MAP_W - 0.05), clamp(z, 0.05, MAP_D - 0.05));

/** A point `s` units along the L-shaped line `off` behind the two back edges: from past the right-hand
 *  corner, along the back of the map to the far corner, then down the left-hand side. */
function onBackLine(off: number, s: number): { x: number; z: number; side: 'z' | 'x' } {
  const lenA = MAP_W + PAD + 3 + off;
  if (s < lenA) return { x: MAP_W + PAD + 3 - s, z: -off, side: 'z' };
  return { x: -off, z: -off + (s - lenA), side: 'x' };
}
const backLineLength = (off: number) => MAP_W + MAP_D + (PAD + 3 + off) * 2;

class Quads {
  pos: number[] = [];
  uv: number[] = [];
  haze: number[] = [];
  idx: number[] = [];
  keys: number[] = [];
  add(corners: THREE.Vector3[], p: SheetPic, sheet: Sheet, flip: boolean, haze: number) {
    const b = this.pos.length / 3;
    for (const v of corners) this.pos.push(v.x, v.y, v.z);
    let u0 = p.x / sheet.w;
    let u1 = (p.x + p.w) / sheet.w;
    if (flip) [u0, u1] = [u1, u0];
    const v0 = 1 - (p.y + p.h) / sheet.h;
    const v1 = 1 - p.y / sheet.h;
    this.uv.push(u0, v0, u1, v0, u0, v1, u1, v1);
    this.haze.push(haze, haze, haze, haze);
    this.idx.push(b, b + 1, b + 2, b + 2, b + 1, b + 3);
  }
  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aHaze', new THREE.Float32BufferAttribute(this.haze, 1));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

/** The four corners of a standing picture (bottom-left, bottom-right, top-left, top-right), facing the camera like the trees. */
function standing(x: number, y: number, z: number, width: number, p: SheetPic, flip: boolean): THREE.Vector3[] {
  const h = (width * p.h) / p.w / Math.cos(ELEV);
  const anchor = flip ? 1 - p.anchor : p.anchor;
  const base = new THREE.Vector3(x, y, z);
  const l = base.clone().addScaledVector(RIGHT, -width * anchor);
  const r = base.clone().addScaledVector(RIGHT, width * (1 - anchor));
  return [l, r, l.clone().setY(y + h), r.clone().setY(y + h)];
}

function material(tex: THREE.Texture, depthTest: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest,
    uniforms: { map: { value: tex }, uHaze: { value: new THREE.Color(0xd6ecef) } },
    vertexShader: /* glsl */ `
      attribute float aHaze;
      varying vec2 vUv;
      varying float vHaze;
      void main() { vUv = uv; vHaze = aHaze; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      uniform vec3 uHaze;
      varying vec2 vUv;
      varying float vHaze;
      void main() {
        vec4 c = texture2D(map, vUv);
        if (c.a < 0.02) discard;
        // further away = paler and bluer, like distant hills in the painted art
        gl_FragColor = vec4(mix(c.rgb, uHaze, vHaze), c.a);
        #include <colorspace_fragment>
      }
    `,
  });
}

export interface Backdrop { group: THREE.Group; update(time: number): void }

/** Sky for the zoomed-out views: pale blue at the top of the screen, fading into the meadow green lower down.
 *  (Close up the ground fills the screen, so the plain green clear colour is used there: no extra drawing.) */
export function skyTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 256;
  const g = c.getContext('2d')!;
  // (these go through the colour boost like everything else: worked out so they come out as
  // sky #8ecfe8 → haze #cfe9ee → the old meadow green #7fae4a at the bottom)
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, '#8fb5c8');
  grd.addColorStop(0.2, '#acc5d4');
  grd.addColorStop(0.34, '#c0d1d9');
  grd.addColorStop(0.46, '#a7bba1');
  grd.addColorStop(0.62, '#859f71');
  grd.addColorStop(1, '#799464');
  g.fillStyle = grd;
  g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export async function buildBackdrop(): Promise<Backdrop> {
  const [sheet, tex] = await Promise.all([
    fetch('backdrop/sheet.json').then((r) => r.json() as Promise<Sheet>),
    new THREE.TextureLoader().loadAsync('backdrop/sheet.webp'),
  ]);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  const R = rng(4711);
  const group = new THREE.Group();
  group.name = 'backdrop';

  // --- mountains: two rows along the L behind the back edges
  // m0 tall spire, m1 spire pair, m2 wide hill, m3 big cluster, m4 spire with a waterfall, m5 round hill.
  // m2 and m5 were sliced on their left side (faded out in the cut): they are turned so the next picture drawn covers it.
  const SLICED = new Set(['m2', 'm5']);
  const pick = (last: string, weights: Record<string, number>) => {
    for (;;) {
      let r = R() * Object.values(weights).reduce((a, b) => a + b, 0);
      for (const [name, w] of Object.entries(weights)) {
        r -= w;
        if (r <= 0) {
          if (name !== last) return name;
          break;
        }
      }
    }
  };
  const items: { key: number; corners: THREE.Vector3[]; p: SheetPic; flip: boolean; haze: number }[] = [];
  const row = (off: number, pxPerUnit: number, sink: number, haze: number, weights: Record<string, number>) => {
    let last = '';
    for (let s = -4 + R() * 3; s < backLineLength(off) + 4;) {
      const name = pick(last, weights);
      last = name;
      const p = sheet.pictures[name];
      const width = (p.w / pxPerUnit) * (0.8 + R() * 0.45);
      const at = onBackLine(off + (R() - 0.5) * 2.2, s);
      // a sliced mountain's cut must end up on the side the next picture covers
      // (along the far edge the right-hand neighbour is drawn later, along the left edge the left-hand one)
      const flip = SLICED.has(name) ? at.side === 'z' : R() < 0.5;
      const y = edgeHeight(at.x, at.z) - sink;
      items.push({ key: at.x + at.z, corners: standing(at.x, y, at.z, width, p, flip), p, flip, haze });
      s += width * (0.5 + R() * 0.15);
    }
  };
  // back row: big peaks towering behind; front row: mostly wide, low hills so it doesn't look like a fence
  row(BACK_ROW, 24, 2.2, 0.38, { m0: 1.2, m1: 2, m2: 1, m3: 3, m4: 1, m5: 1 });
  row(FRONT_ROW, 50, 0.7, 0, { m0: 0.5, m1: 1, m2: 2.5, m3: 1.6, m4: 0.4, m5: 2.5 });
  items.sort((a, b) => a.key - b.key); // back to front
  const mq = new Quads();
  for (const it of items) mq.add(it.corners, it.p, sheet, it.flip, it.haze);
  const mountains = new THREE.Mesh(mq.geometry(), material(tex, true));
  mountains.renderOrder = 1; // before the trees and bushes, which stand in front
  mountains.name = 'mountains';
  group.add(mountains);

  // --- clouds: drifting slowly along the edges in front of the mountains' feet
  const cloudNames = Object.keys(sheet.pictures).filter((n) => n.startsWith('c'));
  const clouds: { s: number; off: number; y: number; width: number; p: SheetPic; flip: boolean; speed: number; phase: number }[] = [];
  const total = backLineLength(5);
  const N = 16;
  for (let i = 0; i < N; i++) {
    const p = sheet.pictures[cloudNames[Math.floor(R() * cloudNames.length)]];
    clouds.push({
      s: ((i + 0.2 + R() * 0.6) / N) * total,
      off: 4.4 + R() * 1.8,
      y: 1.6 + R() * 2.6,
      width: (p.w / 58) * (0.8 + R() * 0.4),
      p,
      flip: R() < 0.5,
      speed: 0.05 + R() * 0.07,
      phase: R() * 6.28,
    });
  }
  const cq = new Quads();
  const placeCloud = (c: (typeof clouds)[number], t: number) => {
    const at = onBackLine(c.off, c.s + Math.sin(t * c.speed + c.phase) * 2.5);
    return standing(at.x, edgeHeight(at.x, at.z) + c.y + Math.sin(t * 0.13 + c.phase) * 0.15, at.z, c.width, c.p, c.flip);
  };
  for (const c of clouds) cq.add(placeCloud(c, 0), c.p, sheet, c.flip, 0);
  const cloudGeo = cq.geometry();
  const cloudMesh = new THREE.Mesh(cloudGeo, material(tex, true));
  cloudMesh.renderOrder = 4; // after the trees: pines in front hide them, pines behind are misted over
  cloudMesh.frustumCulled = false;
  cloudMesh.name = 'clouds';
  group.add(cloudMesh);

  const pos = cloudGeo.attributes.position as THREE.BufferAttribute;
  let lastT = -1;
  return {
    group,
    update(time: number) {
      // clouds barely move: ten updates a second are plenty
      if (Math.abs(time - lastT) < 0.1) return;
      lastT = time;
      clouds.forEach((c, i) => {
        placeCloud(c, time).forEach((v, k) => pos.setXYZ(i * 4 + k, v.x, v.y, v.z));
      });
      pos.needsUpdate = true;
    },
  };
}
