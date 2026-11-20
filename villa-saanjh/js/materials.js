// Every surface has two looks, blended by one shader:
//
//   ink       flat paper with black edge lines on top: the drawing.
//   material  the real thing, textured and lit by the late sun.
//
// A pixel shows ink until the sweep front of its zone has passed it. Pixels
// outside every walkable zone stay ink. Back faces (the inside of a wall,
// seen where the cut plane opens it) are always solid ink: the black walls of
// the plan.

import * as THREE from 'three';
import { PAPER, INK, ZONES, CUT_PLAN } from './plan.js';

// One clipping plane for the whole house: keeps everything below `constant`.
export const CUT = new THREE.Plane(new THREE.Vector3(0, -1, 0), CUT_PLAN);

const SOFT = 1.4; // metres over which ink turns into material
const IDLE = -1e5;
const hex3 = (h) => {
  const c = new THREE.Color(h);
  c.convertLinearToSRGB(); // the shader writes these after the output conversion
  return new THREE.Vector3(c.r, c.g, c.b);
};

// zones in three.js space
const Z = ZONES.map((z) => {
  const dx = z.dir[0], dz = -z.dir[1];
  const ox = dx ? z.from : 0, oz = dz ? -z.from : 0;
  return { key: z.key, len: z.len, dx, dz, ox, oz };
});

export const U = {
  uPaper: { value: hex3(PAPER) },
  uInk: { value: hex3(INK) },
  uZoneBox: { value: ZONES.map((z) => new THREE.Vector4(z.x0, -z.n1, z.x1, -z.n0)) },
  uZoneY: { value: ZONES.map((z) => new THREE.Vector2(z.y0, z.y1)) },
  uZoneSweep: { value: Z.map((z) => new THREE.Vector4(z.ox, z.oz, z.dx, z.dz)) },
  uZoneFront: { value: Z.map(() => IDLE) },
  uSoft: { value: SOFT },
};

// Clipping planes that take a zone's ink lines away once its front has passed.
export const ZONE_PLANES = {};
Z.forEach((z) => (ZONE_PLANES[z.key] = new THREE.Plane(new THREE.Vector3(z.dx, 0, z.dz), 1e5)));
export const zoneReveal = {};

// t: 0 = all drawing, 1 = all material
// a copy of an inked material that takes a baked lightmap
export function withLightmap(mat, lightMap, intensity) {
  const m = inkify(mat.clone(), mat.userData.ink);
  m.lightMap = lightMap;
  m.lightMapIntensity = intensity;
  return m;
}

export function setZoneReveal(key, t) {
  const i = Z.findIndex((z) => z.key === key);
  const z = Z[i];
  zoneReveal[key] = t;
  const front = t <= 0 ? IDLE : t * (z.len + SOFT);
  U.uZoneFront.value[i] = front;
  // lines go when the front is halfway through its soft edge
  const lineFront = t <= 0 ? IDLE : front - SOFT * 0.5;
  ZONE_PLANES[key].constant = -(z.ox * z.dx + z.oz * z.dz + lineFront);
}

const NZ = ZONES.length;
const FRAG_HEAD = /* glsl */ `
#define NZ ${NZ}
varying vec3 vWp;
varying vec3 vWn;
uniform vec3 uPaper;
uniform vec3 uInk;
uniform vec4 uZoneBox[NZ];
uniform vec2 uZoneY[NZ];
uniform vec4 uZoneSweep[NZ];
uniform float uZoneFront[NZ];
uniform float uSoft;
uniform float uGlassInk;
uniform float uPoche;

float inkAt(vec3 p, vec3 n) {
  vec3 q = p + n * 0.04;
  for (int i = 0; i < NZ; i++) {
    vec4 b = uZoneBox[i];
    if (q.x > b.x && q.x < b.z && q.z > b.y && q.z < b.w && q.y > uZoneY[i].x && q.y < uZoneY[i].y) {
      vec4 s = uZoneSweep[i];
      float d = dot(q.xz - s.xy, s.zw);
      float f = uZoneFront[i];
      return smoothstep(f - uSoft, f, d);
    }
  }
  return 1.0;
}
`;

const FRAG_TAIL = /* glsl */ `
{
  vec3 nn = normalize(vWn);
  if (!gl_FrontFacing && uPoche > 0.5) {
    gl_FragColor = vec4(uInk, 1.0);
  } else {
    if (!gl_FrontFacing) nn = -nn;
    float ink = inkAt(vWp, nn);
    // the drawing: paper, with a faint wash on upright faces so it reads as solid
    vec3 paper = uPaper * (1.0 - 0.055 * (1.0 - abs(nn.y))) * (nn.y < -0.5 ? 0.965 : 1.0);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, paper, ink);
    gl_FragColor.a = mix(gl_FragColor.a, uGlassInk, ink);
  }
}
`;

