import * as THREE from 'three';
import { fbm } from './noise';
import { splitIntoChunks } from './chunks';
import { MAP_D, MAP_W, groundHeight } from './world';

// ---------------------------------------------------------------------------
// Mountains along the two back edges of the map (the edges furthest from the camera):
// scenery only, you can't walk into them. Rocky where steep, grassy where gentle,
// a little misty further back, with soft clouds drifting among the peaks.
// Nothing tall goes along the two front edges: it would hide the land.
// ---------------------------------------------------------------------------

// OFF by default: the user didn't like these 3D mountains (2026-09-26); painted mountain pictures from Codex will
// replace them. ?mountains shows them again.
export const MOUNTAINS_ON = typeof location !== 'undefined' && new URLSearchParams(location.search).has('mountains');

const DEPTH = 26; // how far the range reaches back from the edge
const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** How far a point is past the back edges (0 or less = on the map or in front of it). */
export function pastBackEdge(x: number, z: number): number {
  return Math.max(-x, -z);
}

/** Height of the mountain surface at a point past the back edges. */
export function mountainHeight(x: number, z: number): number {
  const d = pastBackEdge(x, z);
  // the ground at the nearest point of the map's edge: the mountains rise from there
  const edge = groundHeight(Math.max(0.05, Math.min(MAP_W - 0.05, x)), Math.max(0.05, Math.min(MAP_D - 0.05, z)));
  const rise = smooth(0.6, 6, d);
  // a ridge (folded noise) with round rocky spires standing out of it, like the painted peaks
  const ridge = 1 - Math.abs(2 * fbm(x * 0.07, z * 0.07, 301, 4) - 1);
  const spire = smooth(0.5, 0.72, fbm(x * 0.21 + 40, z * 0.21, 303, 2));
  // the range dies down past the map's two side corners instead of running on into nothing
  const ends = smooth(MAP_W + 5, MAP_W - 4, x) * smooth(MAP_D + 5, MAP_D - 4, z);
  const tall = (0.6 + 0.4 * smooth(3, 16, d)) * ends;
  return edge + 0.12 + rise * (2 + ridge * ridge * 7 + spire * 9 * smooth(1.5, 4, d)) * tall;
}

export interface MountainTextures { rock: THREE.Texture; grass: THREE.Texture; grassScale: number }

