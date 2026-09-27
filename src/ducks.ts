import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { WATER } from './world';
import { addOutlines } from './outline';
import { fx } from './fx';

// ---------------------------------------------------------------------------
// Mama Duck and her lost ducklings (the side quest).
// Mama waits sadly on the lake. Four ducklings are lost around the meadow, looking around and
// peeping. When Mochi comes close, a duckling cheers up and follows him in a line; walk the
// line back to the lake and the ducklings swim out to Mama. All four home = happy family.
// Models: assets/animals A01 ducks, main (not toon) version (clips idle, waddle, walk, swim, flap, sad, happy;
// the happy/sad eyes are keyed inside the clips).
// ---------------------------------------------------------------------------

/** Where the ducklings are lost (all checked reachable from the start). */
export const DUCKLING_SPOTS: [number, number][] = [
  [47.3, 3.2], // by the stone arch north of the first bridge (an easy first find)
  [35.6, 4.8], // by the cave under the high cliff
  [18.6, 15.8], // on top of the orchard hill
  [66.0, 17.5], // in the east meadow by the house plots
  [70.2, 31.5], // on top of the lookout hill
  [7.6, 28.8], // at the foot of the west waterfall
  [37.3, 50.5], // at the end of the boardwalk to the lotus island
  [74.2, 53.4], // at the end of the east marsh zig-zag
];
/** Middle of Mama's little circle on the lake, off the south shore path. */
export const MAMA_AT: [number, number] = [54.0, 34.2];
/** Standing here (on the shore path) with ducklings in tow sends them home. */
const SHORE: [number, number] = [54.0, 37.4];
const HOME_RADIUS = 3.4;
const FIND_RADIUS = 1.4;

// sizes on screen (world units nose to tail): bigger than real, so kids can spot them on the grass
const MAMA_LEN = 0.95;
const DUCKLING_LEN = 0.6;
/** Followers keep this far back along Mochi's footsteps (he is 1.25 long, so the first one isn't in his tail). */
const FOLLOW_FIRST = 1.65;
const FOLLOW_GAP = 0.78;
/** Dark outline around every duck (world units thick), like the painted art, so they stand out. */
const OUTLINE = 0.022;
// walking speed of each clip at 1x, in model units per second (from animals_index.csv)
const WALK_CLIP = { adult: 0.4091, duckling: 0.303 };

export interface DuckEvents {
  /** a lost duckling was found (count = how many found so far) */
  found(count: number, total: number): void;
  /** ducklings reached Mama (count = how many are home) */
  home(count: number, total: number): void;
}
export interface DuckWorld {
  standHeight(x: number, z: number): number;
  isWater(x: number, z: number): boolean;
}

type State = 'lost' | 'found' | 'follow' | 'going' | 'home' | 'mama';
/** What gets saved: each duckling is still lost, following Mochi, or home with Mama. */
export interface DuckSave { chicks: ('lost' | 'follow' | 'home')[] }
interface Duck {
  root: THREE.Group;
  mixer: THREE.AnimationMixer;
  actions: Map<string, THREE.AnimationAction>;
  current: string;
  scale: number; // model units → world units
  clipSpeed: number;
  state: State;
  x: number;
  z: number;
  y: number;
  heading: number;
  t: number; // time in the current state
  slot: number; // place in the line / around Mama
  marker?: THREE.Sprite;
  /** eye shape keys: sad from being lost until back with Mama, happy after */
  eyes: { inf: number[]; sad: number; happy: number }[];
  mood: 'sad' | 'happy' | null;
  /** in the water last frame (for the splash when it hops in) */
  wet?: boolean;
}

/** Hold the eyes sad or happy whatever the clip says (the clips only key them in sad/happy). */
function applyMood(d: Duck) {
  if (!d.mood) return;
  for (const e of d.eyes) {
    if (e.sad >= 0) e.inf[e.sad] = d.mood === 'sad' ? 1 : 0;
    if (e.happy >= 0) e.inf[e.happy] = d.mood === 'happy' ? 1 : 0;
  }
}

function play(d: Duck, name: string, timeScale = 1) {
  const a = d.actions.get(name);
  if (!a) return;
  a.timeScale = timeScale;
  if (d.current === name) return;
  const prev = d.actions.get(d.current);
  a.reset().play();
  if (prev) a.crossFadeFrom(prev, 0.25, false);
  d.current = name;
}

