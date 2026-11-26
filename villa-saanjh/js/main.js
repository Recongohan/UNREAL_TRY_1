// Villa Saanjh, checkpoint 1: the sheet, the walls rising, the walk into the foyer.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

import { PAPER, INK, GROUND_Y, SUN, POOL } from './plan.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { CUT, ZONE_PLANES, setZoneReveal, loadTextures, makeMaterials, withLightmap, inkify } from './materials.js';
import { loadModels } from './models.js';
import { binaryUrl } from './files.js';
import { cementTile, wallTile, blackMarble, jali, mosaic, ripples, painting } from './patterns.js';
import { buildHouse } from './house.js';
import { buildSheet } from './sheet.js';
import { makeRig, STOPS, LENGTH } from './rig.js';

const params = new URLSearchParams(location.search);
const CAPTURE = params.has('capture'); // recording: one exact frame per request, no smoothing
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const errors = (window.__errors = []);
addEventListener('error', (e) => errors.push(String(e.message)));
addEventListener('unhandledrejection', (e) => errors.push(String(e.reason)));

// ---- renderer ---------------------------------------------------------------------
const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
// 1.5 keeps edges crisp on retina screens at under 60% of the pixels of 2x: the walk stays at frame rate
const DPR = Math.min(devicePixelRatio || 1, 1.5);
renderer.setPixelRatio(DPR);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = params.get('tone') === 'aces' ? THREE.ACESFilmicToneMapping : THREE.AgXToneMapping; // AgX matches Blender's view transform
renderer.toneMappingExposure = 1.05;
renderer.localClippingEnabled = true;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;
const ANISO = renderer.capabilities.getMaxAnisotropy();

const scene = new THREE.Scene();
scene.background = new THREE.Color(PAPER);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.35;

const camera = new THREE.PerspectiveCamera(2, 1, 1, 5000);
camera.rotation.order = 'YXZ';

// the sheet of paper everything stands on
// (with a hole over the pool, so you can look down into the water)
const sheetShape = new THREE.Shape([new THREE.Vector2(-3000, -3000), new THREE.Vector2(3000, -3000), new THREE.Vector2(3000, 3000), new THREE.Vector2(-3000, 3000)]);
sheetShape.holes.push(new THREE.Path([new THREE.Vector2(POOL.x0, POOL.n0), new THREE.Vector2(POOL.x0, POOL.n1), new THREE.Vector2(POOL.x1, POOL.n1), new THREE.Vector2(POOL.x1, POOL.n0)]));
const paper = new THREE.Mesh(new THREE.ShapeGeometry(sheetShape), new THREE.MeshBasicMaterial({ color: PAPER, toneMapped: false, side: THREE.DoubleSide }));
paper.rotation.x = -Math.PI / 2;
paper.position.y = GROUND_Y;
scene.add(paper);

// ---- ink lines ------------------------------------------------------------------------
const KINDS = {
  structure: { w: 1.35, cut: true },
  kit: { w: 0.8, cut: true },
  anno: { w: 0.8 },
  thin: { w: 0.55 },
  hatch: { w: 0.5, color: '#aaa598' },
  dash: { w: 0.65, dashed: true },
};
const planesFor = (zone, cut = false) => {
  const p = cut ? [CUT] : [];
  if (ZONE_PLANES[zone]) p.push(ZONE_PLANES[zone]);
  return p;
};
function inkLines(kind, zone, positions) {
  const k = KINDS[kind];
  const g = new LineSegmentsGeometry();
  g.setPositions(positions);
  const m = new LineMaterial({
    color: new THREE.Color(k.color ?? INK), linewidth: k.w * DPR, worldUnits: false, toneMapped: false,
    dashed: !!k.dashed, dashSize: 0.32, gapSize: 0.22, clippingPlanes: planesFor(zone, k.cut),
  });
  const l = new LineSegments2(g, m);
  if (k.dashed) l.computeLineDistances();
  l.frustumCulled = false;
  l.renderOrder = 1;
  return l;
}

