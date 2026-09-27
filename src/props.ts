import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  BOARDWALKS, BOARD_HALF, BOARD_Y, BRIDGES, FALLS, type Fall, GARDEN, GARDEN_BEDS, GARDEN_GATE, LAKE_ISLANDS, MAP_D, MAP_W, MEADOW, PATHS, SPRING, STREAMS, TERRACE, WATER, inLake, inMarsh,
  cellKind, groundHeight, isPlaza, isWet, kindAt, lineDist, pathMask, riverDistance,
} from './world';
import { fbm, rng } from './noise';
import { splitIntoChunks } from './chunks';
import { MOUNTAINS_ON, mountainHeight, pastBackEdge } from './mountains';

// True isometric: the painted art has ground lines at 30 degrees on screen = camera looking down 35.26 degrees.
export const ELEV = Math.atan(1 / Math.SQRT2);
const DIAG = Math.SQRT1_2;
const CAM_DIR = new THREE.Vector3(Math.cos(ELEV) * DIAG, Math.sin(ELEV), Math.cos(ELEV) * DIAG);

/** Things the player cannot walk through: circles on the ground. */
export const blockers: { x: number; z: number; r: number }[] = [];

interface SpriteOpts {
  width: number; // on-screen width in world units
  r?: number; // footprint radius: the picture stands at the front edge of it
  flip?: boolean;
  block?: number; // blocking radius, 0 = walk-through
  y?: number; // fixed base height instead of the ground under (x, z)
  /** lies over the ground and is always under the player (bridges) */
  decal?: boolean;
  /** offset from (x, z) to the object's front-most ground point, for long footprints like bridges */
  front?: [number, number];
  /** long objects (fences): ground line a→b; in-front/behind follows this line */
  line?: [number, number, number, number];
  /** boxy objects (crop beds): half sizes on x and z; in-front/behind follows the two front sides */
  box?: [number, number];
  shadow?: number; // soft contact shadow size, 0 = none
  /** where along the width the picture's base point is (0..1, before flipping); default = its lowest pixels */
  anchor?: number;
  cast?: number; // sun shadow length relative to the picture height, 0 = none
  /** tilt the picture's lines up/down on screen without leaning its uprights: screen rise per unit across */
  shear?: number;
  /** painted water to animate: ring = where ripples start, stream = [u, vTop, vBottom, halfWidth] (picture coords, v up) */
  water?: { ring: [number, number]; stream?: [number, number, number, number] };
}

/** From the middle of a bridge deck to its front railing (the railing card stands on this line). */
export const BRIDGE_RAIL = 0.62;
// The painted wooden bridge (f02, 355 x 244 px): the middle of its walking deck at the front end and at the back
// end, in picture pixels (y down), measured on the picture. The painting's deck is flatter than the game's view
// (about 19 degrees instead of 30), so the picture is sheared up/down a little to lie along the real deck.
const F02 = { w: 355, h: 244, front: [97, 150], back: [274, 90] } as const;

/** Size and place the painted bridge so its deck ends sit on the two banks at deck height. */
export function bridgeFit(b: { x: number; z: number; axis: 'x' | 'z'; half: number; deck: number }) {
  const flip = b.axis === 'x';
  const px = (p: readonly number[]) => (flip ? F02.w - p[0] : p[0]);
  // on screen: across = (x - z) * DIAG, up = y * cos(ELEV) - (x + z) * DIAG * sin(ELEV)
  const span = 2 * b.half * DIAG; // screen width between the deck's two ends
  const rise = 2 * b.half * DIAG * Math.sin(ELEV); // the back end is this much higher on screen
  const k = span / Math.abs(px(F02.back) - px(F02.front)); // world units per picture pixel
  const paintedRise = (F02.front[1] - F02.back[1]) * k;
  const dir = px(F02.back) > px(F02.front) ? 1 : -1; // the back end is to the right (z bridge) or left (x bridge)
  const shear = ((rise - paintedRise) / span) * dir;
  const midPx = (px(F02.front) + px(F02.back)) / 2;
  const midPy = (F02.front[1] + F02.back[1]) / 2;
  const width = F02.w * k;
  // the picture's base point sits straight below the deck's middle on screen
  const y = b.deck - ((F02.h - midPy) * k) / Math.cos(ELEV);
  return { width, y, shear, anchor: flip ? 1 - midPx / F02.w : midPx / F02.w, flip };
}

// All static pictures are packed into one texture and drawn in one go.
// The camera never turns, so a fixed back-to-front order is always right.
interface Queued { name: string; x: number; z: number; o: SpriteOpts }
const queue: Queued[] = [];
const BODY_PAD = 0.3;
export function queueSprite(name: string, x: number, z: number, o: SpriteOpts) {
  queue.push({ name, x, z, o });
  // ONE RULE FOR EVERY STANDING PICTURE (trees, rocks, lanterns...): the no-walk circle is the object's own
  // base PLUS half of Mochi's body, so his nose and bottom never poke into a trunk or rock and he is always
  // clearly in front of it or behind it. (Long things - fences, beds - follow their own lines instead.)
  if (o.block) blockers.push({ x, z, r: o.block + (o.line || o.box || o.decal ? 0 : BODY_PAD) });
}

function loadImage(name: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => rej(new Error('missing picture ' + name));
    im.src = `obj/${name}.png`;
  });
}

interface AtlasEntry { u0: number; v0: number; u1: number; v1: number; aspect: number; anchor: number }

