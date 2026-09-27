import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Tiles: big meshes are cut into square pieces so the tablet only draws the
// pieces that are on screen. The pieces share one vertex buffer (uploaded once);
// each piece just has its own list of triangles and its own bounds for culling.
// ---------------------------------------------------------------------------

/** Tile size in world units (map squares). */
// ?nochunks turns tiles off (one piece per mesh), to compare speed on the tablet
export const CHUNK = typeof location !== 'undefined' && new URLSearchParams(location.search).has('nochunks') ? 1e6 : 12;

/**
 * Split a mesh's triangles into tiles by where each triangle's middle falls.
 * Triangle order inside a tile is kept (the picture batch relies on it for back-to-front drawing).
 * orderStep > 0: tiles further back get a smaller renderOrder, so see-through edges still layer right.
 */
export function splitIntoChunks(geo: THREE.BufferGeometry, material: THREE.Material, baseOrder = 0, orderStep = 0, name = ''): THREE.Group {
  const group = new THREE.Group();
  group.name = name; // layer name, so speed tests can switch layers off one by one
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const index = geo.index ? geo.index.array : null;
  if (!index || index.length === 0) return group;
  const buckets = new Map<string, { ix: number; iz: number; tris: number[] }>();
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t];
    const b = index[t + 1];
    const c = index[t + 2];
    const cx = (pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3;
    const cz = (pos.getZ(a) + pos.getZ(b) + pos.getZ(c)) / 3;
    const ix = Math.floor(cx / CHUNK);
    const iz = Math.floor(cz / CHUNK);
    const key = ix + ',' + iz;
    let bk = buckets.get(key);
    if (!bk) buckets.set(key, (bk = { ix, iz, tris: [] }));
    bk.tris.push(a, b, c);
  }
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  for (const { ix, iz, tris } of buckets.values()) {
    const g = new THREE.BufferGeometry();
    for (const [name, attr] of Object.entries(geo.attributes)) g.setAttribute(name, attr);
    g.setIndex(tris);
    box.makeEmpty();
    for (const i of tris) box.expandByPoint(v.fromBufferAttribute(pos, i));
    g.boundingBox = box.clone();
    g.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
    const m = new THREE.Mesh(g, material);
    m.renderOrder = baseOrder + (ix + iz) * orderStep;
    group.add(m);
  }
  return group;
}