// ---- the house ---------------------------------------------------------------------------
const house = new THREE.Group();
scene.add(house);
const H = buildHouse();
let M, door = [];
const parts = {}; // 'zone|mat' -> mesh, so baked versions can replace them

function assemble() {
  const solid = (geo, mat, shadows = true) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = shadows;
    m.receiveShadow = shadows;
    house.add(m);
    return m;
  };
  for (const key in H.shell.geometries) parts['shell:' + key] = solid(H.shell.geometries[key], M[key.split('|')[1]]);
  for (const key in H.shell.edges) house.add(inkLines('structure', key, H.shell.edges[key]));
  for (const key in H.kit.parts) {
    const mat = key.split('|')[1];
    if (!M[mat]) errors.push('no material ' + mat);
    const glow = ['glass', 'lampGlass', 'crystal', 'night'].includes(mat);
    const mesh = solid(H.kit.parts[key].geometry(), M[mat], !glow);
    if (mat === 'glass') mesh.renderOrder = 3;
    parts['kit:' + key] = mesh;
  }
  for (const key in H.kit.lines) house.add(inkLines('kit', key, H.kit.lines[key]));
  H.leaves.forEach((g, i) => {
    const u = g.userData;
    for (const [geo, mat, name] of [[u.part, M.teak, 'teak'], [u.trim, M.teak, 'trim'], [u.brass, M.gold, 'gold']]) {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = m.receiveShadow = true;
      g.add(m);
      parts[`leaf${i}:${name}`] = m;
    }
    g.add(inkLines('kit', 'foyer', u.lines));
    house.add(g);
    door.push(g);
  });
}

// real furniture models, inked like everything else
async function placeModels() {
  for (const m of await loadModels()) {
    const thin = m.material.transparent || m.material.alphaTest > 0 || /leaf|leaves/i.test(m.material.name);
    const mat = inkify(m.material.clone(), { thin });
    const mesh = new THREE.Mesh(m.geometry, mat);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.userData.noBake = !m.bake;
    house.add(mesh);
    parts[m.key] = mesh;
    // outlines for the furniture; plants are drawn by their silhouettes alone (their leaf edges would cost a million triangles)
    if (m.bake) {
      const e = new THREE.EdgesGeometry(m.geometry, 50).attributes.position.array;
      if (e.length) house.add(inkLines('kit', m.zone, e));
    }
  }
}

// ---- baked light (Blender / Cycles) ----------------------------------------------------------
// Everything the bake needs, for tools/bake.py: the meshes of the walked zones and
// the rest of the house (which still blocks and bounces light), and the lights.
const OPEN_DOOR = 1.62;
const LAMPS = [];
window.__bakeData = () => {
  const out = { meshes: [], lights: LAMPS, sun: SUN, openDoor: OPEN_DOOR };
  for (const [key, mesh] of Object.entries(parts)) {
    const g = mesh.geometry, P = g.attributes.position, Nn = g.attributes.normal, UV = g.attributes.uv;
    const leaf = key.startsWith('leaf');
    const [, zm] = key.split(':');
    const mat = leaf ? (key.endsWith('gold') ? 'gold' : 'teak') : zm.split('|')[1];
    const zone = leaf ? 'foyer' : zm.split('|')[0];
    const r = (a) => Array.from(a, (v) => Math.round(v * 1e4) / 1e4);
    out.meshes.push({
      key, zone, mat, bake: zone !== 'rest' && !mesh.userData.noBake,
      // leaves are built about their hinge; the bake places them open
      pivot: leaf ? [mesh.parent.position.x, mesh.parent.position.y, mesh.parent.position.z, OPEN_DOOR * mesh.parent.userData.sign] : null,
      position: r(P.array), normal: r(Nn.array), uv: UV ? r(UV.array) : null, index: g.index ? Array.from(g.index.array) : null,
    });
  }
  return out;
};