async function buildAtlas(names: string[]): Promise<{ tex: THREE.Texture; map: Map<string, AtlasEntry> }> {
  const imgs = await Promise.all(names.map(loadImage));
  // Pictures are kept at their real size (up to 1024 px), so they stay sharp on the tablet.
  // The whole sheet must fit in 4096 × 4096 (the biggest picture the tablet's graphics chip takes);
  // if it doesn't, everything is shrunk a little and packed again.
  const LIMIT = 4096;
  const PADPX = 6;
  let scale = 1;
  let W = 0;
  let H = 0;
  let sizes: { w: number; h: number }[] = [];
  let place: { x: number; y: number }[] = [];
  for (let attempt = 0; attempt < 12; attempt++, scale *= 0.9) {
    sizes = imgs.map((im) => {
      const k = Math.min(1, 1024 / Math.max(im.width, im.height)) * scale;
      return { w: Math.round(im.width * k), h: Math.round(im.height * k) };
    });
    const order = names.map((_, i) => i).sort((a, b) => sizes[b].h - sizes[a].h);
    // try both sheet widths and keep the one that wastes least
    let best: { W: number; H: number; place: { x: number; y: number }[] } | null = null;
    for (const w0 of [2048, 4096]) {
      const pl: { x: number; y: number }[] = [];
      let x = PADPX;
      let y = PADPX;
      let rowH = 0;
      for (const i of order) {
        const { w, h } = sizes[i];
        if (x + w + PADPX > w0) { x = PADPX; y += rowH + PADPX * 2; rowH = 0; }
        pl[i] = { x, y };
        x += w + PADPX * 2;
        rowH = Math.max(rowH, h);
      }
      const h0 = Math.pow(2, Math.ceil(Math.log2(y + rowH + PADPX)));
      if (h0 <= LIMIT && (!best || w0 * h0 < best.W * best.H)) best = { W: w0, H: h0, place: pl };
    }
    if (best) {
      ({ W, H, place } = best);
      break;
    }
  }
  console.log(`picture sheet ${W}×${H}, pictures at ${Math.round(scale * 100)}% of full size`);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.imageSmoothingQuality = 'high';
  const map = new Map<string, AtlasEntry>();
  names.forEach((n, i) => {
    const { w, h } = sizes[i];
    const p = place[i];
    g.drawImage(imgs[i], p.x, p.y, w, h);
    // where along the width the picture touches the ground (its lowest pixels):
    // that point is placed on the object's front-most ground point
    const px = g.getImageData(p.x, p.y, w, h).data;
    let anchor = 0.5;
    for (let row = h - 1; row >= 0; row--) {
      let sum = 0;
      let cnt = 0;
      for (let col = 0; col < w; col++) if (px[(row * w + col) * 4 + 3] > 100) { sum += col; cnt++; }
      if (cnt > 0) { anchor = (sum / cnt + 0.5) / w; break; }
    }
    map.set(n, { u0: p.x / W, v0: 1 - (p.y + h) / H, u1: (p.x + w) / W, v1: 1 - p.y / H, aspect: imgs[i].height / imgs[i].width, anchor });
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 2;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return { tex, map };
}

const shadowTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  grd.addColorStop(0, 'rgba(40,50,20,0.42)');
  grd.addColorStop(0.6, 'rgba(40,50,20,0.2)');
  grd.addColorStop(1, 'rgba(40,50,20,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();

class QuadBuilder {
  pos: number[] = [];
  uv: number[] = [];
  local: number[] = [];
  ring: number[] = [];
  stream: number[] = [];
  idx: number[] = [];
  /** corners: bottom-left, bottom-right, top-left, top-right; ua/ub atlas u at left/right, la/lb picture u at left/right */
  quad(p: THREE.Vector3[], ua: number, ub: number, v0: number, v1: number, la = 0, lb = 1, ring?: number[], stream?: number[]) {
    const b = this.pos.length / 3;
    for (const v of p) this.pos.push(v.x, v.y, v.z);
    this.uv.push(ua, v0, ub, v0, ua, v1, ub, v1);
    this.local.push(la, 0, lb, 0, la, 1, lb, 1);
    for (let i = 0; i < 4; i++) {
      this.ring.push(...(ring ?? [0, 0, 1, 0]));
      this.stream.push(...(stream ?? [0, 0, 0, 0]));
    }
    this.idx.push(b, b + 1, b + 2, b + 2, b + 1, b + 3);
  }
  geometry(extra = false): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (extra) {
      g.setAttribute('aLocal', new THREE.Float32BufferAttribute(this.local, 2));
      g.setAttribute('aRing', new THREE.Float32BufferAttribute(this.ring, 4));
      g.setAttribute('aStream', new THREE.Float32BufferAttribute(this.stream, 4));
    }
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

/** Shader materials that need uTime every frame. */
export const animated: THREE.ShaderMaterial[] = [];

/**
 * The material for every picture. Pictures marked as water (aRing.w = 1) get their
 * painted water animated: the blue-green pixels ripple, shimmer and flow,
 * everything else stays exactly as painted.
 */
function spriteMaterial(atlas: THREE.Texture, noise: THREE.Texture): THREE.ShaderMaterial {
  const img = atlas.image as HTMLCanvasElement;
  return new THREE.ShaderMaterial({
    transparent: true,
    uniforms: {
      map: { value: atlas },
      uNoise: { value: noise },
      uTime: { value: 0 },
      uTexel: { value: new THREE.Vector2(1 / img.width, 1 / img.height) },
    },
    vertexShader: /* glsl */ `
      attribute vec2 aLocal;
      attribute vec4 aRing;
      attribute vec4 aStream;
      varying vec2 vUv;
      varying vec2 vLocal;
      varying vec4 vRing;
      varying vec4 vStream;
      void main() {
        vUv = uv; vLocal = aLocal; vRing = aRing; vStream = aStream;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      uniform sampler2D uNoise;
      uniform float uTime;
      uniform vec2 uTexel;
      varying vec2 vUv;
      varying vec2 vLocal;
      varying vec4 vRing;
      varying vec4 vStream;
      float waterMask(vec3 c) {
        return smoothstep(0.05, 0.18, c.b - c.r) * smoothstep(0.03, 0.13, c.g - c.r);
      }
      void main() {
        // -0.5: pick the sharper of the shrunken copies (pictures are mostly drawn a bit smaller than stored)
        vec4 c = texture2D(map, vUv, -0.5);
        if (c.a < 0.08) discard;
        vec3 col = c.rgb;
        if (vRing.w > 0.5) {
          float t = uTime;
          float water = waterMask(col);
          float aspect = vRing.z;
          vec2 p = vec2(vLocal.x, vLocal.y * aspect);
          vec2 q = vec2(p.x, p.y / 0.577);
          float n1 = texture2D(uNoise, q * 1.3 + vec2(t * 0.018, t * 0.011)).a;
          float n2 = texture2D(uNoise, q * 1.7 - vec2(t * 0.014, -t * 0.019)).a;
          float caus = smoothstep(0.07, 0.0, abs(n1 - n2));
          vec2 off = (vec2(n1, n2) - 0.5) * uTexel * 4.0;
          vec4 c2 = texture2D(map, vUv + off);
          vec3 wcol = mix(col, c2.rgb, waterMask(c2.rgb));
          vec2 dv = p - vec2(vRing.x, vRing.y * aspect);
          dv.y /= 0.577;
          float d = length(dv);
          float rings = (sin(d * 80.0 - t * 5.0) * 0.5 + 0.5) * exp(-d * 6.0) * smoothstep(0.0, 0.015, d);
          wcol += vec3(0.85, 1.0, 1.0) * (caus * 0.2 + rings * 0.16);
          float inStream = step(abs(vLocal.x - vStream.x), vStream.w) * step(vStream.z, vLocal.y) * step(vLocal.y, vStream.y);
          float st = texture2D(uNoise, vec2(vLocal.x * 14.0, vLocal.y * 2.2 + t * 1.3)).b;
          col = mix(col, wcol, water);
          col = mix(col, col * (0.78 + 0.5 * st), inStream);
        }
        gl_FragColor = vec4(col, c.a);
        #include <colorspace_fragment>
      }
    `,
  });
}

/** Slide a point along the view direction (screen position unchanged) until it lies on a plane. */
export function ontoPlane(v: THREE.Vector3, p0: THREE.Vector3, n: THREE.Vector3) {
  const t = -v.clone().sub(p0).dot(n) / CAM_DIR.dot(n);
  v.addScaledVector(CAM_DIR, t);
}

export async function flushSprites(scene: THREE.Scene, noise: THREE.Texture) {
  const names = [...new Set(queue.map((q) => q.name))];
  const { tex, map } = await buildAtlas(names);
  const right = new THREE.Vector3(DIAG, 0, -DIAG);
  const up = new THREE.Vector3(0, 1, 0);
  const main = new QuadBuilder();
  const over = new QuadBuilder();
  const shadows = new QuadBuilder();
  const casts = new QuadBuilder();
  // sunlight comes from the upper-left of the screen (like the painted art), so shadows fall lower-right
  const SHADOW_DIR = new THREE.Vector3(1, 0, 0.12).normalize();

  const items = queue.map((q) => {
    let fx: number;
    let fz: number;
    if (q.o.front) {
      fx = q.x + q.o.front[0];
      fz = q.z + q.o.front[1];
    } else if (q.o.box) {
      fx = q.x + q.o.box[0];
      fz = q.z + q.o.box[1];
    } else {
      const r = q.o.r ?? q.o.width * 0.25;
      fx = q.x + r * DIAG;
      fz = q.z + r * DIAG;
    }
    const key = q.o.line ? (q.o.line[0] + q.o.line[2] + q.o.line[1] + q.o.line[3]) / 2 : q.x + q.z;
    return { q, fx, fz, key };
  });
  items.sort((a, b) => a.key - b.key);

  for (const { q, fx, fz } of items) {
    const e = map.get(q.name)!;
    const o = q.o;
    const w = o.width;
    const h = (w * e.aspect) / Math.cos(ELEV);
    const baseY = (o.y ?? groundHeight(q.x, q.z)) - 0.02;
    const base = new THREE.Vector3(fx, baseY, fz);
    const anchor = o.flip ? 1 - (o.anchor ?? e.anchor) : (o.anchor ?? e.anchor);
    const l = base.clone().addScaledVector(right, -w * anchor);
    const rr = base.clone().addScaledVector(right, w * (1 - anchor));
    const tl = l.clone().addScaledVector(up, h);
    const tr = rr.clone().addScaledVector(up, h);
    if (o.shear) {
      // up on screen = y * cos(ELEV): the left side moves by -shear * its distance left of the base, the right side by +
      const dl = (-o.shear * w * anchor) / Math.cos(ELEV);
      const dr = (o.shear * w * (1 - anchor)) / Math.cos(ELEV);
      l.y += dl; tl.y += dl; rr.y += dr; tr.y += dr;
    }
    const uAt = (s: number) => (o.flip ? e.u1 - (e.u1 - e.u0) * s : e.u0 + (e.u1 - e.u0) * s);
    const lAt = (s: number) => (o.flip ? 1 - s : s);
    const ring = o.water ? [o.water.ring[0], o.water.ring[1], e.aspect, 1] : undefined;
    const stream = o.water?.stream;

    if (o.decal) {
      over.quad([l, rr, tl, tr], uAt(0), uAt(1), e.v0, e.v1);
    } else if (o.box) {
      // two halves, each lying on one of the two front sides of the box
      const baseTop = base.clone().addScaledVector(up, h);
      const leftQ = [l.clone(), base.clone(), tl.clone(), baseTop.clone()];
      const rightQ = [base.clone(), rr.clone(), baseTop.clone(), tr.clone()];
      const corner = new THREE.Vector3(fx, baseY, fz);
      for (const v of leftQ) ontoPlane(v, corner, new THREE.Vector3(0, 0, 1));
      for (const v of rightQ) ontoPlane(v, corner, new THREE.Vector3(1, 0, 0));
      main.quad(leftQ, uAt(0), uAt(anchor), e.v0, e.v1, lAt(0), lAt(anchor), ring, stream);
      main.quad(rightQ, uAt(anchor), uAt(1), e.v0, e.v1, lAt(anchor), lAt(1), ring, stream);
    } else {
      const corners = [l, rr, tl, tr];
      if (o.line) {
        const [ax, az, bx, bz] = o.line;
        const n = new THREE.Vector3(-(bz - az), 0, bx - ax).normalize();
        if (n.dot(CAM_DIR) < 0) n.negate();
        const p0 = new THREE.Vector3(ax, baseY, az);
        for (const v of corners) ontoPlane(v, p0, n);
      }
      main.quad(corners, uAt(0), uAt(1), e.v0, e.v1, lAt(0), lAt(1), ring, stream);
    }

    // sun shadow: the picture's own outline laid down on the ground
    if (o.cast && !o.decal && !o.box) {
      const y = groundHeight(q.x, q.z) + 0.03;
      const len = w * e.aspect * o.cast;
      const far = new THREE.Vector3(q.x, 0, q.z).addScaledVector(SHADOW_DIR, len);
      if (Math.abs(groundHeight(far.x, far.z) + 0.03 - y) < 0.15) {
        const bl = new THREE.Vector3(l.x, y, l.z);
        const br = new THREE.Vector3(rr.x, y, rr.z);
        casts.quad([bl, br, bl.clone().addScaledVector(SHADOW_DIR, len), br.clone().addScaledVector(SHADOW_DIR, len)], uAt(0), uAt(1), e.v0, e.v1);
      }
    }
    const sh = o.shadow ?? 0.9;
    if (sh > 0 && !o.decal) {
      // centred on the trunk, nudged a little lower-right (sun from the upper-left)
      const cx = q.x + 0.18;
      const cz = q.z + 0.06;
      const y = groundHeight(q.x, q.z) + 0.03;
      const hx = (w * sh) / 2;
      const hz = (w * sh * 0.8) / 2;
      shadows.quad(
        [new THREE.Vector3(cx - hx, y, cz + hz), new THREE.Vector3(cx + hx, y, cz + hz), new THREE.Vector3(cx - hx, y, cz - hz), new THREE.Vector3(cx + hx, y, cz - hz)],
        0, 1, 0, 1,
      );
    }
  }

  scene.add(splitIntoChunks(shadows.geometry(), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }), 0, 0, 'shadows'));
  const castMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    uniforms: { map: { value: tex } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      varying vec2 vUv;
      void main() { gl_FragColor = vec4(0.12, 0.2, 0.06, texture2D(map, vUv).a * 0.28); }
    `,
  });
  scene.add(splitIntoChunks(casts.geometry(), castMat, 0, 0, 'casts'));
  // bridges: drawn over the ground and water, never over the player
  scene.add(splitIntoChunks(over.geometry(), new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.08, depthTest: false, depthWrite: false }), 2, 0, 'bridges'));
  const sm = spriteMaterial(tex, noise);
  animated.push(sm);
  // back tiles first, so see-through edges of pictures layer the right way across tile borders
  scene.add(splitIntoChunks(main.geometry(true), sm, 3, 0.001, 'pictures'));
  queue.length = 0;
}

// ---------------------------------------------------------------------------
// 3D boulders standing in the river
// ---------------------------------------------------------------------------

let boulderGeos: THREE.BufferGeometry[] | null = null;
function makeBoulderGeos(): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (let v = 0; v < 5; v++) {
    let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, 2);
    g.deleteAttribute('normal');
    g.deleteAttribute('uv');
    g = mergeVertices(g);
    const p = g.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(p.count * 3);
    const uvs = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) {
      uvs[i * 2] = Math.atan2(p.getZ(i), p.getX(i)) / (Math.PI * 2) + 0.5;
      uvs[i * 2 + 1] = p.getY(i) * 0.5 + 0.5;
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const y = p.getY(i);
      const z = p.getZ(i);
      const n = fbm(x * 1.3 + v * 7, z * 1.3 + y * 1.1, 70 + v, 2);
      const box = 1 / Math.max(Math.abs(x), Math.abs(y), Math.abs(z));
      const k = (0.55 + 0.45 * Math.min(box, 1.35)) * (0.85 + n * 0.3);
      p.setXYZ(i, x * k * 1.05, y * k * 0.8, z * k);
    }
    g.computeVertexNormals();
    const nrm = g.attributes.normal as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const upN = nrm.getY(i);
      const n = fbm(p.getX(i) * 2.1, p.getZ(i) * 2.1 + p.getY(i), 90 + v, 2);
      // lilac-grey like the painted stones, lighter on top, mossy crown
      const shade = 0.7 + 0.35 * Math.max(0, Math.min(1, p.getY(i) + 0.6));
      let r = (0.95 + n * 0.1) * shade;
      let gg = (0.95 + n * 0.1) * shade;
      let b = (0.95 + n * 0.1) * shade;
      const moss = Math.max(0, Math.min(1, (upN - 0.55) * 2.6)) * (n > 0.45 ? 0.8 : 0.3);
      r += (0.46 - r) * moss;
      gg += (0.6 - gg) * moss;
      b += (0.22 - b) * moss;
      colors[i * 3] = r;
      colors[i * 3 + 1] = gg;
      colors[i * 3 + 2] = b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    out.push(g);
  }
  return out;
}
const boulderMat = new THREE.MeshLambertMaterial({ vertexColors: true });
new THREE.TextureLoader().loadAsync('tex/stone.jpg').then((t) => {
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1.5, 0.75);
  boulderMat.map = t;
  boulderMat.needsUpdate = true;
});

export function boulder(scene: THREE.Scene, x: number, z: number, size: number, seed: number, y?: number) {
  boulderGeos ??= makeBoulderGeos();
  const m = new THREE.Mesh(boulderGeos[seed % boulderGeos.length], boulderMat);
  m.scale.setScalar(size);
  m.rotation.y = seed * 1.7;
  m.position.set(x, (y ?? groundHeight(x, z)) - size * 0.2, z);
  m.name = 'rocks';
  scene.add(m);
  return m;
}

/** Many boulders drawn together: one draw per rock shape, however many rocks. */
export interface RockPlace { x: number; y: number; z: number; sx: number; sy: number; sz: number; ry: number; shape: number }
export function buildRockBatch(scene: THREE.Scene, rocks: RockPlace[]) {
  boulderGeos ??= makeBoulderGeos();
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  boulderGeos.forEach((geo, shape) => {
    const mine = rocks.filter((r) => r.shape === shape);
    if (!mine.length) return;
    const inst = new THREE.InstancedMesh(geo, boulderMat, mine.length);
    mine.forEach((r, i) => {
      q.setFromAxisAngle(up, r.ry);
      m.compose(new THREE.Vector3(r.x, r.y, r.z), q, new THREE.Vector3(r.sx, r.sy, r.sz));
      inst.setMatrixAt(i, m);
    });
    inst.instanceMatrix.needsUpdate = true;
    inst.frustumCulled = false;
    inst.name = 'rocks';
    scene.add(inst);
  });
}

// ---------------------------------------------------------------------------
// Wooden fence: posts, two rails, and a plank gate. One mesh, warm painted wood colours.
// ---------------------------------------------------------------------------

type XZ = [number, number];
export function buildFence(runs: XZ[][], gates: [number, number, number, number][], open: [number, number, number, number][] = []): THREE.Mesh {
  const R = rng(777);
  const parts: THREE.BufferGeometry[] = [];
  const add = (w: number, h: number, d: number, x: number, y: number, z: number, ry: number, col: [number, number, number]) => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.rotateY(ry);
    g.translate(x, y, z);
    const t = 0.92 + R() * 0.16;
    const c = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < g.attributes.position.count; i++) {
      // a little darker toward the ground
      const yy = g.attributes.position.getY(i) - y + h / 2;
      const s2 = t * (0.82 + 0.18 * Math.min(1, yy / Math.max(h, 0.01)));
      c[i * 3] = col[0] * s2;
      c[i * 3 + 1] = col[1] * s2;
      c[i * 3 + 2] = col[2] * s2;
    }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    parts.push(g.toNonIndexed());
  };
  const POST: [number, number, number] = [0.52, 0.34, 0.2];
  const RAIL: [number, number, number] = [0.68, 0.45, 0.26];
  const PLANK: [number, number, number] = [0.72, 0.49, 0.29];
  const post = (x: number, z: number, h = 0.62, w = 0.13) => {
    const y = groundHeight(x, z);
    add(w, h, w, x, y + h / 2, z, (R() - 0.5) * 0.1, POST);
    add(w + 0.04, 0.05, w + 0.04, x, y + h + 0.02, z, 0, RAIL); // cap
  };
  for (const run of runs) {
    for (let i = 0; i < run.length - 1; i++) {
      const [ax, az] = run[i];
      const [bx, bz] = run[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.max(1, Math.round(len / 1.1));
      const ry = -Math.atan2(bz - az, bx - ax);
      for (let k = 0; k < n; k++) {
        const t0 = k / n;
        const t1 = (k + 1) / n;
        const x0 = ax + (bx - ax) * t0;
        const z0 = az + (bz - az) * t0;
        const x1 = ax + (bx - ax) * t1;
        const z1 = az + (bz - az) * t1;
        post(x0, z0);
        const mx = (x0 + x1) / 2;
        const mz = (z0 + z1) / 2;
        const y = groundHeight(mx, mz);
        const seg = Math.hypot(x1 - x0, z1 - z0);
        add(seg, 0.07, 0.05, mx, y + 0.24, mz, ry + (R() - 0.5) * 0.03, RAIL);
        add(seg, 0.07, 0.05, mx, y + 0.47, mz, ry + (R() - 0.5) * 0.03, RAIL);
      }
      if (i === run.length - 2) post(bx, bz);
    }
  }
  for (const [ax, az, bx, bz] of gates) {
    const len = Math.hypot(bx - ax, bz - az);
    const ry = -Math.atan2(bz - az, bx - ax);
    post(ax, az, 0.78, 0.16);
    post(bx, bz, 0.78, 0.16);
    const planks = 5;
    for (let k = 0; k < planks; k++) {
      const t = (k + 0.5) / planks;
      const x = ax + (bx - ax) * (0.08 + 0.84 * t);
      const z = az + (bz - az) * (0.08 + 0.84 * t);
      const y = groundHeight(x, z);
      const h = 0.5 + (k === 2 ? 0.06 : k === 1 || k === 3 ? 0.03 : 0);
      add((len * 0.84) / planks - 0.02, h, 0.045, x, y + 0.08 + h / 2, z, ry, PLANK);
    }
    const mx = (ax + bx) / 2;
    const mz = (az + bz) / 2;
    const y = groundHeight(mx, mz);
    add(len * 0.84, 0.06, 0.06, mx, y + 0.22, mz, ry, RAIL);
    add(len * 0.84, 0.06, 0.06, mx, y + 0.46, mz, ry, RAIL);
  }
  // open double gates: two tall posts, each half swung outward (away from the fenced area's middle)
  const cx = runs.flat().reduce((s, p) => s + p[0], 0) / Math.max(1, runs.flat().length);
  const cz = runs.flat().reduce((s, p) => s + p[1], 0) / Math.max(1, runs.flat().length);
  for (const [ax, az, bx, bz] of open) {
    post(ax, az, 0.78, 0.16);
    post(bx, bz, 0.78, 0.16);
    const half = Math.hypot(bx - ax, bz - az) / 2 - 0.06;
    for (const [hx, hz, ox, oz] of [[ax, az, bx, bz], [bx, bz, ax, az]]) {
      const dx = (ox - hx) / Math.hypot(ox - hx, oz - hz);
      const dz = (oz - hz) / Math.hypot(ox - hx, oz - hz);
      // swing 115°, to whichever side is further from the middle
      let best: [number, number] = [dx, dz];
      let far = -1e9;
      for (const s of [1, -1]) {
        const a = s * 2.0;
        const ex = dx * Math.cos(a) - dz * Math.sin(a);
        const ez = dx * Math.sin(a) + dz * Math.cos(a);
        const d = Math.hypot(hx + ex - cx, hz + ez - cz);
        if (d > far) { far = d; best = [ex, ez]; }
      }
      const ry = -Math.atan2(best[1], best[0]);
      const planks = 3;
      for (let k = 0; k < planks; k++) {
        const t = (k + 0.5) / planks;
        const x = hx + best[0] * (0.1 + (half - 0.1) * t);
        const z = hz + best[1] * (0.1 + (half - 0.1) * t);
        const h = 0.5 + (k === planks - 1 ? 0.05 : 0);
        add((half - 0.1) / planks - 0.02, h, 0.045, x, groundHeight(x, z) + 0.08 + h / 2, z, ry, PLANK);
      }
      const mx = hx + best[0] * (0.1 + (half - 0.1) / 2);
      const mz = hz + best[1] * (0.1 + (half - 0.1) / 2);
      const y = groundHeight(mx, mz);
      add(half - 0.1, 0.06, 0.06, mx, y + 0.22, mz, ry, RAIL);
      add(half - 0.1, 0.06, 0.06, mx, y + 0.46, mz, ry, RAIL);
    }
  }
  const geo = mergeGeometries(parts);
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
}

/**
 * Wooden boardwalks over the marsh: planks across two beams, on posts standing in the water.
 * Built in 3D (like the fence) so Mochi is always drawn right on them.
 */
export function buildBoardwalks(walks: XZ[][]): THREE.Mesh {
  const R = rng(4711);
  const parts: THREE.BufferGeometry[] = [];
  const add = (w: number, h: number, d: number, x: number, y: number, z: number, ry: number, col: [number, number, number]) => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.rotateY(ry);
    g.translate(x, y, z);
    const t = 0.9 + R() * 0.2;
    const c = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < c.length; i += 3) {
      c[i] = col[0] * t;
      c[i + 1] = col[1] * t;
      c[i + 2] = col[2] * t;
    }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    parts.push(g.toNonIndexed());
  };
  // warm painted wood, like the bridge pictures (the colour boost lightens it a lot)
  const PLANK: [number, number, number] = [0.6, 0.34, 0.16];
  const BEAM: [number, number, number] = [0.4, 0.22, 0.11];
  const POST: [number, number, number] = [0.36, 0.2, 0.1];
  const W = BOARD_HALF * 2;
  for (const walk of walks) {
    for (let i = 0; i < walk.length - 1; i++) {
      const [ax, az] = walk[i];
      const [bx, bz] = walk[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const dx = (bx - ax) / len;
      const dz = (bz - az) / len;
      const ry = -Math.atan2(dz, dx);
      // run a little past each corner so the planks of two pieces overlap at a bend
      const s0 = i === 0 ? 0 : -BOARD_HALF * 0.8;
      const s1 = len + (i === walk.length - 2 ? 0 : BOARD_HALF * 0.8);
      for (let t = s0 + 0.12; t < s1; t += 0.25) {
        const x = ax + dx * t;
        const z = az + dz * t;
        // planks across the walk, each a little different (hand-made)
        add(0.21, 0.05, W + (R() - 0.5) * 0.08, x + (R() - 0.5) * 0.02, BOARD_Y - 0.025 + (R() - 0.5) * 0.012, z, ry + (R() - 0.5) * 0.05, PLANK);
      }
      const mx = ax + dx * (s0 + s1) / 2;
      const mz = az + dz * (s0 + s1) / 2;
      for (const side of [-1, 1]) {
        const ox = -dz * (BOARD_HALF - 0.12) * side;
        const oz = dx * (BOARD_HALF - 0.12) * side;
        add(s1 - s0, 0.08, 0.08, mx + ox, BOARD_Y - 0.09, mz + oz, ry, BEAM);
        // posts under the deck, down into the water or the ground
        for (let t = 0.3; t < len; t += 1.3) {
          const x = ax + dx * t + ox * 1.25;
          const z = az + dz * t + oz * 1.25;
          const foot = Math.min(groundHeight(x, z), WATER) - 0.15;
          const h = BOARD_Y - 0.06 - foot;
          add(0.11, h, 0.11, x, foot + h / 2, z, R() * 0.4, POST);
        }
      }
    }
    // a short post sticking up at each corner of both ends, so the ends read as a way on
    for (const [p, q] of [[walk[0], walk[1]], [walk[walk.length - 1], walk[walk.length - 2]]]) {
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      const dx = (q[0] - p[0]) / len;
      const dz = (q[1] - p[1]) / len;
      for (const side of [-1, 1]) {
        const x = p[0] - dz * (BOARD_HALF + 0.06) * side + dx * 0.1;
        const z = p[1] + dx * (BOARD_HALF + 0.06) * side + dz * 0.1;
        const foot = Math.min(groundHeight(x, z), WATER) - 0.1;
        const h = BOARD_Y + 0.28 - foot;
        add(0.13, h, 0.13, x, foot + h / 2, z, 0, POST);
      }
    }
  }
  const geo = mergeGeometries(parts);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh.name = 'boardwalks';
  return mesh;
}

/** Small painted ground details (clover, flowers, leaves, pebbles) lying flat on the grass. */
export async function scatterDecals(scene: THREE.Scene, count: number) {
  const tex = await new THREE.TextureLoader().loadAsync('tex/decals.png');
  tex.colorSpace = THREE.SRGBColorSpace;
  const R = rng(99);
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  let placedN = 0;
  for (let tries = 0; tries < count * 6 && placedN < count; tries++) {
    const x = R() * MAP_W;
    const z = R() * MAP_D;
    const k = kindAt(x, z);
    if (isWet(k) || k === 'stairs' || isPlaza(x, z) || pathMask(x, z) > 0.02) continue;
    if (x > GARDEN.x0 - 0.5 && x < GARDEN.x1 + 0.6 && z > GARDEN.z0 - 0.5 && z < GARDEN.z1 + 0.6) continue;
    const h = groundHeight(x, z);
    const size = 0.45 + R() * 0.4;
    let flat = true;
    for (const [dx, dz] of [[size, 0], [-size, 0], [0, size], [0, -size]]) if (Math.abs(groundHeight(x + dx, z + dz) - h) > 0.05) flat = false;
    if (!flat) continue;
    // 4x4 sheet: flowers and clover most of the time, pebbles, leaves and moss only now and then
    const soft = [0, 2, 4, 6, 8, 10, 11, 13, 14];
    const rare = [1, 3, 5, 7, 9, 12, 15];
    const cell = R() < 0.85 ? soft[Math.floor(R() * soft.length)] : rare[Math.floor(R() * rare.length)];
    const u0 = (cell % 4) / 4;
    const v1 = 1 - Math.floor(cell / 4) / 4;
    const v0 = v1 - 0.25;
    const a = R() * Math.PI * 2;
    const ca = Math.cos(a) * size;
    const sa = Math.sin(a) * size;
    const b = pos.length / 3;
    for (const [px, pz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      pos.push(x + px * ca - pz * sa, h + 0.015, z + px * sa + pz * ca);
    }
    uv.push(u0, v0, u0 + 0.25, v0, u0, v1, u0 + 0.25, v1);
    idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
    placedN++;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  scene.add(splitIntoChunks(g, new THREE.MeshBasicMaterial({
    map: tex, transparent: true, depthWrite: false, color: 0xe6e6e0,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  }), 0, 0, 'decals'));
}

// ---------------------------------------------------------------------------
// Placement: composed by hand around the paths, bridge, garden and spring
// ---------------------------------------------------------------------------

function nearPath(x: number, z: number, pad: number): boolean {
  for (const p of PATHS) if (lineDist(x, z, p).d < pad) return true;
  for (const b of BOARDWALKS) if (lineDist(x, z, b).d < pad + BOARD_HALF) return true;
  return false;
}
function nearBridge(x: number, z: number, pad: number): boolean {
  for (const b of BRIDGES) {
    const a = b.axis === 'z' ? z - b.z : x - b.x;
    const off = b.axis === 'z' ? x - b.x : z - b.z;
    if (Math.abs(a) < b.half + pad + 0.3 && Math.abs(off) < 0.8 + pad) return true;
  }
  return false;
}
function inGarden(x: number, z: number, pad: number): boolean {
  return x > GARDEN.x0 - pad && x < GARDEN.x1 + pad && z > GARDEN.z0 - pad && z < GARDEN.z1 + pad;
}
/** Solid, level ground (no edge within r). */
function onFlat(x: number, z: number, r: number): boolean {
  const k = kindAt(x, z);
  if (isWet(k) || k === 'stairs') return false;
  const h = groundHeight(x, z);
  for (const [dx, dz] of [[r, 0], [-r, 0], [0, r], [0, -r], [r, r], [-r, -r], [r, -r], [-r, r]]) {
    if (Math.abs(groundHeight(x + dx, z + dz) - h) > 0.15) return false;
  }
  return true;
}

/** A painted waterfall picture, measured in its own pixels. */
export interface FallPic { name: string; w: number; h: number; lipX: number; lipY: number; footY: number; anchor: number; waterX0: number; waterX1: number }
export const FALL_PICS: FallPic[] = [
  { name: 'w00', w: 990, h: 1144, lipX: 542, lipY: 200, footY: 900, anchor: 0.427, waterX0: 390, waterX1: 780 }, // wide
  { name: 'w01', w: 730, h: 1164, lipX: 365, lipY: 170, footY: 880, anchor: 0.482, waterX0: 255, waterX1: 520 }, // narrow
];

/**
 * Stand a painted waterfall picture over a waterfall so its lip sits on the cliff edge and its foam
 * on the water below. The picture is a flat card facing the camera, set a little in front of the
 * cliff so the cliff never cuts into it.
 */
export function placePaintedFall(f: Fall, pic: FallPic, scale = 1.3) {
  const cosE = Math.cos(ELEV);
  const ds = DIAG * Math.sin(ELEV);
  const sx = (x: number, z: number) => DIAG * (x - z);
  const sy = (x: number, y: number, z: number) => cosE * y - ds * (x + z);
  const mid = (f.a0 + f.a1) / 2;
  const lip = f.dir === 'x' ? [f.at, f.top, mid] : [mid, f.top, f.at];
  const foot = f.dir === 'x' ? [f.at + 0.4, f.bottom + 0.05, mid] : [mid, f.bottom + 0.05, f.at + 0.4];
  const flip = f.dir === 'z'; // the pictures face lower-right; a wall facing +z needs the mirror image
  const k = ((sy(lip[0], lip[1], lip[2]) - sy(foot[0], foot[1], foot[2])) / (pic.footY - pic.lipY)) * scale;
  const w = pic.w * k;
  const a = flip ? 1 - pic.anchor : pic.anchor;
  const lipX = flip ? pic.w - pic.lipX : pic.lipX;
  const sxB = sx(lip[0], lip[2]) - (lipX / pic.w - a) * w;
  const syB = sy(lip[0], lip[1], lip[2]) - (pic.h - pic.lipY) * k;
  const by = f.bottom + 0.12; // the card's bottom edge stays just above the water
  const d = (cosE * by - syB) / ds; // how far toward the camera the card stands (x + z)
  const bx = (d + sxB / DIAG) / 2;
  const bz = (d - sxB / DIAG) / 2;
  const u0 = pic.waterX0 / pic.w;
  const u1 = pic.waterX1 / pic.w;
  queueSprite(pic.name, bx, bz, {
    width: w, front: [0, 0], y: by + 0.02, flip, anchor: pic.anchor, shadow: 0,
    water: { ring: [(u0 + u1) / 2, -1], stream: [flip ? 1 - (u0 + u1) / 2 : (u0 + u1) / 2, 1 - pic.lipY / pic.h, 1 - pic.footY / pic.h, (u1 - u0) / 2] },
  });
}

export async function placeScene(scene: THREE.Scene, noise: THREE.Texture): Promise<{ spring: THREE.Vector3 }> {
  const R = rng(1234);
  const placed: { x: number; z: number; r: number }[] = [];
  // keep the waterfalls and their notches clear of plants and rocks
  const nearFall = (x: number, z: number) => FALLS.some((f) => {
    const a = f.dir === 'x' ? z : x;
    const b = f.dir === 'x' ? x : z;
    return a > f.a0 - 1.4 && a < f.a1 + 1.4 && b > f.at - 1.6 && b < f.at + 2.2;
  });
  // the stone steps and the ground just above and below them stay clear, so Mochi can always use them
  const STAIRS: [number, number][] = [];
  for (let cz = 0; cz < MAP_D; cz++) for (let cx = 0; cx < MAP_W; cx++) if (cellKind(cx, cz) === 'stairs') STAIRS.push([cx, cz]);
  const nearStairs = (x: number, z: number, r: number) => STAIRS.some(([cx, cz]) => {
    const dx = Math.max(cx - 0.7 - x, 0, x - (cx + 1.7));
    const dz = Math.max(cz - 1.2 - z, 0, z - (cz + 2.0));
    return Math.hypot(dx, dz) < r;
  });
  const free = (x: number, z: number, r: number) => !nearFall(x, z) && !nearStairs(x, z, r) && placed.every((p) => Math.hypot(x - p.x, z - p.z) >= (r + p.r) * 0.92);
  const put = (name: string, x: number, z: number, o: SpriteOpts, r: number) => {
    placed.push({ x, z, r });
    queueSprite(name, x, z, o);
  };
  const flip = () => R() < 0.5;
  const CAVE: [number, number] = [34.8, 3.2];
  const ROCKS = ['b11', 'b12', 'b13', 'b10', 'b14'];
  const pickBush = () => (R() < 0.6 ? 'b04' : 'b01');
  const pickFlower = () => (R() < 0.65 ? 'b03' : 'b02');
  // trees: [picture, height/width of the picture, lowest and highest tree height, how often]
  // (the width on screen is worked out from the height, so every kind stands about as tall as the others)
  const FOREST_TREES: [string, number, number, number, number][] = [
    ['p00', 1.44, 4.4, 5.4, 3], ['p01', 1.29, 3.8, 4.8, 3], ['p02', 2.03, 5.2, 6.4, 2],
  ];
  const TREE_WEIGHT = FOREST_TREES.reduce((a, t) => a + t[4], 0);
  const treeWidth = (aspect: number, h: number) => (h * Math.cos(ELEV)) / aspect;
  const pickTree = (): [string, number] => {
    let w = R() * TREE_WEIGHT;
    for (const [name, aspect, h0, h1, weight] of FOREST_TREES) {
      w -= weight;
      if (w <= 0) return [name, treeWidth(aspect, h0 + R() * (h1 - h0))];
    }
    return ['p00', 3];
  };
  const inRect = (x: number, z: number, r: [number, number, number, number], pad = 0) => x > r[0] - pad && x < r[1] + pad && z > r[2] - pad && z < r[3] + pad;
  // open meadows kept for houses later: no trees, just flowers
  // (plot 1 starts at x 62, z 4.9: its old edges crept onto the raised strip behind it and a dip at the west end)
  const PLOTS: [number, number, number, number][] = [[62, 76.5, 4.9, 8.6], [62.5, 71.0, 14.5, 21], [70.5, 77.0, 18.5, 26]];
  const inPlot = (x: number, z: number, pad = 0) => PLOTS.some((r) => inRect(x, z, r, pad));

  // --- bridges -----------------------------------------------------------------
  // the front railing is drawn twice: once with the rest of the bridge (under Mochi), then again as a
  // card standing on the deck's front edge (f02r, cut by tools/cut_bridge_rail.py), so Mochi walks
  // behind it instead of over it. Same size and base point, so it lines up exactly.
  // ONE WAY FOR EVERY BRIDGE (same as the designed maps): the picture is stretched and tilted so its painted
  // deck ends sit exactly on the two ends of the lane Mochi walks, at deck height.
  for (const b of BRIDGES) {
    const f = bridgeFit(b);
    const o = { width: f.width, flip: f.flip, y: f.y, anchor: f.anchor, shear: f.shear, front: [0, 0] as [number, number], shadow: 0 };
    queueSprite('f02', b.x, b.z, { ...o, decal: true });
    const R = BRIDGE_RAIL;
    const line: [number, number, number, number] = b.axis === 'z' ? [b.x + R, b.z - 3, b.x + R, b.z + 3] : [b.x - 3, b.z + R, b.x + 3, b.z + R];
    queueSprite('f02r', b.x, b.z, { ...o, line });
    for (let t = -1; t <= 1; t += 0.5) placed.push({ x: b.x + (b.axis === 'x' ? t * b.half : 0), z: b.z + (b.axis === 'z' ? t * b.half : 0), r: 0.9 });
  }
  const lantern = (x: number, z: number) => put('a04', x, z, { width: 0.9, r: 0.25, block: 0.3, cast: 0.5, shadow: 0.5 }, 0.4);
  lantern(45.7, 13.4); // north end of the first bridge
  lantern(49.1, 25.3); // east end of the second bridge
  // lanterns at the top of the plaza steps (the paved terrace is kept for a house later)
  lantern(51.3, 15.55);
  lantern(53.7, 15.55);

  // --- rocks along every cliff you can see: tumbled boulders at the foot, a few on the rim,
  // so the walls read as natural rock instead of a built wall -----------------------------
  {
    const rocks: RockPlace[] = [];
    const STEP = 0.42;
    // only the strip where the water actually falls is kept clear; its sides get rocks
    const inFallSheet = (x: number, z: number) => FALLS.some((f) => {
      const a = f.dir === 'x' ? z : x;
      const b = f.dir === 'x' ? x : z;
      return a > f.a0 - 0.2 && a < f.a1 + 0.2 && b > f.at - 0.7 && b < f.at + 1.7;
    });
    const nearSteps = (x: number, z: number) => {
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (cellKind(Math.floor(x) + dx, Math.floor(z) + dz) === 'stairs') return true;
      return false;
    };
    for (let z = -6; z < MAP_D + 6; z += STEP) {
      for (let x = -6; x < MAP_W + 6; x += STEP) {
        const h = groundHeight(x, z);
        // only the two wall directions that face the camera (+x and +z) can be seen
        for (const [dx, dz] of [[1, 0], [0, 1]]) {
          const lx = x + dx * STEP * 1.6;
          const lz = z + dz * STEP * 1.6;
          const low = groundHeight(lx, lz);
          const drop = h - low;
          if (drop < 0.5) continue;
          const riverBank = isWet(kindAt(lx, lz));
          if (nearSteps(x, z) || inFallSheet(x, z) || inFallSheet(lx, lz) || nearBridge(lx, lz, 0.4) || isPlaza(x, z)) continue;
          if (Math.hypot(lx - CAVE[0], lz - CAVE[1]) < 1.5) continue; // the cave mouth stays clear
          // clusters: noise decides where rocks gather, so the line is broken up
          const n = fbm(x * 0.8, z * 0.8, 77);
          if (R() > (riverBank ? (inMarsh(lx, lz) ? 0.04 : 0.18) : 0.25 + n * 0.5)) continue;
          const size = (riverBank ? 0.25 : 0.3) + R() * (riverBank ? 0.2 : 0.35) + n * 0.15;
          const fx = lx + (R() - 0.3) * 0.35 * (dx || 0.4);
          const fz = lz + (R() - 0.3) * 0.35 * (dz || 0.4);
          if (!riverBank && nearPath(fx, fz, 0.55)) continue;
          if (riverBank) {
            // along the river: 3D boulders standing in the water
            rocks.push({ x: fx, y: low - size * 0.15, z: fz, sx: size * (0.9 + R() * 0.4), sy: size * (1.0 + R() * 0.5), sz: size * (0.9 + R() * 0.4), ry: R() * 6.28, shape: Math.floor(R() * 5) });
          } else if (free(fx, fz, size * 0.7)) {
            // at the foot of dry cliffs: the painted mossy rocks, a bit bigger where the cliff is taller
            const big = Math.min(1.5, 0.75 + drop * 0.35) * (0.8 + R() * 0.45);
            put(ROCKS[Math.floor(R() * ROCKS.length)], fx, fz, { width: big, r: 0.2, block: big * 0.35, flip: R() < 0.5, shadow: 0 }, big * 0.4);
          }
        }
      }
    }
    buildRockBatch(scene, rocks);
  }

  // --- painted waterfalls: wide one from the upper pond, narrow one from the back cliff
  placePaintedFall(FALLS[0], FALL_PICS[0]);
  placePaintedFall(FALLS[1], FALL_PICS[1]);
  placePaintedFall(FALLS[2], FALL_PICS[1]);

  // (the hot spring picture that stood at SPRING was removed at the user's request, 2026-09-26)

  // --- garden: the beds themselves are drawn by garden.ts (they change as crops grow) --
  for (const b of GARDEN_BEDS) {
    blockers.push({ x: b.x, z: b.z, r: 0.6 });
    placed.push({ x: b.x, z: b.z, r: 0.75 });
  }
  // wooden fences, built in 3D so they follow the grid and meet at the corners
  const fenceRuns: [number, number][][] = [];
  const fenceGates: [number, number, number, number][] = [];
  const openGates: [number, number, number, number][] = [];
  const fenceBlock = (segs: number[][]) => {
    for (const [ax, az, bx, bz] of segs) {
      const len = Math.hypot(bx - ax, bz - az);
      for (let t = 0; t <= len + 0.001; t += 0.3) blockers.push({ x: ax + ((bx - ax) * t) / len, z: az + ((bz - az) * t) / len, r: 0.2 });
      placed.push({ x: (ax + bx) / 2, z: (az + bz) / 2, r: Math.min(len / 2, 1.5) });
    }
  };
  {
    const fx0 = GARDEN.x0 - 0.25;
    const fx1 = GARDEN.x1 + 0.3;
    const fz0 = GARDEN.z0 - 0.25;
    const fz1 = GARDEN.z1 + 0.3;
    // open gates at both ends of the walkway: west toward the spring path, east toward the meadow
    const ga = GARDEN_GATE.z0;
    const gb = GARDEN_GATE.z1;
    fenceRuns.push([[fx0, ga], [fx0, fz0], [fx1, fz0], [fx1, ga]]);
    fenceRuns.push([[fx1, gb], [fx1, fz1], [fx0, fz1], [fx0, gb]]);
    openGates.push([fx0, ga, fx0, gb], [fx1, ga, fx1, gb]);
    fenceBlock([[fx0, fz0, fx0, ga], [fx0, fz0, fx1, fz0], [fx1, fz0, fx1, ga], [fx1, gb, fx1, fz1], [fx0, fz1, fx1, fz1], [fx0, gb, fx0, fz1]]);
  }
  const fence = buildFence(fenceRuns, fenceGates, openGates);
  fence.name = 'fence';
  scene.add(fence);
  scene.add(buildBoardwalks(BOARDWALKS));
  // ONE RULE: both ends of every boardwalk land on dry ground (say so loudly if a map edit breaks it)
  for (const b of BOARDWALKS) for (const [x, z] of [b[0], b[b.length - 1]]) if (isWet(kindAt(x, z))) console.warn(`boardwalk end in water at ${x}, ${z}`);
  lantern(13.4, 30.7); // east end of the west bridge
  put('a05', GARDEN.x0 - 0.75, GARDEN_GATE.z0 - 0.6, { width: 0.72, r: 0.25, block: 0.3, cast: 0.4, shadow: 0.4 }, 0.35); // fruit basket by the west gate

  // --- landmarks: cave under the high cliff, stone arches at the path ends, rocks in the river
  put('g00', CAVE[0], CAVE[1], { width: 2.2, r: 0.6, block: 0.9, shadow: 0, cast: 0.3 }, 1.2);
  put('g01', 47.3, 1.6, { width: 1.9, r: 0.5, block: 0.8, shadow: 0.4, cast: 0.4 }, 1.1);
  put('h01', 76.4, 10.2, { width: 1.8, r: 0.5, block: 0.8, shadow: 0.4, cast: 0.4 }, 1.1);
  put('g05', 40.0, 11.2, { width: 2.9, r: 0.8, y: WATER - 0.08, shadow: 0 }, 1.4);
  put('h06', 18.6, 30.6, { width: 2.8, r: 1.0, block: 1.0, shadow: 0 }, 1.5); // little lily pond in the south-west meadow

  // --- forests ------------------------------------------------------------------
  const FOREST: [number, number, number, number][] = [
    [14.0, 34.0, 0, 12], // on the high cliff, around the upper pond
    [27.5, 41.0, 10, 20.5], // the big wood between the orchard and the river
    [35.0, 46.0, 0, 7.5], // top middle
    [49.0, 78.0, 0, 10], // top right
    [56.5, 64.0, 19.5, 23], // small grove east of the hot spring
    [14.0, 37.0, 24, 40], // south-west
    [64.5, 78.0, 26, 40], // south-east
    [14.0, 27.0, 22, 24], // below the orchard
    [14.0, 26.5, 12, 21.5], // the west hill (orchard later)
    [0, 14, 0, 12], // new: back corner, on the cliff
    [0, 6.5, 12, 36], // new: along the top of the west cliff
    [6.5, 14, 12, 24], // new: woods under the west cliff
    [0, 11, 34, 42], // new: around the west island pond
    [78, 90, 4, 19], // new: east woods
  ];
  const treeOK = (x: number, z: number) => {
    if (isWet(kindAt(x, z)) || riverDistance(x, z) < 1.2 || nearFall(x, z)) return false;
    if (nearPath(x, z, 1.5) || nearBridge(x, z, 1.2) || inGarden(x, z, 1.6) || inPlot(x, z, 0.5)) return false;
    if (isPlaza(x, z)) return false;
    if (inRect(x, z, [67, 74, 29, 34])) return false; // the lookout top stays open
    return onFlat(x, z, 0.45) && free(x, z, 1.0);
  };
  for (const f of FOREST) {
    for (let z = f[2] + 0.8; z < f[3]; z += 2.35) {
      for (let x = f[0] + 0.8 + ((z * 0.7) % 1.2); x < f[1]; x += 2.5) {
        // big random offsets so the planting grid never shows as rows
        const tx = x + (R() - 0.5) * 2.2;
        const tz = z + (R() - 0.5) * 2.0;
        if (R() < 0.12 || !treeOK(tx, tz)) continue;
        const [tn, tw] = pickTree();
        put(tn, tx, tz, { width: tw, r: 0.4, block: 0.35, flip: flip(), shadow: 0.6 }, 1.05);
        // forest floor: logs, stumps, mushrooms and ferns between the trunks
        if (R() < 0.35) {
          const fx = tx + 0.9 + R() * 0.5;
          const fz = tz + 0.5 + R() * 0.5;
          if (onFlat(fx, fz, 0.25) && !nearPath(fx, fz, 0.8) && free(fx, fz, 0.3)) {
            const pick = R();
            const name = pick < 0.3 ? 'b01' : pick < 0.45 ? 'b06' : pick < 0.6 ? 'b16' : pick < 0.72 ? 'b17' : pick < 0.82 ? 'b18' : pick < 0.9 ? 'b19' : 'b15';
            put(name, fx, fz, { width: name === 'b06' ? 0.65 : 0.95, r: 0.25, block: name >= 'b15' ? 0.3 : 0, flip: flip(), shadow: 0 }, 0.3);
          }
        }
      }
    }
  }

  // --- forest border outside the play area (hides the map edge) ---------------
  // behind the back edges the trees stand on the mountain slopes
  for (let ring = 0; ring < 3; ring++) {
    const off = -1.2 - ring * 2.3;
    const pts: [number, number][] = [];
    for (let t = off; t < MAP_W - off; t += 2.3 + R()) pts.push([t, off + R() * 0.8], [t, MAP_D - off - R() * 0.8]);
    for (let t = off; t < MAP_D - off; t += 2.3 + R()) pts.push([off + R() * 0.8, t], [MAP_W - off - R() * 0.8, t]);
    for (const [x, z] of pts) {
      if (isWet(kindAt(x, z)) || riverDistance(x, z) < 0.8) continue;
      const front = x > MAP_W - 0.5 || z > MAP_D - 0.5; // these would stand in front of the map
      if (front) {
        if (ring > 1) continue;
        queueSprite(pickBush(), x, z, { width: 1.2 + R() * 0.5, r: 0.2, flip: flip(), shadow: 0 });
        if (R() < 0.5) queueSprite(R() < 0.5 ? 'b08' : pickFlower(), x + 0.9, z - 0.4, { width: 0.8, r: 0.2, flip: flip(), shadow: 0 });
      } else {
        const [tn, tw] = pickTree();
        const onMountain = MOUNTAINS_ON && pastBackEdge(x, z) > 0.9;
        queueSprite(tn, x, z, { width: tw, r: 0.4, flip: flip(), shadow: onMountain ? 0 : 0.6, y: onMountain ? mountainHeight(x, z) - 0.05 : undefined });
        if (R() < 0.6 && !onMountain) queueSprite(pickBush(), x + 1.2 + R(), z + 1.2 + R(), { width: 1.1 + R() * 0.5, r: 0.2, flip: flip(), shadow: 0 });
      }
    }
  }
  // pines further up the mountain slopes, only where it is gentle enough for a tree to stand
  for (let n = 0, tries = 0; n < (MOUNTAINS_ON ? 110 : 0) && tries < 3000; tries++) {
    const back = 2 + R() * 9;
    const t = R();
    const x = t < 0.4 ? -back : -4 + R() * (MAP_W + 8);
    const z = t < 0.4 ? -4 + R() * (MAP_D + 8) : -back;
    const h = mountainHeight(x, z);
    if (Math.abs(mountainHeight(x + 0.6, z) - h) > 0.45 || Math.abs(mountainHeight(x, z + 0.6) - h) > 0.45) continue;
    const [tn, tw] = pickTree();
    queueSprite(tn, x, z, { width: tw * (0.8 + R() * 0.3), r: 0.4, flip: flip(), shadow: 0, y: h - 0.05 });
    n++;
  }

  // --- plant groups: one bush with flowers and sometimes a rock ----------------
  const cluster = (x: number, z: number, big = 1) => {
    if (!onFlat(x, z, 0.35) || nearPath(x, z, 0.8) || nearBridge(x, z, 0.5) || inGarden(x, z, 0.6) || isPlaza(x, z) || !free(x, z, 0.5)) return;
    put(pickBush(), x, z, { width: (1.05 + R() * 0.3) * big, r: 0.25, flip: flip(), shadow: 0, cast: 0.4 }, 0.5 * big);
    const n = 1 + Math.floor(R() * 2);
    for (let i = 0; i < n; i++) {
      const a = (R() - 0.5) * 2.2 + Math.PI * 0.25; // mostly in front of the bush
      const fx = x + Math.cos(a) * (0.55 + R() * 0.2);
      const fz = z + Math.sin(a) * (0.55 + R() * 0.2);
      if (onFlat(fx, fz, 0.2) && !nearPath(fx, fz, 0.7) && free(fx, fz, 0.22)) put(pickFlower(), fx, fz, { width: 0.6 + R() * 0.15, r: 0.15, flip: flip(), shadow: 0 }, 0.25);
    }
    if (R() < 0.4) {
      const rx = x - 0.55 + R() * 0.2;
      const rz = z - 0.35 + R() * 0.2;
      if (onFlat(rx, rz, 0.25) && free(rx, rz, 0.3)) put(R() < 0.5 ? 'b08' : 'b14', rx, rz, { width: 0.8 + R() * 0.2, r: 0.2, block: 0.3, flip: flip(), shadow: 0 }, 0.35);
    }
  };
  for (let i = 0; i < 510; i++) cluster(R() * MAP_W, R() * MAP_D, R() < 0.3 ? 1.2 : 1);
  // the house plots get extra flowers so they read as sunny open meadows
  for (const r of PLOTS) for (let i = 0; i < 8; i++) cluster(r[0] + R() * (r[1] - r[0]), r[2] + R() * (r[3] - r[2]), 0.9);
  // islands in the lake
  for (const [ix, iz, ir] of LAKE_ISLANDS) {
    put(pickBush(), ix - 0.2, iz - 0.2, { width: 1.1 * ir, r: 0.25, flip: flip(), shadow: 0, cast: 0.4 }, 0.4);
    put(pickFlower(), ix + 0.35, iz + 0.25, { width: 0.6, r: 0.15, flip: flip(), shadow: 0 }, 0.2);
    put('b08', ix - 0.45 * ir, iz + 0.45 * ir, { width: 0.75, r: 0.2, flip: flip(), shadow: 0 }, 0.2);
  }

  // --- along the cliff and river edges: grass tufts on the rim, rocks at the foot of walls you can see
  for (let cz = -1; cz <= MAP_D; cz++) {
    for (let cx = -1; cx <= MAP_W; cx++) {
      const k = cellKind(cx, cz);
      if (isWet(k) || k === 'stairs') continue;
      const h = groundHeight(cx + 0.5, cz + 0.5);
      for (const [dx, dz] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
        const nk = cellKind(cx + dx, cz + dz);
        const nh = groundHeight(cx + dx + 0.5, cz + dz + 0.5);
        if (h - nh < 0.3 || nk === 'stairs') continue;
        if (R() < 0.5) {
          const along = 0.2 + R() * 0.6;
          const inset = 0.2;
          const x = dx !== 0 ? cx + (dx > 0 ? 1 - inset : inset) : cx + along;
          const z = dz !== 0 ? cz + (dz > 0 ? 1 - inset : inset) : cz + along;
          if (onFlat(x, z, 0.15) && !nearBridge(x, z, 0.3) && !nearPath(x, z, 0.65) && !inGarden(x, z, 0.5) && free(x, z, 0.25)) {
            const pick = R();
            const name = pick < 0.45 ? 'b00' : pick < 0.75 ? pickFlower() : 'b04';
            put(name, x, z, { width: name === 'b04' ? 0.85 : 0.6 + R() * 0.15, r: 0.12, flip: flip(), shadow: 0 }, 0.25);
          }
        }
        // rocks at the foot of the walls facing the camera, on dry ground
        if ((dx === 1 || dz === 1) && !isWet(nk) && R() < 0.3) {
          const x = dx === 1 ? cx + 1.3 : cx + 0.25 + R() * 0.5;
          const z = dz === 1 ? cz + 1.3 : cz + 0.25 + R() * 0.5;
          if (onFlat(x, z, 0.2) && riverDistance(x, z) > 0.4 && !nearPath(x, z, 0.7) && !inGarden(x, z, 0.6) && free(x, z, 0.35) && Math.abs(groundHeight(x, z) - nh) < 0.1) {
            put(ROCKS[Math.floor(R() * ROCKS.length)], x, z, { width: 0.95 + R() * 0.35, r: 0.25, block: 0.35, flip: flip(), shadow: 0, cast: 0.3 }, 0.4);
          }
        }
      }
    }
  }

  // --- river: boulders and lily pads following the winding middle line ----------
  const RIV = STREAMS[0].pts; // the river's bent middle line (points every ~0.9)
  const along = (i: number, t: number, side: number): [number, number] => {
    const [ax, az] = RIV[i];
    const [bx, bz] = RIV[i + 1];
    const l = Math.hypot(bx - ax, bz - az);
    return [ax + (bx - ax) * t - ((bz - az) / l) * side, az + (bz - az) * t + ((bx - ax) / l) * side];
  };
  let seed = 1;
  for (let i = 3; i < RIV.length - 2; i += 3 + Math.floor(R() * 2)) {
    const [x, z] = along(i, 0.3 + R() * 0.4, (R() < 0.5 ? -1 : 1) * (0.25 + R() * 0.15));
    if (nearBridge(x, z, 0.6) || nearFall(x, z)) continue;
    boulder(scene, x, z, 0.4 + R() * 0.1, seed++, WATER - 0.04);
  }
  for (let i = 6; i < RIV.length - 2; i += 6) {
    const [x, z] = along(i, 0.5, (R() < 0.5 ? -1 : 1) * 0.5);
    if (!nearBridge(x, z, 0.6)) queueSprite('b09', x, z, { width: 0.62, r: 0.1, y: WATER + 0.01, shadow: 0 });
  }
  // plants along the top of both banks: reeds, bushes and flowers, not in a hedge
  for (const line of [RIV, STREAMS[1].pts]) for (let i = 1; i < line.length - 1; i++) {
    if (R() < 0.55) continue; // the bent lines have a point every ~0.9: keep the old spacing (~2 units)
    const [ax, az] = line[i];
    const [bx, bz] = line[i + 1];
    const l = Math.hypot(bx - ax, bz - az);
    for (let d = 0.4; d < l; d += 1.1 + R() * 0.9) {
      for (const sgn of [-1, 1]) {
        if (R() < 0.45) continue;
        const t = d / l;
        const side = sgn * (1.45 + R() * 0.35);
        const x = ax + (bx - ax) * t - ((bz - az) / l) * side;
        const z = az + (bz - az) * t + ((bx - ax) / l) * side;
        if (!onFlat(x, z, 0.18) || nearPath(x, z, 0.7) || nearBridge(x, z, 0.5) || !free(x, z, 0.3)) continue;
        const pick = R();
        const name = pick < 0.3 ? 'b05' : pick < 0.6 ? pickBush() : pick < 0.85 ? pickFlower() : 'b00';
        put(name, x, z, { width: name === 'b04' || name === 'b01' ? 0.95 : 0.7, r: 0.15, flip: flip(), shadow: 0 }, 0.3);
      }
    }
  }

  // --- lake: lily pads and lotus on the water, cattails around the shore, a few boulders
  for (let n = 0, tries = 0; n < 34 && tries < 2000; tries++) {
    const x = 40 + R() * 24;
    const z = 27.5 + R() * 9;
    if (!inLake(x, z) || riverDistance(x + 0.5, z) > 0 || riverDistance(x - 0.5, z) > 0 || riverDistance(x, z + 0.5) > 0 || riverDistance(x, z - 0.5) > 0) continue;
    if (!free(x, z, 0.3)) continue;
    put(R() < 0.25 ? 'b07' : 'b09', x, z, { width: 0.55 + R() * 0.25, r: 0.1, y: WATER + 0.01, flip: flip(), shadow: 0 }, 0.3);
    n++;
  }
  for (let n = 0, tries = 0; n < 5 && tries < 500; tries++) {
    const x = 41 + R() * 22;
    const z = 28 + R() * 8;
    if (!inLake(x, z) || !free(x, z, 0.5)) continue;
    boulder(scene, x, z, 0.4 + R() * 0.15, seed++, WATER - 0.04);
    placed.push({ x, z, r: 0.5 });
    n++;
  }
  for (let n = 0, tries = 0; n < 46 && tries < 3000; tries++) {
    const x = 38 + R() * 28;
    const z = 25 + R() * 14;
    const d = riverDistance(x, z);
    if (d < 0.15 || d > 0.7 || !onFlat(x, z, 0.15) || nearPath(x, z, 0.7) || nearBridge(x, z, 0.5) || !free(x, z, 0.28)) continue;
    let nearLake = false;
    for (const [ox, oz] of [[0.9, 0], [-0.9, 0], [0, 0.9], [0, -0.9]]) if (inLake(x + ox, z + oz)) nearLake = true;
    if (!nearLake) continue;
    put(R() < 0.6 ? 'b05' : 'b00', x, z, { width: 0.7 + R() * 0.2, r: 0.14, flip: flip(), shadow: 0 }, 0.28);
    n++;
  }

  // --- marsh: lotus and lily pads in groups on the still water, reeds along the shores, a few pines
  {
    const onBoard = (x: number, z: number, pad: number) => BOARDWALKS.some((b) => lineDist(x, z, b).d < BOARD_HALF + pad);
    const openWater = (x: number, z: number, r: number) =>
      inLake(x, z) && inLake(x + r, z) && inLake(x - r, z) && inLake(x, z + r) && inLake(x, z - r);
    for (let g = 0, tries = 0; g < 70 && tries < 4000; tries++) {
      const cx = R() * MAP_W;
      const cz = 38 + R() * (MAP_D - 38);
      if (!inMarsh(cx, cz) || !openWater(cx, cz, 0.6) || onBoard(cx, cz, 0.6)) continue;
      g++;
      const n = 3 + Math.floor(R() * 6);
      for (let k = 0; k < n; k++) {
        const x = cx + (R() - 0.5) * 2.2;
        const z = cz + (R() - 0.5) * 1.6;
        if (!openWater(x, z, 0.3) || onBoard(x, z, 0.35) || !free(x, z, 0.26)) continue;
        put(R() < 0.35 ? 'b07' : 'b09', x, z, { width: 0.55 + R() * 0.3, r: 0.1, y: WATER + 0.01, flip: flip(), shadow: 0 }, 0.26);
      }
    }
    for (let n = 0, tries = 0; n < 260 && tries < 9000; tries++) {
      const x = R() * MAP_W;
      const z = 36 + R() * (MAP_D - 36);
      if (!inMarsh(x, z) && z < 40) continue;
      const d = riverDistance(x, z);
      if (d < 0.1 || d > 0.8 || !onFlat(x, z, 0.15) || nearPath(x, z, 0.6) || nearBridge(x, z, 0.5) || !free(x, z, 0.26)) continue;
      put(R() < 0.65 ? 'b05' : 'b00', x, z, { width: 0.65 + R() * 0.3, r: 0.14, flip: flip(), shadow: 0 }, 0.26);
      n++;
    }
    for (let n = 0, tries = 0; n < 34 && tries < 3000; tries++) {
      const x = R() * MAP_W;
      const z = 41 + R() * (MAP_D - 41);
      if (riverDistance(x, z) < 1.0 || nearPath(x, z, 1.4) || z > MAP_D - 3 || x > MAP_W - 3 || !onFlat(x, z, 0.45) || !free(x, z, 1.0)) continue;
      const [tn, tw] = pickTree();
      put(tn, x, z, { width: tw, r: 0.4, block: 0.35, flip: flip(), shadow: 0.6 }, 1.05);
      n++;
    }
  }

  // --- a light sprinkle of small flowers --------------------------------------
  for (let i = 0; i < 750; i++) {
    const x = R() * MAP_W;
    const z = R() * MAP_D;
    if (!onFlat(x, z, 0.3) || nearPath(x, z, 0.8) || nearBridge(x, z, 0.6) || inGarden(x, z, 0.6) || isPlaza(x, z) || !free(x, z, 0.3)) continue;
    put(R() < 0.7 ? 'b03' : 'b00', x, z, { width: 0.45 + R() * 0.15, r: 0.1, flip: flip(), shadow: 0 }, 0.2);
  }

  await flushSprites(scene, noise);
  await scatterDecals(scene, 940);
  return { spring: new THREE.Vector3(SPRING.x, groundHeight(SPRING.x, SPRING.z), SPRING.z) };
}

// LOAD SPEED: the walking grid asks this for 20,000 squares, and there are thousands of blockers.
// Each 1×1 square keeps a list of the blockers that reach into it (rebuilt when blockers are added).
const BLOCK_PAD = 0.25;
let blockLists: { start: Int32Array; items: Int32Array; count: number } | null = null;
export function isBlocked(x: number, z: number, pad = BLOCK_PAD): boolean {
  const cx = Math.floor(x);
  const cz = Math.floor(z);
  if (pad > BLOCK_PAD || cx < 0 || cz < 0 || cx >= MAP_W || cz >= MAP_D) {
    for (const b of blockers) if (Math.hypot(x - b.x, z - b.z) < b.r + pad) return true;
    return false;
  }
  if (!blockLists || blockLists.count !== blockers.length) {
    const cells: number[][] = Array.from({ length: MAP_W * MAP_D }, () => []);
    blockers.forEach((b, i) => {
      const r = b.r + BLOCK_PAD;
      for (let j = Math.max(0, Math.floor(b.z - r)); j <= Math.min(MAP_D - 1, Math.floor(b.z + r)); j++) {
        for (let k = Math.max(0, Math.floor(b.x - r)); k <= Math.min(MAP_W - 1, Math.floor(b.x + r)); k++) cells[j * MAP_W + k].push(i);
      }
    });
    const start = new Int32Array(MAP_W * MAP_D + 1);
    const items: number[] = [];
    cells.forEach((c, i) => { start[i] = items.length; items.push(...c); });
    start[MAP_W * MAP_D] = items.length;
    blockLists = { start, items: Int32Array.from(items), count: blockers.length };
  }
  const cell = cz * MAP_W + cx;
  for (let k = blockLists.start[cell], end = blockLists.start[cell + 1]; k < end; k++) {
    const b = blockers[blockLists.items[k]];
    if (Math.hypot(x - b.x, z - b.z) < b.r + pad) return true;
  }
  return false;
}
