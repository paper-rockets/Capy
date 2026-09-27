import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Dark outline around a 3D character (Mochi, the ducks), like the painted art, so they stand out on the grass.
// Each body part gets a slightly fattened copy drawn inside-out in dark brown; it moves with the same bones.
// ---------------------------------------------------------------------------

export const OUTLINE_COLOR = 0x5a3414;

/**
 * Call after the model is scaled to its game size (before adding it to the scene).
 * thick = outline thickness in world units. clip = clipping planes to share (e.g. the water line for ducks).
 */
export function addOutlines(model: THREE.Object3D, thick: number, clip: THREE.Plane[] = []) {
  model.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];
  model.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
  // bent parts (skinned) use their own "rest pose" units: compare their size at rest with the model's size in the game
  const rest = new THREE.Box3();
  for (const m of meshes) {
    if (!(m as THREE.SkinnedMesh).isSkinnedMesh) continue;
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    rest.union(m.geometry.boundingBox!);
  }
  const shown = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
  const restSize = rest.isEmpty() ? null : rest.getSize(new THREE.Vector3());
  const restPerWorld = restSize ? Math.max(restSize.x, restSize.y, restSize.z) / Math.max(shown.x, shown.y, shown.z) : 1;
  const worldScale = new THREE.Vector3();

  for (const m of meshes) {
    const skinned = (m as THREE.SkinnedMesh).isSkinnedMesh;
    const local = skinned ? thick * restPerWorld : thick / m.getWorldScale(worldScale).x;
    const mat = new THREE.MeshBasicMaterial({ color: OUTLINE_COLOR, side: THREE.BackSide, transparent: true, depthWrite: true, clippingPlanes: clip });
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\n transformed += normalize(normal) * ${local.toFixed(5)};`);
    };
    let hull: THREE.Mesh;
    if (skinned) {
      const sm = m as THREE.SkinnedMesh;
      const h = new THREE.SkinnedMesh(sm.geometry, mat);
      h.position.copy(sm.position);
      h.quaternion.copy(sm.quaternion);
      h.scale.copy(sm.scale);
      h.bind(sm.skeleton, sm.bindMatrix);
      sm.parent!.add(h);
      hull = h;
    } else {
      hull = new THREE.Mesh(m.geometry, mat);
      m.add(hull); // follows the part it outlines
    }
    hull.name = 'outline';
    hull.renderOrder = m.renderOrder;
    hull.frustumCulled = false;
  }
}
