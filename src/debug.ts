import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Debug panel (look test only): jump Mochi to named places, tap to teleport,
// show where Mochi can walk, and check that every place can be reached.
// Open with the "Debug" button or ?debug=1.
// Screenshot tools: travel to any map, free camera (drag to move, wheel / pinch / +- to zoom
// without limits), and hide every button for a clean picture.
// ---------------------------------------------------------------------------

export const SPOTS: [string, number, number][] = [
  ['Start · first bridge', 46.2, 12.4],
  ['Cave', 35.0, 4.3],
  ['North arch', 47.3, 2.9],
  ['Plaza (top)', 52.5, 13.0],
  ['Hot spring', 53.4, 24.2],
  ['Garden', 58.5, 19.5],
  ['Second bridge', 43.5, 26.6],
  ['Lake · south shore', 54.0, 37.4],
  ['West hill (top)', 20.0, 17.0],
  ['South-west meadow', 22.6, 32.5],
  ['South-west hill (top)', 31.8, 34.0],
  ['Lookout hill (top)', 70.2, 31.5],
  ['North-east meadow', 69.0, 6.0],
  ['East house plots', 66.0, 17.5],
  ['Far east', 75.0, 22.0],
  ['Upper pond (no way up)', 29.0, 8.8],
  ['West waterfall (foot)', 7.6, 28.8],
  ['West bridge', 11.0, 31.8],
  ['Lake outflow bridge', 61.5, 35.9],
  ['Marsh · west boardwalk', 23.2, 43.0],
  ['Marsh · middle path', 40.0, 46.8],
  ['Marsh · lotus island', 38.4, 51.4],
  ['Marsh · east zig-zag end', 74.2, 53.4],
  ['Marsh · far west', 9.5, 44.0],
  ['East edge path', 79.4, 25.0],
];

export interface DebugApi {
  scene: THREE.Scene;
  player: { x: number; z: number; path: THREE.Vector2[]; running: boolean };
  navOK: () => Uint8Array;
  navSize: { w: number; d: number; per: number };
  findPath: (sx: number, sz: number, tx: number, tz: number) => THREE.Vector2[] | null;
  groundHeight: (x: number, z: number) => number;
  kindAt: (x: number, z: number) => string;
  snapCamera: () => void;
  /** where the camera looks now (x, z) */
  camAt: () => [number, number];
  setView: (v: number) => void;
  getView: () => number;
  /** view size that shows the whole map */
  wholeView: number;
  /** this map's own named places (Sunny Meadow uses SPOTS) */
  spots?: [string, number, number][];
  grassNames: string[];
  getGrass: () => number;
  setGrass: (n: number) => Promise<void>;
  getGrade: () => boolean;
  setGrade: (on: boolean) => void;
}

/** freeCam: the camera stays at camX, camZ instead of following Mochi, and taps don't walk */
export const debugState = { tapTeleport: false, freeCam: false, camX: 0, camZ: 0 };

// every map, for the Travel buttons ('' = Sunny Meadow)
const MAPS: [string, string][] = [
  ['', 'Sunny Meadow'], ['old_orchard', 'Old Orchard'], ['bamboo_woods', 'Bamboo Woods'], ['lotus_marsh', 'Lotus Marsh'],
  ['mountain_springs', 'Mountain Springs'], ['moonlit_lake', 'Moonlit Lake'], ['misty_highlands', 'Misty Highlands'],
];

