// ---------------------------------------------------------------------------
// The garden: eight beds that change picture as their crop grows.
// Plant → water → grows → water again → ripe → pick (Sun Points).
// Pictures: public/garden (cut from the painted beds by tools/cut_garden.py).
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { BED_HALF, GARDEN_BEDS, GARDEN_WALK_Z, groundHeight } from './world';
import { ELEV, ontoPlane } from './props';
import { fx } from './fx';

/** Empty bed picture: the stand-in cut from the crop beds, or Codex's own empty bed (?codexbed, to compare). */
const EMPTY = typeof location !== 'undefined' && new URLSearchParams(location.search).has('codexbed') ? 'bed_empty_codex' : 'bed_empty';

export type Crop = 'carrot' | 'tomato' | 'melon' | 'bamboo';
export const CROPS: Record<Crop, { name: string; plural: string; sun: number }> = {
  carrot: { name: 'Carrot', plural: 'Carrots', sun: 5 },
  tomato: { name: 'Tomato', plural: 'Tomatoes', sun: 8 },
  melon: { name: 'Watermelon', plural: 'Watermelons', sun: 12 },
  bamboo: { name: 'Bamboo shoot', plural: 'Bamboo shoots', sun: 10 },
};
export const CROP_IDS = Object.keys(CROPS) as Crop[];

/** stage 0 = empty bed, 1 = seedling, 2 = growing, 3 = ripe. A watered bed grows to the next stage. */
export interface BedState { crop: Crop | null; stage: number; wet: boolean; grow: number }
export interface Bed extends BedState { i: number; x: number; z: number; mesh: THREE.Mesh; bubble: THREE.Sprite; bubbleKey: string }

const DIAG = Math.SQRT1_2;
const WIDTH = BED_HALF * 2.75; // on-screen width of a bed picture (its painted box fills the bed's ground square)

interface Pic { u0: number; v0: number; u1: number; v1: number; aspect: number; anchor: number }

async function loadImage(src: string): Promise<HTMLImageElement> {
  const im = new Image();
  im.src = src;
  await im.decode();
  return im;
}

