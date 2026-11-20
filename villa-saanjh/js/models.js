// Real furniture: glTF models from the Khronos sample library, placed in the
// rooms and drawn in ink like everything else until their room is reached.
//
//   SheenChair            CC0 1.0, Wayfair (Eric Chadwick)
//   GlamVelvetSofa        CC BY 4.0, Wayfair
//   ChairDamaskPurplegold CC BY 4.0, Wayfair
//   DiffuseTransmissionPlant  CC BY 4.0, Darmstadt Graphics Group
//
// Each placed mesh is baked into world space and handed back as a part, so the
// Blender bake sees it (it casts shadows and gets a lightmap) and the page can
// swap in the baked version like any other piece.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

export const PLACEMENTS = [
  // (model, x, n, turn in degrees: 0 faces south, 90 faces east; scale, zone, variant, bake)
  { model: 'ChairDamaskPurplegold', x: 16.95, n: 3.0, turn: 180, scale: 1.15, zone: 'foyer' },
  { model: 'ChairDamaskPurplegold', x: 18.0, n: 3.0, turn: 180, scale: 1.15, zone: 'foyer' },
  { model: 'GlamVelvetSofa', x: 11.5, n: 7.32, turn: 0, scale: 1.0, zone: 'gallery', variant: 'Navy' },
  { model: 'SheenChair', x: 1.3, n: 10.75, turn: 125, scale: 1.18, zone: 'master', variant: 'Peacock Velvet' },
  { model: 'SheenChair', x: 1.3, n: 12.55, turn: 55, scale: 1.18, zone: 'master', variant: 'Peacock Velvet' },
  { model: 'DiffuseTransmissionPlant', x: 23.05, n: 7.3, turn: 20, scale: 1.75, zone: 'foyer', bake: false },
  { model: 'DiffuseTransmissionPlant', x: 17.4, n: 13.35, turn: 140, scale: 1.75, zone: 'dining', bake: false },
  { model: 'DiffuseTransmissionPlant', x: 8.75, n: 5.55, turn: 250, scale: 1.6, zone: 'gallery', bake: false },
  { model: 'DiffuseTransmissionPlant', x: 8.85, n: 14.05, turn: 70, scale: 1.75, zone: 'master', bake: false },
];

// which material each primitive uses in a named variant (KHR_materials_variants)
function variantMap(json, name) {
  const variants = json.extensions?.KHR_materials_variants?.variants || [];
  const vi = variants.findIndex((v) => v.name === name);
  const map = new Map();
  if (vi < 0) return map;
  json.meshes.forEach((m, mi) => m.primitives.forEach((p, pi) => {
    for (const mp of p.extensions?.KHR_materials_variants?.mappings || []) if (mp.variants.includes(vi)) map.set(`${mi}/${pi}`, mp.material);
  }));
  return map;
}

// Returns [{ key, zone, geometry (world space), material, bake }]
export async function loadModels(base = 'models/') {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const cache = {};
  const out = [];
  let i = 0;
  for (const P of PLACEMENTS) {
    cache[P.model] ??= loader.loadAsync(`${base}${P.model}.glb`);
    const gltf = await cache[P.model];
    const vmap = P.variant ? variantMap(gltf.parser.json, P.variant) : new Map();
    // stand the model on the floor, centred on its footprint
    const root = gltf.scene.clone(true);
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    const centre = box.getCenter(new THREE.Vector3());
    const place = new THREE.Matrix4()
      .makeTranslation(P.x, 0, -P.n)
      .multiply(new THREE.Matrix4().makeRotationY((P.turn * Math.PI) / 180))
      .multiply(new THREE.Matrix4().makeScale(P.scale, P.scale, P.scale))
      .multiply(new THREE.Matrix4().makeTranslation(-centre.x, -box.min.y, -centre.z));
    const meshes = [];
    root.traverse((o) => o.isMesh && meshes.push(o));
    for (const m of meshes) {
      let material = m.material;
      if ((material.name || '').toLowerCase().includes('wing')) continue; // the plant model carries a butterfly; leave it out
      const a = gltf.parser.associations.get(findSource(gltf.scene, m));
      if (a && vmap.has(`${a.meshes}/${a.primitives}`)) material = await gltf.parser.getDependency('material', vmap.get(`${a.meshes}/${a.primitives}`));
      const g = m.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(place, m.matrixWorld));
      if (!g.attributes.normal) g.computeVertexNormals();
      out.push({ key: `model:${P.zone}|${P.model}${i}_${(material.name || 'm').replace(/[^A-Za-z0-9]/g, '')}`, zone: P.zone, geometry: g, material, bake: P.bake !== false });
    }
    i++;
  }
  return out;
}

// a clone keeps no association: find the original mesh at the same place in the tree
function findSource(orig, clone) {
  const path = [];
  for (let o = clone; o.parent; o = o.parent) path.unshift(o.parent.children.indexOf(o));
  let o = orig;
  for (const k of path) o = o?.children[k];
  return o;
}
