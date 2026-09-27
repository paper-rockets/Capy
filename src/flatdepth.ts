import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Trees, bushes and rocks are flat standing pictures. When a 3D body (Mochi) walks through one, the picture
// cut the body in half: part in front, part behind. This makes the body sort like one more standing picture:
// every point of it is given the depth of a flat card standing at the body's front edge (seen from the camera),
// so a picture is either wholly in front of it or wholly behind it.
//  - only depth changes: the body is drawn exactly where it was
//  - along each line of sight the body keeps a little of its real depth (EPS), so its own parts still hide
//    each other the right way (legs behind the body, etc.)
//  - the card stands BIAS in front of the body's middle, so the front feet never sink into the ground
// ---------------------------------------------------------------------------

const ELEV = Math.atan(1 / Math.SQRT2); // camera looks down this much (same as the pictures)
const EPS = 0.1;
const BIAS = 0.5;

/** center: the body's middle on the ground, updated every frame by the caller. Call after outlines are added. */
export function flattenDepth(root: THREE.Object3D, center: THREE.Vector3) {
  const k = ((1 - EPS) / Math.cos(ELEV)).toFixed(5);
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      if (mat.userData.flatDepth) continue;
      mat.userData.flatDepth = true;
      const prev = mat.onBeforeCompile;
      const prevKey = mat.customProgramCacheKey.bind(mat);
      mat.onBeforeCompile = (sh, r) => {
        prev.call(mat, sh, r);
        sh.uniforms.uFlatCenter = { value: center };
        sh.vertexShader = 'uniform vec3 uFlatCenter;\n' + sh.vertexShader.replace(
          '#include <project_vertex>',
          `#include <project_vertex>
          {
            // how far this point is in front of the body's middle (toward the camera, on the ground plane)
            vec4 fw = modelMatrix * vec4(transformed, 1.0);
            float fs = dot(fw.xz - uFlatCenter.xz, vec2(0.70710678));
            mvPosition.z += ${BIAS.toFixed(3)} - fs * ${k};
            gl_Position = projectionMatrix * mvPosition;
          }`,
        );
      };
      mat.customProgramCacheKey = () => prevKey() + '|flatdepth';
      mat.needsUpdate = true;
    }
  });
}