function inkify(mat, { glassInk = 1, thin = false } = {}) {
  mat.userData.ink = { glassInk, thin };
  mat.side = THREE.DoubleSide;
  mat.clippingPlanes = [CUT];
  mat.polygonOffset = true; // keep faces a hair behind their ink lines
  mat.polygonOffsetFactor = 1;
  mat.polygonOffsetUnits = 1;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U, { uGlassInk: { value: glassInk }, uPoche: { value: thin ? 0 : 1 } });
    // with baked light, the environment gives reflections only: the lightmap already holds the diffuse light
    if (mat.lightMap) sh.fragmentShader = sh.fragmentShader.replace('#include <lights_fragment_maps>', THREE.ShaderChunk.lights_fragment_maps.replace('iblIrradiance += getIBLIrradiance( geometryNormal );', ''));
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWp;\nvarying vec3 vWn;')
      .replace(
        '#include <fog_vertex>',
        '#include <fog_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWn = normalize(mat3(modelMatrix) * objectNormal);'
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_HEAD)
      .replace('#include <dithering_fragment>', '#include <dithering_fragment>\n' + FRAG_TAIL);
  };
  mat.customProgramCacheKey = () => 'ink' + glassInk + (thin ? 't' : 's') + (mat.lightMap ? 'L' : '');
  return mat;
}

// ---- textures ----------------------------------------------------------------
const TEX = 'assets/textures/';
const FILES = {
  stone: ['marble_01_diff_2k', 'marble_01_nor_gl_2k', 'marble_01_rough_1k'],
  oak: ['white_oak_veneer_diff_2k', 'white_oak_veneer_nor_gl_1k', 'white_oak_veneer_rough_1k'],
  plaster: ['plastered_wall_diff_1k', 'plastered_wall_nor_gl_1k', 'plastered_wall_rough_1k'],
  leather: ['brown_leather_albedo_1k', 'brown_leather_nor_gl_1k', 'brown_leather_rough_1k'],
};

export async function loadTextures(anisotropy) {
  const loader = new THREE.TextureLoader();
  const out = {};
  await Promise.all(
    Object.entries(FILES).map(async ([key, [d, n, r]]) => {
      const [map, normalMap, roughnessMap] = await Promise.all([d, n, r].map((f) => loader.loadAsync(TEX + f + '.webp')));
      map.colorSpace = THREE.SRGBColorSpace;
      for (const t of [map, normalMap, roughnessMap]) {
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.anisotropy = anisotropy;
      }
      out[key] = { map, normalMap, roughnessMap };
    })
  );
  return out;
}

// a texture set at a given size in metres (UVs are in metres)
function set(T, size, rot = 0) {
  const o = {};
  for (const k in T) {
    const t = T[k].clone();
    t.repeat.set(1 / size, 1 / size);
    t.rotation = rot;
    t.needsUpdate = true;
    o[k] = t;
  }
  return o;
}
const lin = (r, g, b) => new THREE.Color().setRGB(r, g, b, THREE.LinearSRGBColorSpace);

function sized(t, size) {
  const c = t.clone();
  c.repeat.set(1 / size, 1 / size);
  c.needsUpdate = true;
  return c;
}