/** All bed pictures in one small sheet; each picture's base point = the middle of its lowest pixels. */
async function buildSheet(names: string[]) {
  const imgs = await Promise.all(names.map((n) => loadImage(`garden/${n}.png`)));
  const PAD = 4;
  const W = 2048;
  let x = PAD;
  let y = PAD;
  let rowH = 0;
  const place = imgs.map((im) => {
    if (x + im.width + PAD > W) { x = PAD; y += rowH + PAD * 2; rowH = 0; }
    const p = { x, y };
    x += im.width + PAD * 2;
    rowH = Math.max(rowH, im.height);
    return p;
  });
  const H = Math.pow(2, Math.ceil(Math.log2(y + rowH + PAD)));
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  const pics = new Map<string, Pic>();
  imgs.forEach((im, i) => {
    const { x: px, y: py } = place[i];
    g.drawImage(im, px, py);
    const d = g.getImageData(px, py, im.width, im.height).data;
    let anchor = 0.5;
    for (let row = im.height - 1; row >= 0; row--) {
      let sum = 0;
      let cnt = 0;
      for (let col = 0; col < im.width; col++) if (d[(row * im.width + col) * 4 + 3] > 100) { sum += col; cnt++; }
      if (cnt) { anchor = (sum / cnt + 0.5) / im.width; break; }
    }
    pics.set(names[i], { u0: px / W, v0: 1 - (py + im.height) / H, u1: (px + im.width) / W, v1: 1 - py / H, aspect: im.height / im.width, anchor });
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return { tex, pics };
}

/** Same look as the other pictures, plus wet soil: brown pixels go darker while the bed is watered. */
function bedMaterial(tex: THREE.Texture) {
  return new THREE.ShaderMaterial({
    transparent: true,
    side: THREE.DoubleSide,
    uniforms: { map: { value: tex } },
    vertexShader: /* glsl */ `
      attribute float aWet;
      varying vec2 vUv;
      varying float vWet;
      void main() { vUv = uv; vWet = aWet; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      varying vec2 vUv;
      varying float vWet;
      void main() {
        vec4 c = texture2D(map, vUv, -0.5);
        if (c.a < 0.08) discard;
        vec3 col = c.rgb;
        // brown = soil (the colours here are linear, so the differences are small numbers)
        float soil = smoothstep(0.03, 0.09, c.r - c.g) * smoothstep(-0.005, 0.02, c.g - c.b) * (1.0 - smoothstep(0.5, 0.75, c.r));
        col = mix(col, col * vec3(0.42, 0.4, 0.46), soil * vWet);
        gl_FragColor = vec4(col, c.a);
        #include <colorspace_fragment>
      }
    `,
  });
}

/** The two halves of a bed picture, each lying on one of the bed's two front sides (like the box pictures in props.ts). */
function bedGeometry(x: number, z: number, p: Pic, geo?: THREE.BufferGeometry): THREE.BufferGeometry {
  const right = new THREE.Vector3(DIAG, 0, -DIAG);
  const up = new THREE.Vector3(0, 1, 0);
  const h = (WIDTH * p.aspect) / Math.cos(ELEV);
  const fx = x + BED_HALF;
  const fz = z + BED_HALF;
  const baseY = groundHeight(x, z) - 0.02;
  const base = new THREE.Vector3(fx, baseY, fz);
  const l = base.clone().addScaledVector(right, -WIDTH * p.anchor);
  const r = base.clone().addScaledVector(right, WIDTH * (1 - p.anchor));
  const tl = l.clone().addScaledVector(up, h);
  const tr = r.clone().addScaledVector(up, h);
  const bt = base.clone().addScaledVector(up, h);
  const leftQ = [l, base.clone(), tl, bt.clone()];
  const rightQ = [base.clone(), r, bt.clone(), tr];
  for (const v of leftQ) ontoPlane(v, base, new THREE.Vector3(0, 0, 1));
  for (const v of rightQ) ontoPlane(v, base, new THREE.Vector3(1, 0, 0));
  const ua = p.u0;
  const um = p.u0 + (p.u1 - p.u0) * p.anchor;
  const ub = p.u1;
  const pos = [...leftQ, ...rightQ].flatMap((v) => [v.x, v.y, v.z]);
  const uv = [ua, p.v0, um, p.v0, ua, p.v1, um, p.v1, um, p.v0, ub, p.v0, um, p.v1, ub, p.v1];
  if (!geo) {
    geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('aWet', new THREE.Float32BufferAttribute(new Array(8).fill(0), 1));
    geo.setIndex([0, 1, 2, 2, 1, 3, 4, 5, 6, 6, 5, 7]);
  } else {
    (geo.attributes.position as THREE.BufferAttribute).copyArray(pos).needsUpdate = true;
    (geo.attributes.uv as THREE.BufferAttribute).copyArray(uv).needsUpdate = true;
  }
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  return geo;
}

/** A round speech bubble with a picture in it, floating over a bed. */
async function bubbleTexture(icon: string) {
  const im = await loadImage(`ui/${icon}.webp`);
  const S = 128;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S + 20;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(60,35,15,0.25)';
  g.beginPath();
  g.arc(S / 2 + 2, S / 2 + 4, S / 2 - 6, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#fff8e8';
  g.strokeStyle = '#7a4d27';
  g.lineWidth = 6;
  g.beginPath();
  g.arc(S / 2, S / 2, S / 2 - 8, 0.62 * Math.PI, 0.38 * Math.PI);
  g.lineTo(S / 2, S + 14);
  g.closePath();
  g.fill();
  g.stroke();
  const k = (S * 0.62) / Math.max(im.width, im.height);
  g.drawImage(im, S / 2 - (im.width * k) / 2, S / 2 - (im.height * k) / 2, im.width * k, im.height * k);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export interface GardenOpts {
  /** seconds a watered bed takes to grow one stage */
  growSecs: number;
}

export async function createGarden(scene: THREE.Scene, opts: GardenOpts) {
  const names = [EMPTY, ...CROP_IDS.flatMap((c) => [1, 2, 3].map((s) => `${c}_${s}`))];
  const [{ tex, pics }, ...bubbleTex] = await Promise.all([
    buildSheet(names),
    bubbleTexture('tool_water'),
    ...CROP_IDS.map((c) => bubbleTexture(`crop_${c}`)),
  ]);
  const bubbles: Record<string, THREE.Texture> = { water: bubbleTex[0] };
  CROP_IDS.forEach((c, i) => { bubbles[c] = bubbleTex[i + 1]; });
  const mat = bedMaterial(tex);
  const picOf = (b: BedState) => (b.crop && b.stage > 0 ? `${b.crop}_${b.stage}` : EMPTY);

  const beds: Bed[] = GARDEN_BEDS.map((p, i) => {
    const mesh = new THREE.Mesh(bedGeometry(p.x, p.z, pics.get(EMPTY)!), mat);
    mesh.renderOrder = 3;
    mesh.name = 'garden-bed';
    scene.add(mesh);
    const bubble = new THREE.Sprite(new THREE.SpriteMaterial({ map: bubbles.water, depthTest: false, depthWrite: false }));
    bubble.center.set(0.5, 0);
    bubble.renderOrder = 15;
    bubble.visible = false;
    scene.add(bubble);
    return { i, x: p.x, z: p.z, crop: null, stage: 0, wet: false, grow: 0, mesh, bubble, bubbleKey: '' };
  });

  const redraw = (b: Bed) => {
    bedGeometry(b.x, b.z, pics.get(picOf(b))!, b.mesh.geometry);
    const wet = b.mesh.geometry.attributes.aWet as THREE.BufferAttribute;
    (wet.array as Float32Array).fill(b.wet ? 1 : 0);
    wet.needsUpdate = true;
    const key = needsWater(b) ? 'water' : b.stage === 3 && b.crop ? b.crop : '';
    b.bubbleKey = key;
    b.bubble.visible = !!key;
    if (key) b.bubble.material.map = bubbles[key];
    // golden twinkles over a crop that is ready to pick
    fx.loop(`ripe${b.i}`, b.stage === 3 && b.crop ? 'shine' : null, b.x, groundHeight(b.x, b.z) + 0.35, b.z, { size: 0.95 });
  };
  const needsWater = (b: BedState) => (b.stage === 1 || b.stage === 2) && !b.wet;

  const set = (b: Bed, s: Partial<BedState>) => {
    Object.assign(b, s);
    redraw(b);
  };

  // the garden starts with one crop ready to pick and one that is thirsty, so both actions are easy to find
  set(beds[1], { crop: 'carrot', stage: 3 });
  set(beds[6], { crop: 'tomato', stage: 2 });
  for (const b of beds) redraw(b);

  const ray = new THREE.Raycaster();
  return {
    beds,
    /** which bed (if any) is under the tap */
    pick(ndc: THREE.Vector2, camera: THREE.Camera, groundHit: THREE.Vector3 | null): Bed | null {
      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObjects(beds.map((b) => b.mesh))[0];
      if (hit) return beds.find((b) => b.mesh === hit.object) ?? null;
      if (groundHit) for (const b of beds) if (Math.abs(groundHit.x - b.x) < BED_HALF + 0.15 && Math.abs(groundHit.z - b.z) < BED_HALF + 0.15) return b;
      return null;
    },
    /** where Mochi stands to tend a bed (on the walkway, facing it) */
    standSpot(b: Bed) {
      const z = b.z < GARDEN_WALK_Z ? GARDEN_WALK_Z - 0.2 : GARDEN_WALK_Z + 0.2;
      return { x: b.x, z, heading: b.z < GARDEN_WALK_Z ? Math.PI : 0 };
    },
    needsWater,
    plant(b: Bed, crop: Crop) { set(b, { crop, stage: 1, wet: false, grow: 0 }); },
    water(b: Bed) { set(b, { wet: true, grow: 0 }); },
    /** pick a ripe crop; returns what was picked */
    harvest(b: Bed): Crop | null {
      const crop = b.stage === 3 ? b.crop : null;
      if (crop) set(b, { crop: null, stage: 0, wet: false, grow: 0 });
      return crop;
    },
    update(dt: number, time: number, viewH: number) {
      for (const b of beds) {
        if (b.wet && b.stage > 0 && b.stage < 3) {
          b.grow += dt;
          if (b.grow >= opts.growSecs) {
            set(b, { stage: b.stage + 1, wet: false, grow: 0 });
            fx.play('sprout', b.x, groundHeight(b.x, b.z) + 0.3, b.z); // it grew: a little green pop
          }
        }
        if (b.bubble.visible) {
          // about the same size on screen at every zoom (a bit bigger when zoomed right in)
          const s = Math.min(2.2, Math.max(0.85, viewH / 10));
          b.bubble.scale.set(0.72 * s, 0.72 * s * (148 / 128), 1);
          b.bubble.position.set(b.x, groundHeight(b.x, b.z) + 1.15 + Math.sin(time * 3 + b.i) * 0.07, b.z);
        }
      }
    },
    state(): BedState[] { return beds.map(({ crop, stage, wet, grow }) => ({ crop, stage, wet, grow })); },
    load(s: BedState[]) { s.forEach((st, i) => beds[i] && set(beds[i], st)); },
  };
}
export type Garden = Awaited<ReturnType<typeof createGarden>>;
