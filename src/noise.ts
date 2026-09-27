import * as THREE from 'three';

// Small deterministic noise helpers shared by the terrain builder and the shaders.

export function hash2(x: number, y: number, seed = 0): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

export function vnoise(x: number, y: number, seed = 0, period = 0): number {
  let xi = Math.floor(x);
  let yi = Math.floor(y);
  const u = smooth(x - xi);
  const v = smooth(y - yi);
  let xj = xi + 1;
  let yj = yi + 1;
  if (period > 0) {
    xi = ((xi % period) + period) % period;
    yi = ((yi % period) + period) % period;
    xj = ((xj % period) + period) % period;
    yj = ((yj % period) + period) % period;
  }
  const a = hash2(xi, yi, seed);
  const b = hash2(xj, yi, seed);
  const c = hash2(xi, yj, seed);
  const d = hash2(xj, yj, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export function fbm(x: number, y: number, seed = 0, octaves = 3): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * vnoise(x * freq, y * freq, seed + i * 17);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Tileable RGBA noise: R = broad, G = medium, B = fine, A = very fine. */
export function makeNoiseTexture(size = 256): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  const layers = [4, 16, 48, 96];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      for (let c = 0; c < 4; c++) {
        const p = layers[c];
        const fx = (x / size) * p;
        const fy = (y / size) * p;
        const n = 0.65 * vnoise(fx, fy, c * 31, p) + 0.35 * vnoise(fx * 2, fy * 2, c * 31 + 7, p * 2);
        data[i + c] = Math.max(0, Math.min(255, Math.round(n * 255)));
      }
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}
