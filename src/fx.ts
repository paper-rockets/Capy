import * as THREE from 'three';
import { ELEV } from './props';

// ---------------------------------------------------------------------------
// Little painted moments of joy (Codex Round 7, cut by tools/cut_round7.py):
// sparkle bursts, water splashes, dust puffs, garden puffs, and small icons that float up.
// Each effect is a strip of 256 px frames in public/fx, played on a sprite that faces the camera.
// Sprites are kept and reused, and every copy of a strip shares one picture on the graphics chip.
// ---------------------------------------------------------------------------

export type FxKind = 'sparkle' | 'splash' | 'dust' | 'dig' | 'water' | 'sprout' | 'harvest' | 'shine';
export type PopIcon = 'heart' | 'star' | 'leaf' | 'sparkle' | 'sun';

/** size = world units across one frame; cy = where the ground point sits in the frame (0 = bottom, 1 = top) */
const KINDS: Record<FxKind, { file: string; frames: number; fps: number; size: number; cy: number }> = {
  sparkle: { file: 'e1_sparkle', frames: 6, fps: 11, size: 1.7, cy: 0.5 },
  splash: { file: 'e2_splash', frames: 6, fps: 12, size: 1.1, cy: 0.37 },
  dust: { file: 'e3_dust', frames: 4, fps: 12, size: 0.62, cy: 0.12 },
  dig: { file: 'b1_dig', frames: 6, fps: 10, size: 1.15, cy: 0.14 },
  water: { file: 'b2_water', frames: 6, fps: 10, size: 1.05, cy: 0.14 },
  sprout: { file: 'b3_sprout', frames: 6, fps: 10, size: 1.1, cy: 0.14 },
  harvest: { file: 'b4_harvest', frames: 6, fps: 11, size: 1.3, cy: 0.14 },
  shine: { file: 'b5_shine', frames: 4, fps: 5, size: 1.0, cy: 0.14 },
};
const POP_FILES: Record<PopIcon, string> = {
  heart: 'fx/pop_heart.webp',
  star: 'fx/pop_star.webp',
  leaf: 'fx/pop_leaf.webp',
  sparkle: 'fx/pop_sparkle.webp',
  sun: 'ui/icon_sun.webp',
};

/** From a point toward the camera: sliding along it keeps the screen position but draws the effect in front of what it sits on. */
const TO_CAMERA = new THREE.Vector3(Math.cos(ELEV) * Math.SQRT1_2, Math.sin(ELEV), Math.cos(ELEV) * Math.SQRT1_2);

interface PlayOpts {
  /** world units across (default: the effect's own size) */
  size?: number;
  /** how far toward the camera it is drawn (default 1.2; small = things in front can hide it) */
  shift?: number;
  /** seconds to wait before it starts */
  delay?: number;
  /** play the strip this many times (default 1) */
  repeat?: number;
  flip?: boolean;
}
interface Running { s: THREE.Sprite; kind: FxKind; t: number; delay: number; repeat: number; loop: boolean; flip: boolean }
interface Pop { s: THREE.Sprite; t: number; delay: number; vx: number; size: number }

let scene: THREE.Scene | null = null;
const loader = new THREE.TextureLoader();
const strips = new Map<FxKind, THREE.Texture>();
const popTex = new Map<PopIcon, THREE.Texture>();
const free = new Map<FxKind, THREE.Sprite[]>();
const freePops = new Map<PopIcon, THREE.Sprite[]>();
const running: Running[] = [];
const loops = new Map<string, Running>();
const pops: Pop[] = [];