export function setupDebug(api: DebugApi, open: boolean) {
  const css = document.createElement('style');
  css.textContent = `
    #dbg { position: fixed; top: 170px; right: 14px; width: 250px; max-height: calc(100% - 190px); overflow: auto;
      background: rgba(255,244,220,0.96); border: 2px solid #c79a62; border-radius: 14px; box-shadow: 0 4px 14px rgba(0,0,0,0.25);
      font: 700 13px Nunito, sans-serif; color: #5a3a1d; padding: 10px; display: none; }
    #dbg.on { display: block; }
    #dbg h4 { margin: 8px 0 4px; font-size: 13px; font-weight: 900; }
    #dbg .row { display: flex; gap: 6px; flex-wrap: wrap; }
    #dbg button { font: 800 12px Nunito, sans-serif; color: #5a3a1d; background: #fff; border: 2px solid #d9b98a; border-radius: 9px;
      padding: 5px 8px; cursor: pointer; text-align: left; }
    #dbg button.on { background: #ffd98a; border-color: #c7902e; }
    #dbg .spot { display: flex; width: 100%; justify-content: space-between; margin: 2px 0; }
    #dbg .spot i { font-style: normal; }
    #dbg .ok { color: #3c8a2e; } #dbg .bad { color: #c0392b; }
    #dbg-pos { font: 700 12px monospace; margin-top: 6px; }
    #dbg-zoom { font: 800 12px Nunito, sans-serif; align-self: center; }
    #dbg-show { position: fixed; top: 6px; left: 6px; z-index: 99; display: none; font: 800 11px Nunito, sans-serif;
      background: rgba(255,244,220,0.55); border: 1px solid #c79a62; border-radius: 8px; padding: 3px 7px; color: #5a3a1d; cursor: pointer; }
    body.dbg-clean > *:not(canvas):not(#dbg-show) { visibility: hidden !important; }
    body.dbg-clean #dbg-show { display: block; visibility: visible !important; }
  `;
  document.head.appendChild(css);

  const panel = document.createElement('div');
  panel.id = 'dbg';
  panel.innerHTML = `
    <h4 style="margin-top:0">Travel</h4>
    <div class="row" id="dbg-maps"></div>
    <h4>Camera</h4>
    <div class="row">
      <button id="dbg-free">Free camera</button>
      <button id="dbg-out">−</button><button id="dbg-in">+</button><span id="dbg-zoom"></span>
      <button id="dbg-clean">Hide buttons</button>
    </div>
    <h4>Mochi</h4>
    <div class="row">
      <button id="dbg-tap">Tap = teleport</button>
      <button id="dbg-walk">Show walkable</button>
      <button id="dbg-whole">Whole map</button>
    </div>
    <h4>Look</h4>
    <div class="row" id="dbg-grass"></div>
    <div class="row" style="margin-top:6px"><button id="dbg-grade">Colour boost</button></div>
    <h4>Jump to</h4>
    <div id="dbg-spots"></div>
    <div class="row" style="margin-top:6px"><button id="dbg-check">Check all can be reached</button></div>
    <div id="dbg-result"></div>
    <div id="dbg-pos"></div>
  `;
  document.body.appendChild(panel);
  const tools = document.querySelector('.tools')!;
  const btn = document.createElement('button');
  btn.textContent = 'Debug';
  tools.prepend(btn);
  btn.addEventListener('click', () => panel.classList.toggle('on'));
  if (open) panel.classList.add('on');

  const teleport = (x: number, z: number) => {
    api.player.x = x;
    api.player.z = z;
    api.player.path = [];
    api.player.running = false;
    api.snapCamera();
  };

  // --- travel: reload on another map, still in debug mode, never touching the saved game
  const here = new URLSearchParams(location.search).get('map') ?? '';
  const mapsEl = panel.querySelector('#dbg-maps')!;
  for (const [key, name] of MAPS) {
    const b = document.createElement('button');
    b.textContent = name;
    b.classList.toggle('on', key === here);
    b.addEventListener('click', () => { location.search = `?${key ? `map=${key}&` : ''}debug&nosave`; });
    mapsEl.appendChild(b);
  }

  // --- free camera: drag to move the view, wheel / pinch / buttons to zoom (no limits)
  const MIN_VIEW = 2;
  const MAX_VIEW = 400;
  const zoomEl = panel.querySelector('#dbg-zoom')!;
  const showZoom = () => { zoomEl.textContent = `view ${api.getView().toFixed(1)}`; };
  const zoomBy = (f: number) => { api.setView(Math.min(MAX_VIEW, Math.max(MIN_VIEW, api.getView() * f))); showZoom(); };
  const freeBtn = panel.querySelector('#dbg-free')!;
  const setFree = (on: boolean) => {
    if (on && !debugState.freeCam) [debugState.camX, debugState.camZ] = api.camAt();
    debugState.freeCam = on;
    freeBtn.classList.toggle('on', on);
  };
  freeBtn.addEventListener('click', () => setFree(!debugState.freeCam));
  panel.querySelector('#dbg-in')!.addEventListener('click', () => { setFree(true); zoomBy(1 / 1.25); });
  panel.querySelector('#dbg-out')!.addEventListener('click', () => { setFree(true); zoomBy(1.25); });
  setInterval(showZoom, 500);
  showZoom();
  const canvas = document.querySelector('canvas')!;
  canvas.addEventListener('wheel', (e) => {
    if (!debugState.freeCam) return;
    e.preventDefault();
    zoomBy(e.deltaY > 0 ? 1.12 : 1 / 1.12);
  }, { passive: false });
  // one finger / mouse drags the map along with it; two fingers pinch to zoom
  const ELEV = Math.atan(1 / Math.SQRT2);
  const pts = new Map<number, { x: number; y: number }>();
  let pinch = 0;
  canvas.addEventListener('pointerdown', (e) => {
    if (!debugState.freeCam) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    canvas.setPointerCapture(e.pointerId);
    pinch = 0;
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = pts.get(e.pointerId);
    if (!debugState.freeCam || !p) return;
    if (pts.size >= 2) {
      p.x = e.clientX; p.y = e.clientY;
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch) zoomBy(pinch / d);
      pinch = d;
      return;
    }
    const upp = api.getView() / window.innerHeight; // world units per screen pixel
    const dx = (e.clientX - p.x) * upp;
    const dy = ((e.clientY - p.y) * upp) / Math.sin(ELEV); // up/down on screen covers more ground (the camera looks down)
    // screen right = (+x, -z) and screen down = (+x, +z) on the ground; the map follows the finger
    debugState.camX -= (dx + dy) * Math.SQRT1_2;
    debugState.camZ -= (dy - dx) * Math.SQRT1_2;
    p.x = e.clientX; p.y = e.clientY;
  });
  const lift = (e: PointerEvent) => { pts.delete(e.pointerId); pinch = 0; };
  canvas.addEventListener('pointerup', lift);
  canvas.addEventListener('pointercancel', lift);

  // --- clean screen for screenshots: everything but the picture hidden; the little "Show" tab brings it back
  const show = document.createElement('div');
  show.id = 'dbg-show';
  show.textContent = 'Show';
  document.body.appendChild(show);
  panel.querySelector('#dbg-clean')!.addEventListener('click', () => document.body.classList.add('dbg-clean'));
  show.addEventListener('click', () => document.body.classList.remove('dbg-clean'));

  const spotsEl = panel.querySelector('#dbg-spots')!;
  const marks: HTMLElement[] = [];
  const spots = api.spots ?? SPOTS;
  for (const [name, x, z] of spots) {
    const b = document.createElement('button');
    b.className = 'spot';
    b.innerHTML = `<span>${name}</span><i></i>`;
    b.addEventListener('click', () => { setFree(false); teleport(x, z); });
    spotsEl.appendChild(b);
    marks.push(b.querySelector('i')!);
  }

  // grass picker and colour boost, to compare looks live on the tablet
  const grassEl = panel.querySelector('#dbg-grass')!;
  const grassBtns = api.grassNames.map((name, n) => {
    const b = document.createElement('button');
    b.textContent = name;
    b.classList.toggle('on', n === api.getGrass());
    b.addEventListener('click', async () => {
      await api.setGrass(n);
      grassBtns.forEach((o, i) => o.classList.toggle('on', i === n));
    });
    grassEl.appendChild(b);
    return b;
  });
  const gradeBtn = panel.querySelector('#dbg-grade')!;
  gradeBtn.classList.toggle('on', api.getGrade());
  gradeBtn.addEventListener('click', () => {
    api.setGrade(!api.getGrade());
    gradeBtn.classList.toggle('on', api.getGrade());
  });

  const tapBtn = panel.querySelector('#dbg-tap')!;
  tapBtn.addEventListener('click', () => {
    debugState.tapTeleport = !debugState.tapTeleport;
    tapBtn.classList.toggle('on', debugState.tapTeleport);
  });

  let normalView = api.getView();
  const wholeBtn = panel.querySelector('#dbg-whole')!;
  wholeBtn.addEventListener('click', () => {
    const on = !wholeBtn.classList.contains('on');
    wholeBtn.classList.toggle('on', on);
    setFree(false);
    if (on) { normalView = api.getView(); api.setView(api.wholeView); } else api.setView(normalView);
  });

  // walkable overlay: red squares where Mochi can't stand (only on dry ground, water is obvious)
  let overlay: THREE.InstancedMesh | null = null;
  const walkBtn = panel.querySelector('#dbg-walk')!;
  walkBtn.addEventListener('click', () => {
    if (!overlay) {
      const nav = api.navOK();
      const { w, d, per } = api.navSize;
      const cells: [number, number][] = [];
      for (let j = 0; j < d; j++) for (let i = 0; i < w; i++) {
        if (nav[j * w + i]) continue;
        const x = (i + 0.5) / per;
        const z = (j + 0.5) / per;
        const k = api.kindAt(x, z);
        if (k === 'river' || k === 'pool') continue;
        cells.push([x, z]);
      }
      const g = new THREE.PlaneGeometry(0.9 / per, 0.9 / per).rotateX(-Math.PI / 2);
      overlay = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ color: 0xff3b30, transparent: true, opacity: 0.35, depthWrite: false }), cells.length);
      const m = new THREE.Matrix4();
      cells.forEach(([x, z], n) => { m.makeTranslation(x, api.groundHeight(x, z) + 0.06, z); overlay!.setMatrixAt(n, m); });
      overlay.renderOrder = 6;
      overlay.frustumCulled = false;
      api.scene.add(overlay);
    } else overlay.visible = !overlay.visible;
    walkBtn.classList.toggle('on', overlay.visible);
  });

  const result = panel.querySelector('#dbg-result')!;
  panel.querySelector('#dbg-check')!.addEventListener('click', () => {
    let bad = 0;
    spots.forEach(([, x, z], n) => {
      const p = api.findPath(api.player.x, api.player.z, x, z);
      const end = p && p.length ? p[p.length - 1] : null;
      const miss = end ? Math.hypot(end.x - x, end.y - z) : Math.hypot(api.player.x - x, api.player.z - z);
      const ok = miss < 1.2;
      marks[n].textContent = ok ? '✔' : '✘';
      marks[n].className = ok ? 'ok' : 'bad';
      if (!ok) bad++;
    });
    result.textContent = bad ? `${bad} place(s) can't be reached from here` : 'Every place can be reached from here';
  });

  const pos = panel.querySelector('#dbg-pos')!;
  setInterval(() => {
    if (!panel.classList.contains('on')) return;
    const { x, z } = api.player;
    pos.textContent = `Mochi x ${x.toFixed(1)}  z ${z.toFixed(1)}  ${api.kindAt(x, z)}`;
  }, 250);

  return { teleport };
}