let baked = null;
async function loadBake() {
  let meta;
  try {
    const r = await fetch('bake/scene.json', { cache: 'no-cache' });
    if (!r.ok) return null;
    meta = await r.json();
  } catch {
    return null;
  }
  const tl = new THREE.TextureLoader();
  const lms = {};
  await Promise.all(Object.entries(meta.lightmaps).map(async ([name, d]) => {
    const t = await tl.loadAsync('bake/' + d.file);
    t.flipY = false;
    t.channel = 1;
    t.colorSpace = THREE.SRGBColorSpace;
    lms[name] = { tex: t, intensity: d.scale * Math.PI };
  }));
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(await binaryUrl('bake/' + meta.glb));
  const cache = new Map();
  const swaps = [];
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    const key = o.userData.key || o.parent?.userData?.key;
    const atlas = o.userData.lightmap || o.parent?.userData?.lightmap;
    if (!key || !parts[key]) return;
    swaps.push([key, atlas, o]);
  });
  for (const [key, atlas, o] of swaps) {
    const old = parts[key];
    const lm = lms[atlas];
    const ck = old.material.uuid + atlas;
    if (!cache.has(ck)) cache.set(ck, withLightmap(old.material, lm.tex, lm.intensity));
    old.geometry.dispose();
    old.geometry = o.geometry; // same positions, plus the lightmap UVs (uv1)
    old.material = cache.get(ck);
    old.castShadow = old.receiveShadow = false;
  }
  // small or thin things (flowers, leaves, crystal, metal) were not baked: one even light level per zone
  const white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  white.needsUpdate = true;
  white.channel = 1;
  const swapped = new Set(swaps.map((w) => w[0]));
  for (const [key, mesh] of Object.entries(parts)) {
    if (swapped.has(key)) continue;
    const zone = key.startsWith('leaf') ? 'foyer' : key.split(':')[1].split('|')[0];
    if (!(zone in meta.flat)) continue;
    const g = mesh.geometry;
    if (!g.attributes.uv1) g.setAttribute('uv1', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    mesh.material = withLightmap(mesh.material, white, meta.flat[zone] * Math.PI);
    mesh.castShadow = mesh.receiveShadow = false;
  }
  // a 360 capture from inside each zone, for reflections
  const envs = {};
  for (const [zone, file] of Object.entries(meta.env || {})) {
    const hdr = await new RGBELoader().loadAsync(await binaryUrl('bake/' + file));
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    envs[zone] = pmrem.fromEquirectangular(hdr).texture;
    hdr.dispose();
  }
  return { meta, envs, swapped: swaps.length };
}