export function buildMountains(sun: THREE.Vector3, tex: MountainTextures): THREE.Group {
  const group = new THREE.Group();
  group.name = 'mountains';
  // two vertices per map square (rounder peaks) over the band behind the two back edges
  const STEP = 0.5;
  const x0 = -DEPTH;
  const x1 = MAP_W + 5;
  const z0 = -DEPTH;
  const z1 = MAP_D + 5;
  const nx = (x1 - x0) / STEP;
  const nz = (z1 - z0) / STEP;
  const pos = new Float32Array((nx + 1) * (nz + 1) * 3);
  const past = new Float32Array((nx + 1) * (nz + 1));
  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      const x = x0 + i * STEP;
      const z = z0 + j * STEP;
      const k = j * (nx + 1) + i;
      const d = pastBackEdge(x, z);
      // wobble the grid a little so the slopes don't show rows of squares
      const wx = x + (fbm(x * 0.5, z * 0.5, 311) - 0.5) * 0.4 * smooth(1, 3, d);
      const wz = z + (fbm(x * 0.5 + 9, z * 0.5, 312) - 0.5) * 0.4 * smooth(1, 3, d);
      pos[k * 3] = wx;
      pos[k * 3 + 1] = d > 0.3 ? mountainHeight(wx, wz) : groundHeight(Math.max(0.05, x), Math.max(0.05, z)) - 0.3;
      pos[k * 3 + 2] = wz;
      past[k] = d;
    }
  }
  const index: number[] = [];
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i;
      const b = a + 1;
      const c = a + nx + 1;
      const e = c + 1;
      // only the squares past the back edges (the first row tucks under the map's own ground)
      if (Math.max(past[a], past[b], past[c], past[e]) < 0.9) continue;
      index.push(a, c, b, b, c, e);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aPast', new THREE.BufferAttribute(past, 1));
  geo.setIndex(index);
  geo.computeVertexNormals();

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uRock: { value: tex.rock },
      uGrass: { value: tex.grass },
      uGrassScale: { value: tex.grassScale },
      uSun: { value: sun },
      uHaze: { value: new THREE.Color(0xc9dfd2) },
    },
    vertexShader: /* glsl */ `
      attribute float aPast;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying float vPast;
      void main() {
        vWorld = position; vNormal = normal; vPast = aPast;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uRock;
      uniform sampler2D uGrass;
      uniform float uGrassScale;
      uniform vec3 uSun;
      uniform vec3 uHaze;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying float vPast;
      void main() {
        vec3 N = normalize(vNormal);
        // steep = rock (the mossy boulder picture, stood up), gentle = grass; only read what is needed
        float steep = smoothstep(0.1, 0.32, 1.0 - N.y);
        // grass only holds on the lower slopes and on ledges
        steep = max(steep, smoothstep(0.55, 0.9, 1.0 - N.y + (vWorld.y - 6.0) * 0.08));
        vec3 col = vec3(0.0);
        if (steep < 0.99) col += texture2D(uGrass, vWorld.xz / uGrassScale).rgb * vec3(0.7, 0.88, 0.72) * (1.0 - steep);
        if (steep > 0.01) col += texture2D(uRock, vec2((vWorld.x - vWorld.z) * 0.22, vWorld.y * 0.3)).rgb * vec3(1.02, 0.98, 1.06) * steep;
        // lighter grey-lilac up high, like the painted peaks
        col = mix(col, col * vec3(1.08, 1.05, 1.14), smoothstep(6.0, 14.0, vWorld.y));
        float ndl = max(dot(N, normalize(uSun)), 0.0);
        col *= vec3(0.62, 0.65, 0.72) + vec3(0.6, 0.55, 0.45) * ndl;
        // misty further back, so the range has depth
        col = mix(col, uHaze, smoothstep(5.0, 24.0, vPast) * 0.55);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
  group.add(splitIntoChunks(geo, mat, 0, 0, 'mountains'));
  return group;
}

// ---------------------------------------------------------------------------
// Clouds: a few big soft puffs among the peaks, drifting slowly along the range.
// ---------------------------------------------------------------------------

export interface Clouds { group: THREE.Group; update: (t: number) => void }

export function buildClouds(): Clouds {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d')!;
  // a cloud = several soft round blobs, flat underneath
  for (const [x, y, r] of [[70, 78, 44], [120, 62, 54], [175, 76, 42], [100, 88, 36], [150, 90, 36], [205, 88, 26], [45, 92, 26]]) {
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(255,255,255,0.95)');
    grd.addColorStop(0.65, 'rgba(255,255,255,0.75)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const group = new THREE.Group();
  group.name = 'clouds';
  const items: { s: THREE.Sprite; base: THREE.Vector3; speed: number; span: number }[] = [];
  const rnd = (i: number, k: number) => fbm(i * 3.1 + k, k * 1.7, 777 + k, 1);
  const N = 14;
  for (let i = 0; i < N; i++) {
    // spread along both back edges, among the lower slopes and the middle of the range
    const along = (i + 0.5) / N;
    const back = 3 + rnd(i, 1) * 10;
    const alongBack = along < 0.4;
    const x = alongBack ? -back : -6 + (along - 0.4) / 0.6 * (MAP_W + 10);
    const z = alongBack ? -6 + along / 0.4 * (MAP_D + 8) : -back;
    const y = 3.5 + rnd(i, 2) * 5;
    const m = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.8 });
    const s = new THREE.Sprite(m);
    const w = 7 + rnd(i, 3) * 6;
    s.scale.set(w, w * 0.45, 1);
    s.renderOrder = 4;
    group.add(s);
    items.push({ s, base: new THREE.Vector3(x, y, z), speed: 0.15 + rnd(i, 4) * 0.2, span: 3 });
  }
  const update = (t: number) => {
    for (const it of items) {
      const o = Math.sin(t * it.speed * 0.2 + it.base.x * 0.3) * it.span;
      it.s.position.set(it.base.x + o * 0.7, it.base.y + Math.sin(t * 0.1 + it.base.z) * 0.15, it.base.z - o * 0.7);
    }
  };
  update(0);
  return { group, update };
}
