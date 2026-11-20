// Villa Saanjh, checkpoint 1: the sheet, the walls rising, the walk into the foyer.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

import { PAPER, INK, GROUND_Y, SUN } from './plan.js';
import { CUT, ZONE_PLANES, setZoneReveal, loadTextures, makeMaterials } from './materials.js';
import { cementTile, wallTile, blackMarble, jali } from './patterns.js';
import { buildHouse } from './house.js';
import { buildSheet } from './sheet.js';
import { makeRig, STOPS } from './rig.js';

const params = new URLSearchParams(location.search);
const CAPTURE = params.has('capture'); // recording: one exact frame per request, no smoothing
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const errors = (window.__errors = []);
addEventListener('error', (e) => errors.push(String(e.message)));
addEventListener('unhandledrejection', (e) => errors.push(String(e.reason)));

// ---- renderer ---------------------------------------------------------------------
const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
const DPR = Math.min(devicePixelRatio || 1, 2);
renderer.setPixelRatio(DPR);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
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
const paper = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.MeshBasicMaterial({ color: PAPER, toneMapped: false }));
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

function assemble() {
  const solid = (geo, mat, shadows = true) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = shadows;
    m.receiveShadow = shadows;
    house.add(m);
    return m;
  };
  for (const key in H.shell.geometries) solid(H.shell.geometries[key], M[key]);
  for (const key in H.shell.edges) house.add(inkLines('structure', key, H.shell.edges[key]));
  for (const key in H.kit.parts) {
    const mat = key.split('|')[1];
    if (!M[mat]) errors.push('no material ' + mat);
    const glow = ['glass', 'lampGlass', 'crystal', 'night'].includes(mat);
    const mesh = solid(H.kit.parts[key].geometry(), M[mat], !glow);
    if (mat === 'glass') mesh.renderOrder = 3;
  }
  for (const key in H.kit.lines) house.add(inkLines('kit', key, H.kit.lines[key]));
  for (const g of H.leaves) {
    const u = g.userData;
    for (const [geo, mat] of [[u.part, M.teak], [u.trim, M.teak], [u.brass, M.gold]]) {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = m.receiveShadow = true;
      g.add(m);
    }
    g.add(inkLines('kit', 'foyer', u.lines));
    house.add(g);
    door.push(g);
  }
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
scene.add(new THREE.HemisphereLight(0xc9d3e6, 0xb39a7c, 0.85));
const lamp = (x, y, n, intensity, dist = 0, color = 0xffc78a) => {
  const l = new THREE.PointLight(color, intensity, dist, 2);
  l.position.set(x, y, -n);
  scene.add(l);
  return l;
};
lamp(19.9, 3.9, 5.25, 30, 0, 0xffd6a8); // chandelier
lamp(19.9, 2.2, 5.25, 6, 0, 0xffe0c0); // its light bounced off the floor
lamp(25.8, 3.0, 5.25, 9, 12); // portico lantern
lamp(24.45, 2.35, 3.75, 2.2, 6);
lamp(24.45, 2.35, 6.75, 2.2, 6);
lamp(20.95, 2.25, 2.95, 2.0, 5);
lamp(23.35, 2.25, 2.95, 2.0, 5);
lamp(22.8, 1.2, 11.3, 5, 6); // behind the jali
lamp(16.6, 1.4, 3.3, 1.2, 4);

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
caption('#cap-lift', 0.1, 0.3);
caption('#cap-entry', 0.54, 0.68);
caption('#cap-foyer', 0.93, null);

// with reduced motion the page moves in still frames, one per stop
const STILLS = [0, STOPS.sheet + 0.1, STOPS.land, 1];
const still = (s) => STILLS.reduce((best, v) => (Math.abs(v - s) < Math.abs(best - s) ? v : best), 0);

let drawn = -1;
function tick() {
  const s = REDUCED ? still(proxy.s) : proxy.s;
  if (s !== drawn) {
    drawn = s;
    draw(s);
  }
}

async function boot() {
  await Promise.race([
    Promise.all(['400 20px "DM Mono"', '500 20px "DM Mono"', '500 40px "Cormorant Garamond"', 'italic 400 40px "Cormorant Garamond"'].map((f) => document.fonts.load(f))),
    new Promise((r) => setTimeout(r, 3000)),
  ]);
  const T = await loadTextures(ANISO);
  M = makeMaterials(T, { cement: cementTile(ANISO), wallTile: wallTile(ANISO), blackMarble: blackMarble(ANISO), jali: jali() });
  assemble();
  layout();
  draw(0);

  if (CAPTURE) {
    window.__frame = (s) =>
      new Promise((res) => {
        tl.progress(s);
        draw(proxy.s);
        requestAnimationFrame(() => requestAnimationFrame(() => res(true)));
      });
  } else {
    gsap.registerPlugin(ScrollTrigger);
    if (!REDUCED) {
      const lenis = new Lenis({ lerp: 0.085, wheelMultiplier: 0.85 });
      lenis.on('scroll', ScrollTrigger.update);
      gsap.ticker.add((t) => lenis.raf(t * 1000));
      gsap.ticker.lagSmoothing(0);
    }
    ScrollTrigger.create({ trigger: '#track', start: 'top top', end: 'bottom bottom', scrub: REDUCED ? true : 0.8, animation: tl });
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
  window.__state = () => ({ ...last, errors: errors.slice(), calls: renderer.info.render.calls, tris: renderer.info.render.triangles });
  const loading = document.getElementById('loading');
  if (CAPTURE) loading.style.transition = 'none';
  loading.classList.add('done');
  window.__ready = true;
}

boot().catch((e) => {
  errors.push(String(e && e.stack ? e.stack : e));
  console.error(e);
});