// ---- light: the last hour of sun, and the lamps coming on --------------------------------
const el = SUN.elevation * (Math.PI / 180), az = SUN.azimuth * (Math.PI / 180);
// direction the light travels: from the sun's azimuth towards the opposite side
const sunTravel = new THREE.Vector3(-Math.sin(az) * Math.cos(el), -Math.sin(el), Math.cos(az) * Math.cos(el));
const sun = new THREE.DirectionalLight(0xffc48a, 5.5);
sun.target.position.set(18, 2, -7.5);
sun.position.copy(sun.target.position).addScaledVector(sunTravel, -80);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22, near: 20, far: 170 });
sun.shadow.bias = -0.0003;
sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);
const realtime = [sun];
const lamp = (x, y, n, intensity, dist = 0, color = 0xffc78a, watts = 0, radius = 0.1) => {
  const l = new THREE.PointLight(color, intensity, dist, 2);
  l.position.set(x, y, -n);
  scene.add(l);
  realtime.push(l);
  if (watts) LAMPS.push({ x, y, n, watts, radius, color: '#' + new THREE.Color(color).getHexString() });
  return l;
};
const hemi = new THREE.HemisphereLight(0xc9d3e6, 0xb39a7c, 0.85);
scene.add(hemi);
realtime.push(hemi);
// (x, y, n, three.js intensity, range, colour, Blender watts, Blender radius)
lamp(19.9, 4.0, 5.25, 30, 0, 0xffd6a8, 380, 0.35); // foyer chandelier
lamp(19.9, 2.2, 5.25, 6, 0, 0xffe0c0); // its light bounced off the floor (realtime only)
lamp(25.8, 3.0, 5.25, 9, 12, 0xffc78a, 160, 0.12); // portico lantern
lamp(24.45, 2.35, 3.75, 2.2, 6, 0xffc78a, 25, 0.08);
lamp(24.45, 2.35, 6.75, 2.2, 6, 0xffc78a, 25, 0.08);
lamp(20.95, 2.25, 2.95, 2.0, 5, 0xffc78a, 25, 0.08);
lamp(23.35, 2.25, 2.95, 2.0, 5, 0xffc78a, 25, 0.08);
lamp(22.8, 1.2, 11.3, 5, 6, 0xffc78a, 70, 0.2); // behind the jali
lamp(16.6, 1.4, 3.3, 1.2, 4, 0xffc78a, 8, 0.05);
lamp(15.25, 2.75, 11.45, 14, 0, 0xffd6a8, 200, 0.28); // dining chandelier
lamp(12.95, 1.3, 10.7, 0.8, 3, 0xffc78a, 6, 0.04);
lamp(12.95, 1.3, 12.1, 0.8, 3, 0xffc78a, 6, 0.04);
for (const lx of [10.2, 12.45, 14.7]) lamp(lx, 2.6, 6.5, 3, 6, 0xffc78a, 35, 0.12); // gallery lanterns
for (const lx of [9.95, 13.05]) lamp(lx, 2.1, 7.6, 1, 3, 0xffc78a, 10, 0.06);
for (const lx of [13.25, 15.25, 17.25]) lamp(lx, 2.35, 15.4, 1.5, 5, 0xffc78a, 18, 0.07); // terrace lanterns
lamp(5.1, 2.9, 11.6, 10, 0, 0xffd6a8, 170, 0.25); // bedroom chandelier
for (const sx of [-1, 1]) lamp(4.8 + sx * 1.38, 1.2, 8.48, 1.5, 4, 0xffc78a, 30, 0.12); // bedside lamps
for (const ln of [11.25, 12.75]) lamp(9.6, 1.3, ln, 0.6, 3, 0xffc78a, 6, 0.04);

// ---- sheet, rig, resize ------------------------------------------------------------------
let rig, sheet, sheetGroup;
function layout() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  rig = makeRig(w / h);
  if (sheetGroup) {
    scene.remove(sheetGroup);
    sheet.dispose();
  }
  const pxPerMetre = h / rig.frame.h;
  sheet = buildSheet({ frame: rig.frame, portrait: rig.portrait, labelScale: Math.min(1.5, Math.max(1, 13 / pxPerMetre)), anisotropy: ANISO, planesFor: (z) => planesFor(z) });
  sheetGroup = new THREE.Group();
  sheetGroup.add(sheet.group);
  for (const key in sheet.lines) {
    const [kind, zone] = key.split('|');
    sheetGroup.add(inkLines(kind, zone, sheet.lines[key]));
  }
  scene.add(sheetGroup);
  renderer.shadowMap.needsUpdate = true;
}

// ---- one frame -----------------------------------------------------------------------------
const hud = { lens: document.getElementById('hud-lens'), height: document.getElementById('hud-height'), cut: document.getElementById('hud-cut') };
const rail = [...document.querySelectorAll('#rail li')];
const grain = document.getElementById('grain');
const spaced = (v) => Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
let last = null, lastDoor = -1;