function texture(url: string): THREE.Texture {
  const t = loader.load(url);
  t.colorSpace = THREE.SRGBColorSpace;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

function sprite(kind: FxKind, opts: PlayOpts, x: number, y: number, z: number): THREE.Sprite {
  const k = KINDS[kind];
  let s = free.get(kind)?.pop();
  if (!s) {
    // a copy of the strip with its own frame window; the picture itself is shared
    const map = strips.get(kind)!.clone();
    map.repeat.set(1 / k.frames, 1);
    s = new THREE.Sprite(new THREE.SpriteMaterial({ map, transparent: true, depthWrite: false }));
    s.renderOrder = 14;
    s.name = 'fx';
    scene!.add(s);
  }
  const size = opts.size ?? k.size;
  s.scale.set(size, size, 1);
  s.center.set(0.5, k.cy);
  s.position.set(x, y, z).addScaledVector(TO_CAMERA, opts.shift ?? 1.2);
  s.visible = false;
  return s;
}

/** Show one frame of the strip (mirrored by reading it right to left: a mirrored sprite would face away and vanish). */
function setFrame(r: Running, frame: number) {
  const k = KINDS[r.kind];
  const map = r.s.material.map as THREE.Texture;
  map.repeat.x = (r.flip ? -1 : 1) / k.frames;
  map.offset.set((frame + (r.flip ? 1 : 0)) / k.frames, 0);
}

function release(r: Running) {
  r.s.visible = false;
  free.get(r.kind)!.push(r.s);
}

export const fx = {
  /** Load the pictures (call once, before the first frame). */
  init(target: THREE.Scene) {
    scene = target;
    for (const [kind, k] of Object.entries(KINDS) as [FxKind, (typeof KINDS)[FxKind]][]) {
      strips.set(kind, texture(`fx/${k.file}.webp`));
      free.set(kind, []);
    }
    for (const [icon, url] of Object.entries(POP_FILES) as [PopIcon, string][]) {
      popTex.set(icon, texture(url));
      freePops.set(icon, []);
    }
  },

  /** Play an effect once at a ground point (x, y, z). */
  play(kind: FxKind, x: number, y: number, z: number, opts: PlayOpts = {}) {
    if (!scene) return;
    running.push({ s: sprite(kind, opts, x, y, z), kind, t: 0, delay: opts.delay ?? 0, repeat: opts.repeat ?? 1, loop: false, flip: !!opts.flip });
  },

  /** Keep an effect looping under a name (e.g. the shine over a ripe bed); kind null stops it. */
  loop(key: string, kind: FxKind | null, x = 0, y = 0, z = 0, opts: PlayOpts = {}) {
    if (!scene) return;
    const old = loops.get(key);
    if (old && old.kind === kind) return;
    if (old) {
      release(old);
      loops.delete(key);
    }
    if (kind) loops.set(key, { s: sprite(kind, opts, x, y, z), kind, t: Math.random() * 2, delay: 0, repeat: 1, loop: true, flip: !!opts.flip });
  },

  /** Little icons that pop up and float away (hearts, stars, golden leaves, sun coins). */
  pop(icon: PopIcon, x: number, y: number, z: number, n = 1, size = 0.42, delay = 0) {
    if (!scene) return;
    for (let i = 0; i < n; i++) {
      let s = freePops.get(icon)!.pop();
      if (!s) {
        s = new THREE.Sprite(new THREE.SpriteMaterial({ map: popTex.get(icon)!, transparent: true, depthTest: false, depthWrite: false }));
        s.renderOrder = 19;
        s.name = 'fx';
        s.userData.icon = icon;
        scene.add(s);
      }
      s.position.set(x + (n > 1 ? (Math.random() - 0.5) * 0.5 : 0), y, z);
      s.visible = false;
      pops.push({ s, t: 0, delay: delay + i * 0.14, vx: (Math.random() - 0.5) * 0.5, size });
    }
  },

  update(dt: number) {
    for (let i = running.length - 1; i >= 0; i--) {
      const r = running[i];
      if (r.delay > 0) {
        r.delay -= dt;
        continue;
      }
      const k = KINDS[r.kind];
      r.t += dt;
      const frame = Math.floor(r.t * k.fps);
      if (frame >= k.frames * r.repeat) {
        release(r);
        running.splice(i, 1);
        continue;
      }
      r.s.visible = true;
      setFrame(r, frame % k.frames);
    }
    for (const r of loops.values()) {
      const k = KINDS[r.kind];
      r.t += dt;
      r.s.visible = true;
      setFrame(r, Math.floor(r.t * k.fps) % k.frames);
    }
    for (let i = pops.length - 1; i >= 0; i--) {
      const p = pops[i];
      if (p.delay > 0) {
        p.delay -= dt;
        continue;
      }
      p.t += dt;
      const LIFE = 1.3;
      if (p.t > LIFE) {
        p.s.visible = false;
        freePops.get(p.s.userData.icon as PopIcon)!.push(p.s);
        pops.splice(i, 1);
        continue;
      }
      // pops in with a little bounce, floats up, fades at the end
      const grow = p.t < 0.18 ? (p.t / 0.18) * 1.15 : 1.15 - Math.min(0.15, (p.t - 0.18) * 0.6);
      p.s.visible = true;
      p.s.position.y += dt * 0.75;
      p.s.position.x += p.vx * dt;
      p.s.scale.set(p.size * grow, p.size * grow, 1);
      p.s.material.opacity = Math.min(1, (LIFE - p.t) / 0.35);
    }
  },
};
