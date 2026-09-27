import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Game colour: bright and punchy for kids. It replaces the last step of EVERY shader
// (ground, water, pictures, rocks, Mochi...), where each pixel's colour is turned into
// screen colour, so there is no extra full-screen pass.
//
// SPEED: that last step runs for every pixel of every layer, so it must be cheap on the
// tablet. The standard version uses 3 "power" sums per pixel; a first version of this grade
// added 3 more and cost ~10 fps. This one uses 3 square roots instead of all of them.
//
// ?nograde turns it off; ?sat= ?vib= ?con= ?pivot= ?lift= ?warm= try other values.
// ---------------------------------------------------------------------------

const ORIGINAL = THREE.ShaderChunk.colorspace_fragment;
let graded = '';
export let gradeOn = false;

export function installGrade(params: URLSearchParams) {
  const v = (k: string, d: number) => {
    const n = Number(params.get(k));
    return (params.has(k) && Number.isFinite(n) ? n : d).toFixed(3);
  };
  const sat = v('sat', 1.3); // saturation for everything
  const vib = v('vib', 0.45); // extra saturation for dull colours (greys stay grey)
  const con = v('con', 1.12); // contrast
  const pivot = v('pivot', 0.42); // contrast turns around this brightness: above it gets brighter
  const lift = v('lift', 0.27); // brightens the middle tones
  const warm = v('warm', 0.025); // a touch of warm sunlight
  graded = /* glsl */ `
  {
    // light values -> screen colours: a square root is close to the standard curve and much cheaper
    vec3 gc = sqrt(max(gl_FragColor.rgb, 0.0));
    gc += ${lift} * gc * (1.0 - gc);
    float gLum = dot(gc, vec3(0.299, 0.587, 0.114));
    float gSat = max(gc.r, max(gc.g, gc.b)) - min(gc.r, min(gc.g, gc.b));
    gc = mix(vec3(gLum), gc, ${sat} + ${vib} * (1.0 - gSat));
    gc = (gc - ${pivot}) * ${con} + ${pivot} + vec3(${warm}, ${warm} * 0.4, -${warm});
    gl_FragColor.rgb = clamp(gc, 0.0, 1.0);
  }
`;
  setGrade(!params.has('nograde'));
}

/** Switch the colour boost. Shaders already built keep the old one until refreshMaterials(). */
export function setGrade(on: boolean) {
  gradeOn = on;
  THREE.ShaderChunk.colorspace_fragment = on ? graded : ORIGINAL;
}

/** Rebuild every shader in the scene (after setGrade). Takes a moment on the tablet. */
export function refreshMaterials(scene: THREE.Scene) {
  scene.traverse((o) => {
    const m = (o as THREE.Mesh).material;
    if (!m) return;
    for (const mm of Array.isArray(m) ? m : [m]) {
      // three.js reuses built shaders by name, and the name doesn't include this last step,
      // so the on/off state is added to it (once per material)
      if (!mm.userData.gradeKey) {
        const prev = mm.customProgramCacheKey.bind(mm);
        mm.customProgramCacheKey = () => prev() + (gradeOn ? '|grade' : '|plain');
        mm.userData.gradeKey = true;
      }
      mm.needsUpdate = true;
    }
  });
}