/** Painted duckling pin over a lost duckling (public/ui, from Codex), so children can spot it from far away. */
const pinTex = new THREE.TextureLoader().load('ui/pin_duckling.webp', (t) => { t.colorSpace = THREE.SRGBColorSpace; });
pinTex.colorSpace = THREE.SRGBColorSpace;
function lostMarker(): THREE.Sprite {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: pinTex, depthTest: false, depthWrite: false }));
  s.center.set(0.5, 0);
  s.renderOrder = 19;
  return s;
}

export async function loadDucks(scene: THREE.Scene, world: DuckWorld, events: DuckEvents) {
  const loader = new GLTFLoader();
  const [adult, chick] = await Promise.all([
    loader.loadAsync('models/A01_duck_adult.glb'),
    loader.loadAsync('models/A01_duckling.glb'),
  ]);
  // everything under the water line is cut away, so swimming ducks sit IN the water
  const waterCut = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(WATER - 0.005));

  const make = (gltf: typeof adult, len: number, clipSpeed: number, state: State, x: number, z: number): Duck => {
    const model = cloneSkinned(gltf.scene);
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const scale = len / Math.max(size.x, size.z);
    model.scale.setScalar(scale);
    model.position.y = -box.min.y * scale;
    const eyes: Duck['eyes'] = [];
    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      if (m.morphTargetDictionary && m.morphTargetInfluences) {
        const sad = m.morphTargetDictionary['eyes_sad'] ?? -1;
        const happy = m.morphTargetDictionary['eyes_happy'] ?? -1;
        if (sad >= 0 || happy >= 0) eyes.push({ inf: m.morphTargetInfluences, sad, happy });
      }
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) {
        mat.transparent = true; // drawn after the pictures, like Mochi, so in front/behind stays right
        mat.depthWrite = true;
        mat.clippingPlanes = [waterCut];
        // a little glow from their own colours: brighter yellow, less dark shading, so they pop on the grass
        const std = mat as THREE.MeshStandardMaterial;
        if (std.isMeshStandardMaterial && std.map) {
          std.emissiveMap = std.map;
          std.emissive = new THREE.Color(0.32, 0.3, 0.26);
        }
      }
      m.renderOrder = 10;
      m.frustumCulled = false;
    });
    addOutlines(model, OUTLINE, [waterCut]);
    const root = new THREE.Group();
    root.name = 'ducks';
    root.add(model);
    const sh = new THREE.Mesh(
      new THREE.CircleGeometry(len * 0.36, 20).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x2c3a10, transparent: true, opacity: 0.25, depthWrite: false }),
    );
    sh.scale.set(1, 1, 0.7);
    sh.position.y = 0.03;
    (sh.material as THREE.MeshBasicMaterial).opacity = 0.38;
    sh.name = 'shadow';
    root.add(sh);
    scene.add(root);
    const mixer = new THREE.AnimationMixer(model);
    const actions = new Map<string, THREE.AnimationAction>();
    for (const clip of gltf.animations) actions.set(clip.name, mixer.clipAction(clip));
    const d: Duck = { root, mixer, actions, current: '', scale, clipSpeed, state, x, z, y: 0, heading: Math.random() * 6.28, t: Math.random() * 5, slot: 0, eyes, mood: 'sad' };
    return d;
  };

  const mama = make(adult, MAMA_LEN, WALK_CLIP.adult, 'mama', MAMA_AT[0], MAMA_AT[1]);
  const chicks = DUCKLING_SPOTS.map(([x, z]) => {
    const d = make(chick, DUCKLING_LEN, WALK_CLIP.duckling, 'lost', x, z);
    d.marker = lostMarker();
    scene.add(d.marker);
    return d;
  });
  console.log('Duck clips:', [...mama.actions.keys()].join(', '));


  type Pt = { x: number; z: number };
  // Mochi's footsteps: the ducklings walk exactly where he walked, so they never cut across water or cliffs.
  // Mama leaves a wake the same way, and the ducklings that are home swim in it.
  const trail: Pt[] = [];
  const wake: Pt[] = [];
  const record = (list: Pt[], x: number, z: number, gap: number) => {
    const last = list[list.length - 1];
    if (!last || Math.hypot(x - last.x, z - last.z) > gap) {
      list.push({ x, z });
      if (list.length > 400) list.shift();
    }
  };
  /** Point on a trail, `back` world units behind its newest point (null if the trail is empty). */
  const along = (list: Pt[], fromX: number, fromZ: number, back: number): Pt | null => {
    if (!list.length) return null;
    let left = back;
    let ax = fromX;
    let az = fromZ;
    for (let i = list.length - 1; i >= 0; i--) {
      const b = list[i];
      const l = Math.hypot(ax - b.x, az - b.z);
      if (l >= left) {
        const k = left / l;
        return { x: ax + (b.x - ax) * k, z: az + (b.z - az) * k };
      }
      left -= l;
      ax = b.x;
      az = b.z;
    }
    return { x: list[0].x, z: list[0].z };
  };

  let found = 0;
  let home = 0;
  let allHomeT = 0; // time since the whole family got back together
  let mamaCheer = 0; // Mama is happy for a moment each time a duckling comes back
  /** painted hearts (Codex) that pop up when a duckling gets home */
  const popHearts = (x: number, y: number, z: number, n: number) => fx.pop('heart', x, y, z, n, 0.34);

  /** Move a duck toward (tx, tz) at up to maxSpeed; returns how fast it actually moved. */
  const stepToward = (d: Duck, tx: number, tz: number, maxSpeed: number, dt: number) => {
    const dx = tx - d.x;
    const dz = tz - d.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.02 || dt <= 0) return 0;
    const step = Math.min(dist, maxSpeed * dt, dist * Math.min(1, dt * 6));
    d.x += (dx / dist) * step;
    d.z += (dz / dist) * step;
    turnTo(d, Math.atan2(dx, dz), dt);
    return step / dt;
  };
  const turnTo = (d: Duck, want: number, dt: number) => {
    let turn = want - d.heading;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    d.heading += turn * Math.min(1, dt * 10);
  };
  const walkRate = (d: Duck, speed: number) => Math.min(3.2, Math.max(0.6, speed / (d.clipSpeed * d.scale)));
  /** Home duckling i swims this far behind Mama, in her wake. */
  const wakeBack = (i: number) => 0.95 + i * 0.55;

  let mamaAngle = 0;
  function update(dt: number, time: number, player: { x: number; z: number }, viewH: number) {
    record(trail, player.x, player.z, 0.08);

    // --- Mama: a slow little circle on the lake, sad until everyone is home, then a wider happy loop
    const allHome = home === chicks.length;
    const rx = allHome ? 1.5 : 0.8;
    mamaAngle += dt * (allHome ? 0.3 : 0.25);
    const px = mama.x;
    const pz = mama.z;
    mama.x = MAMA_AT[0] + Math.cos(mamaAngle) * rx;
    mama.z = MAMA_AT[1] + Math.sin(mamaAngle) * rx * 0.6;
    if (Math.hypot(mama.x - px, mama.z - pz) > 1e-5) mama.heading = Math.atan2(mama.x - px, mama.z - pz);
    mama.y = WATER - 0.1 + Math.sin(time * 2.1) * 0.012;
    record(wake, mama.x, mama.z, 0.05);
    mamaCheer -= dt;
    if (allHome) {
      allHomeT += dt;
      mama.mood = 'happy';
      play(mama, allHomeT < 3 ? 'happy' : 'swim');
    } else if (mamaCheer > 0) {
      mama.mood = 'happy';
      play(mama, 'happy');
    } else {
      // missing her little ones: looks around sadly, now and then swims a bit
      mama.mood = 'sad';
      play(mama, Math.sin(time * 0.45) > 0.55 ? 'swim' : 'sad');
    }

    // --- ducklings
    const nearShore = Math.hypot(player.x - SHORE[0], player.z - SHORE[1]) < HOME_RADIUS;
    let line = 0;
    for (const d of chicks) {
      d.t += dt;
      if (d.state === 'lost') {
        // alone and sad: looks around, turning now and then, peeping for Mama
        play(d, 'sad');
        d.heading += Math.sin(time * 0.4 + d.x) * dt * 0.6;
        d.y = world.standHeight(d.x, d.z);
        if (Math.hypot(player.x - d.x, player.z - d.z) < FIND_RADIUS) {
          d.state = 'found';
          d.t = 0;
          found++;
          if (d.marker) d.marker.visible = false;
          // found! a burst of sparkles, and the Sun Points float up
          fx.play('sparkle', d.x, d.y + 0.3, d.z, { size: 1.5 });
          fx.pop('sun', d.x, d.y + 0.7, d.z, 1, 0.38, 0.2);
          events.found(found, chicks.length);
        }
      } else if (d.state === 'found') {
        // still sad (Mama is lost), it looks up at Mochi, then waddles after him
        play(d, 'sad');
        turnTo(d, Math.atan2(player.x - d.x, player.z - d.z), dt);
        d.y = world.standHeight(d.x, d.z);
        if (d.t > 1.6) { d.state = 'follow'; d.t = 0; }
      } else if (d.state === 'follow') {
        d.slot = line++;
        const target = along(trail, player.x, player.z, FOLLOW_FIRST + d.slot * FOLLOW_GAP);
        const speed = target ? stepToward(d, target.x, target.z, 4.5, dt) : 0;
        d.y = world.standHeight(d.x, d.z);
        if (speed > 0.08) play(d, 'walk', walkRate(d, speed));
        else play(d, 'sad');
        if (nearShore) { d.state = 'going'; d.t = 0; }
      } else if (d.state === 'going') {
        // waddle to the water's edge, hop in, and swim to Mama
        const target = along(wake, mama.x, mama.z, wakeBack(home))!;
        const speed = stepToward(d, target.x, target.z, 1.3, dt);
        const wet = world.isWater(d.x, d.z);
        // the hop into the lake: a little splash
        if (wet && !d.wet) fx.play('splash', d.x, WATER, d.z, { size: 0.9 });
        d.wet = wet;
        const floatY = WATER - 0.06 + Math.sin(time * 2.6 + d.x) * 0.01;
        d.y += ((wet ? floatY : world.standHeight(d.x, d.z)) - d.y) * Math.min(1, dt * 8);
        if (wet) play(d, 'swim');
        else play(d, 'walk', walkRate(d, speed));
        if (Math.hypot(target.x - d.x, target.z - d.z) < 0.2 || d.t > 12) {
          // back with Mama: now everyone is happy
          d.state = 'home';
          d.t = 0;
          d.slot = home++;
          d.mood = 'happy';
          mamaCheer = 2.5;
          fx.play('sparkle', d.x, d.y + 0.25, d.z, { size: 1.2 });
          popHearts(d.x, d.y + 0.45, d.z, 3);
          popHearts(mama.x, mama.y + 0.8, mama.z, home === chicks.length ? 8 : 2);
          events.home(home, chicks.length);
        }
      } else if (d.state === 'home') {
        const target = along(wake, mama.x, mama.z, wakeBack(d.slot))!;
        stepToward(d, target.x, target.z, 1.6, dt);
        d.y = WATER - 0.06 + Math.sin(time * 2.6 + d.slot) * 0.01;
        play(d, d.t < 2 || (allHome && allHomeT < 3) ? 'happy' : 'swim');
      }
    }

    // --- place the models
    for (const d of [mama, ...chicks]) {
      d.root.position.set(d.x, d.y, d.z);
      let turn = d.heading - d.root.rotation.y;
      turn = Math.atan2(Math.sin(turn), Math.cos(turn));
      d.root.rotation.y += turn * Math.min(1, dt * 12);
      // no ground shadow on the water
      d.root.getObjectByName('shadow')!.visible = d.y > WATER + 0.1;
      d.mixer.update(dt);
      applyMood(d);
      if (d.marker && d.marker.visible) {
        // the bubble grows when zoomed out so it can still be seen
        const s = Math.max(1, viewH / 14);
        d.marker.scale.set(0.62 * s, 0.65 * s, 1);
        d.marker.position.set(d.x, d.y + 0.55 + Math.sin(time * 3 + d.x) * 0.06, d.z);
      }
    }
  }

  /** Put every duck back as saved (a new game = all lost). Followers start at Mochi's feet. */
  function load(s: DuckSave, at: { x: number; z: number }) {
    found = 0;
    home = 0;
    mamaCheer = 0;
    trail.length = 0;
    chicks.forEach((d, i) => {
      const st = s.chicks[i] ?? 'lost';
      d.t = 0;
      if (d.marker) d.marker.visible = st === 'lost';
      if (st === 'lost') {
        d.state = 'lost';
        [d.x, d.z] = DUCKLING_SPOTS[i];
        d.mood = 'sad';
        return;
      }
      found++;
      if (st === 'follow') {
        d.state = 'follow';
        d.x = at.x;
        d.z = at.z;
        d.mood = 'sad';
      } else {
        d.state = 'home';
        d.slot = home++;
        d.x = mama.x;
        d.z = mama.z;
        d.y = WATER - 0.06;
        d.mood = 'happy';
      }
    });
    allHomeT = 10; // no big cheer again for a family that was already together
  }

  return {
    update,
    load,
    save: (): DuckSave => ({ chicks: chicks.map((d) => (d.state === 'lost' ? 'lost' : d.state === 'home' || d.state === 'going' ? 'home' : 'follow')) }),
    total: chicks.length,
    /** for the map / debug: where everyone is */
    status: () => ({ found, home, total: chicks.length, ducklings: chicks.map((d) => ({ x: d.x, z: d.z, state: d.state })), mama: { x: mama.x, z: mama.z } }),
  };
}