function draw(s) {
  const o = rig.at(s);
  last = o;
  camera.position.set(o.x, o.y, o.z);
  camera.rotation.set(o.pitch, o.yaw, 0);
  camera.fov = o.fov;
  camera.near = o.near;
  camera.far = o.far;
  camera.updateProjectionMatrix();
  CUT.constant = o.cut;
  setZoneReveal('entry', o.entry);
  setZoneReveal('foyer', o.foyer);
  setZoneReveal('dining', o.dining);
  setZoneReveal('pool', o.pool);
  setZoneReveal('gallery', o.gallery);
  setZoneReveal('master', o.master);
  if (M.water.normalMap) M.water.normalMap.offset.set(o.s * 0.9, o.s * 0.35); // the water moves as you scroll
  const a = o.door * 1.62;
  if (a !== lastDoor) {
    for (const g of door) g.rotation.y = a * g.userData.sign;
    lastDoor = a;
    renderer.shadowMap.needsUpdate = true;
  }
  renderer.render(scene, camera);

  hud.lens.textContent = o.fov.toFixed(1) + '°';
  const above = o.y - (o.floor ?? GROUND_Y);
  hud.height.textContent = above > 20 ? spaced(above) + ' m' : above.toFixed(2) + ' m';
  hud.cut.textContent = o.cut > 8.5 ? 'none' : '+' + o.cut.toFixed(2) + ' m';
  let on = 0;
  rail.forEach((r, i) => { if (s >= +r.dataset.at) on = i; });
  rail.forEach((r, i) => r.classList.toggle('on', i === on));
  grain.style.opacity = (0.5 * (1 - Math.max(o.entry * 0.5, o.foyer))).toFixed(3);
  if (baked) {
    renderer.toneMappingExposure = baked.meta.exposure;
    const z = o.master > 0.25 ? 'master' : o.gallery > 0.25 ? 'gallery' : o.pool > 0.25 ? 'pool' : o.dining > 0.25 ? 'dining' : o.foyer > 0.25 ? 'foyer' : 'entry';
    if (baked.envs[z] && scene.environment !== baked.envs[z]) {
      scene.environment = baked.envs[z];
      scene.environmentIntensity = 1;
    }
  }
}

// ---- scroll ------------------------------------------------------------------------------------
const proxy = { s: 0 };
const tl = gsap.timeline({ paused: true, defaults: { ease: 'none' } });
tl.to(proxy, { s: 1, duration: 1 }, 0);
tl.to('#hero', { autoAlpha: 0, y: -24, duration: 0.035 }, 0.03);
const caption = (sel, a, b) => {
  tl.fromTo(sel, { autoAlpha: 0, y: 20 }, { autoAlpha: 1, y: 0, duration: 0.03 }, a);
  if (b) tl.to(sel, { autoAlpha: 0, y: -14, duration: 0.03 }, b);
};
const T = (t) => t / LENGTH; // story time to scroll progress
caption('#cap-lift', T(0.1), T(0.3));
caption('#cap-entry', T(0.54), T(0.68));
caption('#cap-foyer', T(0.92), T(1.08));
caption('#cap-dining', T(1.37), T(1.49));
caption('#cap-pool', T(1.64), T(1.78));
caption('#cap-gallery', T(1.94), T(2.12));
caption('#cap-master', T(2.42), T(2.6));
tl.fromTo('#end', { autoAlpha: 0, y: 24 }, { autoAlpha: 1, y: 0, duration: T(0.08) }, T(2.68));

// with reduced motion the page moves in still frames, one per stop
const STILLS = [0, STOPS.sheet + 0.1, STOPS.land, STOPS.foyer, LENGTH].map(T);
const still = (s) => STILLS.reduce((best, v) => (Math.abs(v - s) < Math.abs(best - s) ? v : best), 0);

let drawn = -1;
function tick() {
  const s = REDUCED ? still(proxy.s) : proxy.s;
  if (s !== drawn) {
    drawn = s;
    draw(s);
  }
}

// Compile every shader and upload every texture before the page opens, so no room
// stalls the scroll (or shows up untextured) the first time it comes into view.
async function warmUp() {
  const seen = new Set();
  scene.traverse((o) => {
    const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of mats) for (const v of Object.values(m)) if (v && v.isTexture && !seen.has(v)) {
      seen.add(v);
      renderer.initTexture(v);
    }
  });
  for (const env of Object.values(baked?.envs || {})) renderer.initTexture(env);
  await renderer.compileAsync(scene, camera);
  // one frame from each room, so their programs are bound and their buffers uploaded too
  for (const s of [0.2, 0.35, 0.5, 0.62, 0.75, 0.92]) draw(s);
  draw(0);
}