export function makeMaterials(T, P) {
  const std = (o) => inkify(new THREE.MeshStandardMaterial(o));
  const thinStd = (o) => inkify(new THREE.MeshStandardMaterial(o), { thin: true });
  const M = {
    // floors
    cement: std({ map: sized(P.cement, 0.2), roughness: 0.42, envMapIntensity: 0.7 }),
    marbleWhite: std({ ...set(T.stone, 1.8), color: lin(1.35, 1.33, 1.3), roughness: 0.18, envMapIntensity: 1 }),
    navy: std({ color: '#1d2f52', roughness: 0.4 }),
    teak: std({ ...set(T.oak, 1.3), color: lin(0.62, 0.4, 0.24), roughness: 0.5 }),
    paving: std({ ...set(T.stone, 3.6), color: lin(0.95, 0.88, 0.8), roughness: 0.9 }),
    // walls
    plaster: std({ ...set(T.plaster, 2.6), color: lin(1.36, 1.36, 1.35), roughness: 0.92 }),
    ceiling: std({ ...set(T.plaster, 3.0), color: lin(1.42, 1.42, 1.42), roughness: 1 }),
    render: std({ ...set(T.plaster, 3.2), color: lin(1.3, 1.31, 1.32), roughness: 1 }),
    roof: std({ color: '#55606e', roughness: 0.8 }),
    wallTile: std({ map: sized(P.wallTile, 0.15), roughness: 0.15, envMapIntensity: 1.2 }),
    blackMarble: std({ map: sized(P.blackMarble, 1.2), roughness: 0.12, envMapIntensity: 1.3 }),
    // metals, glass, light
    gold: std({ color: '#c9a05a', metalness: 1, roughness: 0.28 }),
    iron: std({ color: '#1b1c1e', metalness: 0.6, roughness: 0.5 }),
    mirror: thinStd({ color: '#d8d8d4', metalness: 1, roughness: 0.03 }),
    jali: inkify(new THREE.MeshStandardMaterial({ color: '#c9a05a', metalness: 1, roughness: 0.35, alphaMap: sized(P.jali, 0.7), alphaTest: 0.5 }), { thin: true }),
    crystal: std({ color: '#ffffff', metalness: 0.1, roughness: 0.0, emissive: new THREE.Color('#ffe2b8'), emissiveIntensity: 0.6, envMapIntensity: 3 }),
    lampGlass: thinStd({ color: '#fff1d8', emissive: new THREE.Color('#ffc27a'), emissiveIntensity: 3.2, roughness: 0.4 }),
    night: thinStd({ color: '#1e2430', roughness: 0.6 }),
    glass: inkify(
      new THREE.MeshStandardMaterial({ color: '#dfe9ea', roughness: 0.03, metalness: 0, transparent: true, opacity: 0.18, depthWrite: false, envMapIntensity: 1.5 }),
      { glassInk: 0, thin: true }
    ),
    // soft things and objects
    velvet: inkify(new THREE.MeshPhysicalMaterial({ color: '#1c2b55', roughness: 0.75, sheen: 1, sheenColor: new THREE.Color('#6d86c9'), sheenRoughness: 0.5 })),
    drape: inkify(new THREE.MeshPhysicalMaterial({ color: '#1a2850', roughness: 0.8, sheen: 1, sheenColor: new THREE.Color('#5d76b8'), sheenRoughness: 0.45 }), { thin: true }),
    mosaic: std({ map: sized(P.mosaic, 0.5), roughness: 0.12, envMapIntensity: 1.2 }),
    // in ink the water is paper; in colour you see through it to the mosaic
    water: inkify(new THREE.MeshStandardMaterial({ color: '#5cc0d4', emissive: new THREE.Color('#1c8aa3'), emissiveIntensity: 0.55, roughness: 0.04, metalness: 0.1, transparent: true, opacity: 0.62, depthWrite: false, normalMap: sized(P.ripples, 1.2), normalScale: new THREE.Vector2(0.35, 0.35), envMapIntensity: 1.6 }), { glassInk: 1, thin: true }),
    cascade: inkify(new THREE.MeshStandardMaterial({ color: '#e8f5f8', roughness: 0.1, transparent: true, opacity: 0.6, depthWrite: false, emissive: new THREE.Color('#9fc6d0'), emissiveIntensity: 0.25 }), { glassInk: 0, thin: true }),
    art: thinStd({ map: P.painting, roughness: 0.85 }),
    linen: std({ color: '#ecebe6', roughness: 0.95 }),
    velvetGreen: inkify(new THREE.MeshPhysicalMaterial({ color: '#1f4a35', roughness: 0.75, sheen: 1, sheenColor: new THREE.Color('#5f9a78'), sheenRoughness: 0.5 })),
    drapeRed: inkify(new THREE.MeshPhysicalMaterial({ color: '#5a1a22', roughness: 0.8, sheen: 1, sheenColor: new THREE.Color('#b0505e'), sheenRoughness: 0.45 }), { thin: true }),
    rug: std({ color: '#d8ccb6', roughness: 1 }),
    shade: thinStd({ color: '#f6ead6', emissive: new THREE.Color('#ffcf96'), emissiveIntensity: 1.2, roughness: 0.9 }),
    umbrella: inkify(new THREE.MeshStandardMaterial({ color: '#1d2f52', roughness: 0.9 }), { thin: true }),
    porcelain: std({ color: '#f1efe9', roughness: 0.2, envMapIntensity: 1.2 }),
    clay: std({ color: '#a8673f', roughness: 0.85 }),
    ceramic: std({ color: '#244a6b', roughness: 0.25 }),
    flowerWhite: std({ color: '#f3ede6', roughness: 0.7 }),
    flowerPink: std({ color: '#d98aa4', roughness: 0.7 }),
    flowerPlum: std({ color: '#7d3f6e', roughness: 0.7 }),
    leaf: inkify(new THREE.MeshStandardMaterial({ color: '#3f5a2c', roughness: 0.7 }), { thin: true }),
    trunk: std({ color: '#6b5a48', roughness: 1 }),
    water: std({ color: '#2f7f99', roughness: 0.08 }),
  };
  return M;
}

export { inkify };