async function boot() {
  await Promise.race([
    Promise.all(['400 20px "DM Mono"', '500 20px "DM Mono"', '500 40px "Cormorant Garamond"', 'italic 400 40px "Cormorant Garamond"'].map((f) => document.fonts.load(f))),
    new Promise((r) => setTimeout(r, 3000)),
  ]);
  const TX = await loadTextures(ANISO);
  M = makeMaterials(TX, { cement: cementTile(ANISO), wallTile: wallTile(ANISO), blackMarble: blackMarble(ANISO), jali: jali(), mosaic: mosaic(ANISO), ripples: ripples(), painting: painting() });
  assemble();
  await placeModels();
  if (!params.has('nobake')) baked = await loadBake();
  if (baked) {
    // the lightmaps hold all the light now: real-time lights and shadows go
    for (const l of realtime) l.intensity = 0;
    renderer.shadowMap.enabled = false;
  }
  layout();
  draw(0);
  if (!CAPTURE) await warmUp();

  if (CAPTURE) {
    window.__frame = (s) =>
      new Promise((res) => {
        tl.progress(s);
        draw(proxy.s);
        requestAnimationFrame(() => requestAnimationFrame(() => res(true)));
      });
    // clearance check for tools/clearance.mjs: the nearest surface in view, and around the camera
    const names = new Map(Object.entries(parts).map(([k, m]) => [m, k]));
    const ray = new THREE.Raycaster();
    const targets = Object.values(parts);
    window.__clear = (s) => {
      tl.progress(s);
      draw(proxy.s);
      let best = { d: Infinity };
      const probe = (dir, kind) => {
        ray.set(camera.position, dir);
        ray.far = 3;
        const hit = ray.intersectObjects(targets, false)[0];
        if (hit && hit.distance < best.d) best = { d: hit.distance, key: names.get(hit.object), kind, at: hit.point.toArray().map((v) => +v.toFixed(2)) };
      };
      for (let i = 0; i <= 8; i++) for (let j = 0; j <= 4; j++) {
        const v = new THREE.Vector3((i / 4 - 1), (j / 2 - 1), 0.5).unproject(camera).sub(camera.position).normalize();
        probe(v, 'view');
      }
      for (let k = 0; k < 12; k++) probe(new THREE.Vector3(Math.cos((k / 12) * Math.PI * 2), 0, Math.sin((k / 12) * Math.PI * 2)), 'side');
      return { s, T: +(proxy.s * LENGTH).toFixed(3), cam: camera.position.toArray().map((v) => +v.toFixed(2)), ...best };
    };
  } else {
    gsap.registerPlugin(ScrollTrigger);
    // one layer of smoothing, not two: Lenis eases the wheel, and the camera follows the
    // scroll position exactly (scrub: true). Lenis leaves touch scrolling native, so on
    // touch screens a short scrub does the easing instead.
    const touch = matchMedia('(pointer: coarse)').matches;
    if (!REDUCED) {
      const lenis = new Lenis({ lerp: 0.1, wheelMultiplier: 1, smoothWheel: true });
      lenis.on('scroll', ScrollTrigger.update);
      gsap.ticker.add((t) => lenis.raf(t * 1000));
      gsap.ticker.lagSmoothing(0);
    }
    ScrollTrigger.create({ trigger: '#track', start: 'top top', end: 'bottom bottom', scrub: REDUCED || !touch ? true : 0.5, animation: tl });
    gsap.ticker.add(tick);
    if (!REDUCED) {
      gsap.from('#hero h1 .l > span', { yPercent: 108, duration: 1.3, ease: 'expo.out', stagger: 0.12, delay: 0.2 });
      gsap.from('#hero .eyebrow, #hero .lede, #hero .cue, #bar', { autoAlpha: 0, y: 12, duration: 1, ease: 'power2.out', stagger: 0.08, delay: 0.55 });
    }
  }
  addEventListener('resize', () => {
    layout();
    drawn = -1;
    if (CAPTURE) draw(proxy.s);
  });
  window.__state = () => ({ ...last, baked: baked ? baked.swapped : 0, errors: errors.slice(), calls: renderer.info.render.calls, tris: renderer.info.render.triangles });
  const loading = document.getElementById('loading');
  if (CAPTURE) loading.style.transition = 'none';
  loading.classList.add('done');
  window.__ready = true;
}

boot().catch((e) => {
  errors.push(String(e && e.stack ? e.stack : e));
  console.error(e);
});
