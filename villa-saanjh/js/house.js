// Villa Saanjh: the model. One building serves the plan, the rising walls and
// the walk. Plan (x east, n north) becomes three.js (x, y, -n).

import * as THREE from 'three';
import { BoxSolid, Part, boxEdges } from './solid.js';
import { ROOMS, ZONES, DOORS, FRONT_DOOR, TREES, GROUND_Y } from './plan.js';

export function zoneOf(x, y, n) {
  for (const z of ZONES) if (x > z.x0 && x < z.x1 && n > z.n0 && n < z.n1 && y > z.y0 && y < z.y1) return z.key;
  return 'rest';
}
const inRoom = (key, x, n) => {
  const r = ROOMS.find((q) => q.key === key);
  return x > r.x0 - 0.01 && x < r.x1 + 0.01 && n > r.n0 - 0.01 && n < r.n1 + 0.01;
};

// ---------------------------------------------------------------------------
// Kit: loose pieces (furniture, glass, trim), bucketed by zone and material.
// ---------------------------------------------------------------------------
class Kit {
  constructor() {
    this.parts = {};
    this.lines = {};
  }
  part(zone, mat) {
    return (this.parts[zone + '|' + mat] ??= new Part());
  }
  edges(zone) {
    return (this.lines[zone] ??= []);
  }
  box(mat, x0, n0, x1, n1, y0, y1, { zone, edges = true } = {}) {
    zone ??= zoneOf((x0 + x1) / 2, (y0 + y1) / 2, (n0 + n1) / 2);
    this.part(zone, mat).box(x0, y0, -n0, x1, y1, -n1);
    if (edges) boxEdges(this.edges(zone), Math.min(x0, x1), Math.min(y0, y1), -Math.max(n0, n1), Math.max(x0, x1), Math.max(y0, y1), -Math.min(n0, n1));
  }
  // a three.js geometry already placed in world space
  geo(mat, g, { zone, angle = 32, edges = true, uvScale = 1 } = {}) {
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!zone) {
      g.computeBoundingBox();
      const c = g.boundingBox.getCenter(new THREE.Vector3());
      zone = zoneOf(c.x, c.y, -c.z);
    }
    this.part(zone, mat).mesh(g, uvScale);
    if (edges) {
      const e = new THREE.EdgesGeometry(g, angle).attributes.position;
      const E = this.edges(zone);
      for (let i = 0; i < e.count; i++) E.push(e.getX(i), e.getY(i), e.getZ(i));
    }
  }
  line(zone, pts) {
    const E = this.edges(zone);
    for (let i = 0; i < pts.length - 1; i++) E.push(...pts[i], ...pts[i + 1]);
  }
}

const M4 = (x, y, n, ry = 0, s = 1) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, -n), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), new THREE.Vector3(s, s, s));
const at = (g, x, y, n, ry = 0, s = 1) => g.applyMatrix4(M4(x, y, n, ry, s));

// Rectangle with a round-headed hole: the fill above a round arch.
// Built in a wall plane. `along` 'n': wall runs north-south at x = t0..t1.
// `along` 'x': wall runs east-west at n = t0..t1.
function archFill(a0, a1, spring, top, along, t0, t1) {
  const r = (a1 - a0) / 2, c = (a0 + a1) / 2;
  const s = new THREE.Shape();
  s.moveTo(a0, spring);
  s.lineTo(a0, top);
  s.lineTo(a1, top);
  s.lineTo(a1, spring);
  s.absarc(c, spring, r, 0, Math.PI, false);
  const g = new THREE.ExtrudeGeometry(s, { depth: t1 - t0, bevelEnabled: false, curveSegments: 28 });
  const m = new THREE.Matrix4();
  // shape (u, y, depth) -> world
  if (along === 'n') m.set(0, 0, 1, t0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 0, 1);
  else m.set(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, -t1, 0, 0, 0, 1);
  return g.applyMatrix4(m);
}
// a flat round-headed pane (glass, a dark interior) in a wall plane
function archPane(a0, a1, y0, spring, along, t) {
  const r = (a1 - a0) / 2, c = (a0 + a1) / 2;
  const s = new THREE.Shape();
  s.moveTo(a0, y0);
  s.lineTo(a1, y0);
  s.lineTo(a1, spring);
  s.absarc(c, spring, r, 0, Math.PI, false);
  s.lineTo(a0, y0);
  const g = new THREE.ShapeGeometry(s, 28);
  const m = new THREE.Matrix4();
  if (along === 'n') m.set(0, 0, 1, t, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 0, 1);
  else m.set(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, -t, 0, 0, 0, 1);
  return g.applyMatrix4(m);
}

// ---------------------------------------------------------------------------
// Plants, built from leaflets. Lines follow only the midribs so the drawing
// stays clean.
// ---------------------------------------------------------------------------
function frond(kit, zone, base, dir, len, rise, droop, width, rnd) {
  const pts = [];
  const N = 14;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    pts.push(new THREE.Vector3(
      base.x + dir.x * len * t,
      base.y + (rise * t - droop * t * t) * len,
      base.z + dir.z * len * t
    ));
  }
  const side = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
  const pos = [];
  for (let i = 2; i < N; i++) {
    const p = pts[i], q = pts[i + 1];
    const t = i / N;
    const w = width * Math.sin(Math.PI * Math.min(1, t * 1.15)) * (0.8 + 0.4 * rnd());
    for (const sgn of [-1, 1]) {
      const tip = p.clone().addScaledVector(side, sgn * w).add(new THREE.Vector3(0, -w * 0.55, 0)).addScaledVector(dir, w * 0.35);
      pos.push(p.x, p.y, p.z, q.x, q.y, q.z, tip.x, tip.y, tip.z);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array((pos.length / 3) * 2).fill(0), 2));
  kit.geo('leaf', g, { zone, edges: false });
  kit.line(zone, pts.map((v) => [v.x, v.y, v.z]));
}

function seeded(seed) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

function palm(kit, x, n, y0, h, { zone, seed = 1, fronds = 13, len = 3.2 } = {}) {
  const rnd = seeded(seed * 977 + 13);
  const lean = new THREE.Vector3(rnd() - 0.5, 0, rnd() - 0.5).normalize().multiplyScalar(h * 0.12);
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(x, y0, -n),
    new THREE.Vector3(x + lean.x * 0.3, y0 + h * 0.5, -n + lean.z * 0.3),
    new THREE.Vector3(x + lean.x, y0 + h, -n + lean.z),
  ]);
  zone ??= zoneOf(x, y0 + 1, n);
  kit.geo('trunk', new THREE.TubeGeometry(curve, 10, 0.16, 7, false), { zone, angle: 50 });
  const top = curve.getPoint(1);
  for (let k = 0; k < fronds; k++) {
    const a = (k / fronds) * Math.PI * 2 + rnd() * 0.4;
    const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    frond(kit, zone, top, dir, len * (0.75 + rnd() * 0.4), 0.5 + rnd() * 0.5, 1.1 + rnd() * 0.5, 0.42, rnd);
  }
}

// an areca palm in a pot, for indoors
function pottedPalm(kit, x, n, { zone, seed = 3, h = 2.2, pot = 'ceramic' } = {}) {
  const rnd = seeded(seed * 131 + 7);
  const potG = new THREE.LatheGeometry(
    [[0.0, 0], [0.24, 0], [0.3, 0.08], [0.34, 0.3], [0.32, 0.52], [0.3, 0.56], [0.0, 0.56]].map(([r, y]) => new THREE.Vector2(r, y)),
    28
  );
  kit.geo(pot, at(potG, x, 0, n), { zone, angle: 40 });
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * Math.PI * 2 + rnd() * 0.5;
    const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const base = new THREE.Vector3(x, 0.52, -n);
    frond(kit, zone, base, dir, h * (0.6 + rnd() * 0.25), 2.2 + rnd() * 0.6, 1.6 + rnd() * 0.4, 0.2, rnd);
  }
}

// a Moroccan brass lantern
function lantern(kit, x, y, n, { zone, scale = 1, hanging = false } = {}) {
  const s = scale;
  const body = new THREE.CylinderGeometry(0.13 * s, 0.11 * s, 0.34 * s, 8, 1, true);
  kit.geo('lampGlass', at(body, x, y, n), { zone, edges: false });
  kit.geo('gold', at(new THREE.ConeGeometry(0.17 * s, 0.22 * s, 8), x, y + 0.28 * s, n), { zone });
  kit.geo('gold', at(new THREE.SphereGeometry(0.035 * s, 8, 6), x, y + 0.42 * s, n), { zone, edges: false });
  kit.geo('gold', at(new THREE.CylinderGeometry(0.15 * s, 0.1 * s, 0.06 * s, 8), x, y - 0.2 * s, n), { zone });
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    kit.geo('gold', at(new THREE.CylinderGeometry(0.008 * s, 0.008 * s, 0.36 * s, 4), x + Math.cos(a) * 0.13 * s, y, n + Math.sin(a) * 0.13 * s), { zone, edges: false });
  }
  if (hanging) kit.geo('gold', at(new THREE.CylinderGeometry(0.01, 0.01, hanging, 4), x, y + 0.42 * s + hanging / 2, n), { zone, edges: false });
}

// ---------------------------------------------------------------------------
// The building
// ---------------------------------------------------------------------------
const BASE = GROUND_Y + 0.012; // a hair above the paper, so the cut shows the inside of the solid

export function buildHouse() {
  const S = new BoxSolid();
  const A = (x0, n0, x1, n1, y0, y1) => S.box(1, x0, y0, -n0, x1, y1, -n1);
  const C = (x0, n0, x1, n1, y0, y1) => S.box(0, x0, y0, -n0, x1, y1, -n1);
  const kit = new Kit();

  // ---- masses -----------------------------------------------------------------
  A(0, 0, 24, 15, BASE, 4.0); // ground floor, on a plinth
  A(0, 0, 24, 15, 4.0, 7.9); // first floor and roof
  A(-0.2, -0.2, 24.2, 15.2, 7.9, 8.3); // roof cornice
  A(0, 15, 16, 23.5, -1.9, 0); // pool terrace
  C(2.5, 16.5, 13.5, 21.5, -1.5, 0); // the pool (6 m deep plan in a 11 x 5 m basin)
  A(17.0, 15.6, 26.2, 25.0, BASE, -0.33); // parking court

  // boundary wall around the site, with a gate for the path and one for the cars
  const BW = 1.8, bwT = 0.25;
  A(-4.5, -4.5, 38.5, -4.25, BASE, BW);
  A(-4.5, 27.25, 38.5, 27.5, BASE, BW);
  A(-4.5, -4.5, -4.25, 27.5, BASE, BW);
  A(38.25, -4.5, 38.5, 27.5, BASE, BW);
  C(38.2, 3.6, 38.6, 6.9, GROUND_Y, BW + 0.1); // pedestrian gate
  C(38.2, 15.8, 38.6, 24.8, GROUND_Y, BW + 0.1); // car gate
  void bwT;

  // ---- rooms ---------------------------------------------------------------
  for (const r of ROOMS) C(r.x0, r.n0, r.x1, r.n1, 0, r.h);
  C(16.1, 0.3, 23.7, 2.6, 4.25, 7.4); // the foyer is double height over powder and lift too
  A(18.1, 7.9, 21.85, 9.9, 3.75, 4.0); // upper landing
  C(17.7, 8.3, 18.1, 9.5, 4.0, 6.5); // door to the first floor

  // doors (rectangular)
  C(7.9, 5.8, 8.1, 6.9, 0, 2.7); // bedroom 2
  C(8.5, 7.9, 9.6, 8.1, 0, 2.7); // master
  C(9.0, 4.9, 10.0, 5.1, 0, 2.7); // wardrobe
  C(12.5, 4.9, 13.5, 5.1, 0, 2.7); // bath 2
  C(9.9, 9.0, 10.1, 10.0, 0, 2.7); // master bath
  C(18.6, 2.4, 19.5, 2.6, 0, 2.7); // powder
  C(21.55, 2.4, 22.75, 2.6, 0, 2.5); // lift

  // round-headed openings: cut the full rectangle, then fill the shoulders
  const arches = [];
  const arch = (along, t0, t1, a0, a1, spring, y0 = 0, glass = false, mat = 'plaster') => {
    const r = (a1 - a0) / 2;
    if (along === 'n') C(t0, a0, t1, a1, y0, spring + r);
    else C(a0, t0, a1, t1, y0, spring + r);
    arches.push({ along, t0, t1, a0, a1, spring, top: spring + r, y0, glass, mat });
  };
  arch('n', 23.7, 24.0, 4.35, 6.15, 2.9, 0, 'fan', 'render'); // front door, with a fanlight
  arch('x', 7.9, 8.1, 13.4, 15.6, 2.4); // gallery to dining
  arch('x', 7.9, 8.1, 16.45, 17.65, 2.35); // foyer to dining
  arch('n', 17.9, 18.1, 9.5, 11.3, 2.45); // dining to stair hall
  arch('n', 17.9, 18.1, 11.6, 13.4, 2.45);
  // clerestory over the lift and powder room: the late sun comes in here
  for (const [a0, a1] of [[16.9, 18.3], [19.2, 20.6], [21.5, 22.9]]) arch('x', 0, 0.3, a0, a1, 6.1, 4.7, true, 'render');
  arch('x', 14.7, 15.0, 20.3, 23.2, 5.2, 2.5, true, 'render'); // stair hall, over the pool
  arch('x', 14.7, 15.0, 13.2, 17.4, 2.1, 0, true, 'render'); // dining onto the terrace
  for (const [a0, a1] of [[1.2, 3.8], [5.0, 7.6]]) arch('x', 14.7, 15.0, a0, a1, 2.2, 0, true, 'render'); // master
  arch('n', 0, 0.3, 2.0, 5.8, 1.9, 0.6, true, 'render'); // bedroom 2, west
  arch('n', 0, 0.3, 9.4, 13.4, 1.9, 0.6, true, 'render'); // master, west
  // first floor windows on the street front (dark behind the glass)
  for (const [a0, a1] of [[0.9, 2.3], [11.0, 12.4], [13.6, 15.0]]) arch('n', 23.75, 24.0, a0, a1, 6.3, 4.8, 'dark', 'render');
  for (const [a0, a1] of [[1.0, 2.6], [4.0, 5.6], [8.6, 10.2], [11.6, 13.2]]) arch('x', 0, 0.3, a0, a1, 2.3, 0.7, true, 'render');

  // gallery arch into the foyer: a wall plane carries the shoulders
  arches.push({ along: 'n', t0: 15.95, t1: 16.25, a0: 5.1, a1: 7.9, spring: 2.2, top: 3.6, y0: 0, glass: false, mat: 'plaster' });

  // ---- the portico ------------------------------------------------------------
  A(24.0, 2.6, 27.6, 7.9, BASE, 0); // porch floor
  A(27.6, 3.3, 28.0, 7.2, BASE, -0.15); // steps
  A(28.0, 3.3, 28.4, 7.2, BASE, -0.3);
  A(24.0, 2.6, 27.6, 3.0, 0, 4.6); // side walls
  A(24.0, 7.5, 27.6, 7.9, 0, 4.6);
  arch('x', 2.6, 3.0, 24.6, 26.8, 2.3, 0, false, 'render');
  arch('x', 7.5, 7.9, 24.6, 26.8, 2.3, 0, false, 'render');
  A(27.0, 2.6, 27.6, 7.9, 0, 4.6); // front, with a great arch
  arch('n', 27.0, 27.6, 3.3, 7.2, 2.6, 0, false, 'render');
  A(23.9, 2.3, 27.9, 8.2, 4.6, 5.0); // roof and cornice
  A(23.9, 1.9, 24.3, 8.6, 3.9, 4.15); // a string course across the front

  // ---- skin --------------------------------------------------------------------
  const HOUSE = (x, n) => x > 0.001 && x < 23.999 && n > 0.001 && n < 14.999;
  const faceMat = ([cx, cy, cz], [nx, ny, nz]) => {
    const x = cx, y = cy, n = -cz;
    const ax = x + nx * 0.05, ay = y + ny * 0.05, an = n - nz * 0.05; // a point in the air
    if (ny > 0) {
      if (y > 7.8) return 'roof';
      if (Math.abs(y) < 0.01 && HOUSE(x, n)) {
        if (inRoom('foyer', x, n) || inRoom('stair', x, n)) return 'cement';
        if (inRoom('bed2', x, n) || inRoom('master', x, n) || inRoom('ward', x, n)) return 'teak';
        return 'marbleWhite';
      }
      if (y > 3.7 && y < 4.05 && inRoom('stair', x, n)) return 'blackMarble';
      if (y > 3.0 && y < 7.8) return 'render';
      return 'paving';
    }
    if (ny < 0) return y > 4.4 && y < 5.1 && x > 23.8 ? 'teak' : 'ceiling';
    const outside = !HOUSE(ax, an) || ay > 7.9 || ay < 0;
    if (outside) return 'render';
    return 'plaster';
  };
  const edgeTag = (mid, air) => zoneOf(air[0], air[1], -air[2]);
  const shell = S.build(faceMat, edgeTag);

  // arch shoulders and panes
  for (const a of arches) {
    const zoneAt = a.along === 'n' ? zoneOf((a.t0 + a.t1) / 2 + 0.3, a.spring, (a.a0 + a.a1) / 2) : zoneOf((a.a0 + a.a1) / 2, a.spring, (a.t0 + a.t1) / 2);
    kit.geo(a.mat, archFill(a.a0, a.a1, a.spring, a.top, a.along, a.t0, a.t1), { zone: zoneAt, angle: 20 });
    if (a.glass) {
      const mid = (a.t0 + a.t1) / 2;
      const pane = archPane(a.a0, a.a1, a.y0, a.spring, a.along, mid);
      kit.geo('glass', pane, { zone: zoneAt, edges: false });
      if (a.glass === 'dark') kit.geo('night', archPane(a.a0, a.a1, a.y0, a.spring, a.along, a.along === 'n' ? mid - 0.08 : mid + 0.08), { zone: zoneAt, edges: false });
      // black steel glazing bars: a grid below the spring, rays in the head
      const r = (a.a1 - a.a0) / 2, c = (a.a0 + a.a1) / 2;
      const bar = (u0, y0, u1, y1) => {
        const p = (u, y) => (a.along === 'n' ? [mid, y, -u] : [u, y, -mid]);
        kit.line(zoneAt, [p(u0, y0), p(u1, y1)]);
        const len = Math.hypot(u1 - u0, y1 - y0);
        const g = new THREE.BoxGeometry(0.035, len, 0.05);
        g.rotateZ(-Math.atan2(u1 - u0, y1 - y0));
        if (a.along === 'n') g.rotateY(-Math.PI / 2);
        const q = p((u0 + u1) / 2, (y0 + y1) / 2);
        g.translate(q[0], q[1], q[2]);
        kit.geo('iron', g, { zone: zoneAt, edges: false });
      };
      if (a.glass !== 'fan') {
        const cols = Math.max(2, Math.round((a.a1 - a.a0) / 0.55));
        for (let i = 1; i < cols; i++) bar(a.a0 + ((a.a1 - a.a0) * i) / cols, a.y0, a.a0 + ((a.a1 - a.a0) * i) / cols, a.spring + (i === cols / 2 ? r : 0));
        const rows = Math.max(1, Math.round((a.spring - a.y0) / 0.6));
        for (let j = 1; j <= rows; j++) bar(a.a0, a.y0 + ((a.spring - a.y0) * j) / rows, a.a1, a.y0 + ((a.spring - a.y0) * j) / rows);
      }
      for (const ang of [30, 60, 90, 120, 150]) {
        const t = (ang * Math.PI) / 180;
        bar(c, a.spring, c + Math.cos(t) * r, a.spring + Math.sin(t) * r);
      }
    }
  }

  // ---- the front door: two carved teak leaves under a fanlight ---------------------
  const FD = FRONT_DOOR;
  const leaves = [];
  for (const side of [0, 1]) {
    const w = (FD.n1 - FD.n0) / 2;
    const g = new THREE.Group();
    const part = new Part();
    const trim = new Part();
    const lines = [];
    // leaf built in local space: hinge at the origin, leaf running along local -z (north) for the south leaf
    const dirZ = side === 0 ? -1 : 1;
    const z0 = 0, z1 = dirZ * w;
    part.box(-0.04, 0, Math.min(z0, z1), 0.04, 2.9, Math.max(z0, z1));
    boxEdges(lines, -0.04, 0, Math.min(z0, z1), 0.04, 2.9, Math.max(z0, z1));
    // raised panels on both faces
    for (const [p0, p1] of [[0.25, 1.25], [1.45, 2.65]]) {
      const zz0 = dirZ * 0.14, zz1 = dirZ * (w - 0.14);
      for (const sx of [-1, 1]) {
        const xa = sx * 0.04, xb = sx * 0.065;
        trim.box(Math.min(xa, xb), p0, Math.min(zz0, zz1), Math.max(xa, xb), p1, Math.max(zz0, zz1));
        boxEdges(lines, Math.min(xa, xb), p0, Math.min(zz0, zz1), Math.max(xa, xb), p1, Math.max(zz0, zz1));
      }
    }
    // a brass ring pull near the meeting edge
    const brass = new Part();
    const ringG = new THREE.TorusGeometry(0.07, 0.012, 8, 20);
    ringG.rotateY(Math.PI / 2);
    for (const sx of [-1, 1]) brass.mesh(ringG.clone().translate(sx * 0.085, 1.2, dirZ * (w - 0.16)));
    g.position.set(FD.x, 0, -(side === 0 ? FD.n0 : FD.n1));
    g.userData = { part: part.geometry(), trim: trim.geometry(), brass: brass.geometry(), lines, sign: side === 0 ? 1 : -1 };
    leaves.push(g);
  }

  // fanlight glass and a sill of teak
  kit.box('teak', 23.68, 4.3, 24.02, 6.2, 2.9, 2.96, { zone: 'foyer' });

  // ---- inside the foyer ---------------------------------------------------------------
  const Z = 'foyer';
  // floor: a cement tile field, a navy border and a white marble surround
  const border = (x0, n0, x1, n1, w, mat, y = 0.003) => {
    kit.box(mat, x0, n0, x1, n0 + w, 0, y, { zone: Z, edges: false });
    kit.box(mat, x0, n1 - w, x1, n1, 0, y, { zone: Z, edges: false });
    kit.box(mat, x0, n0 + w, x0 + w, n1 - w, 0, y, { zone: Z, edges: false });
    kit.box(mat, x1 - w, n0 + w, x1, n1 - w, 0, y, { zone: Z, edges: false });
    kit.line(Z, [[x0 + w, y, -(n0 + w)], [x1 - w, y, -(n0 + w)], [x1 - w, y, -(n1 - w)], [x0 + w, y, -(n1 - w)], [x0 + w, y, -(n0 + w)]]);
  };
  border(16.1, 2.6, 23.7, 7.9, 0.45, 'marbleWhite', 0.004);
  border(16.55, 3.05, 23.25, 7.45, 0.12, 'navy', 0.005);

  // chandelier: three gilt rings of crystal drops under a chain
  const CH = { x: 19.9, n: 5.25 };
  kit.geo('gold', at(new THREE.CylinderGeometry(0.012, 0.012, 2.9, 5), CH.x, 5.95, CH.n), { zone: Z, edges: false });
  kit.geo('gold', at(new THREE.CylinderGeometry(0.25, 0.08, 0.12, 16), CH.x, 7.34, CH.n), { zone: Z });
  const drop = new THREE.OctahedronGeometry(0.03, 0);
  drop.scale(1, 1.8, 1);
  const tiers = [[0.78, 3.6, 34, 5], [0.58, 4.05, 26, 4], [0.38, 4.45, 18, 3]];
  for (const [r, y, count, len] of tiers) {
    const ring = new THREE.TorusGeometry(r, 0.02, 6, 48);
    ring.rotateX(Math.PI / 2);
    kit.geo('gold', at(ring, CH.x, y, CH.n), { zone: Z });
    for (let k = 0; k < count; k++) {
      const a = (k / count) * Math.PI * 2;
      for (let j = 0; j < len; j++) kit.geo('crystal', at(drop.clone(), CH.x + Math.cos(a) * r, y - 0.07 - j * 0.085, CH.n + Math.sin(a) * r), { zone: Z, edges: false });
    }
    // spokes up to the stem
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      kit.line(Z, [[CH.x + Math.cos(a) * r, y, -(CH.n + Math.sin(a) * r)], [CH.x, y + 0.25, -CH.n]]);
    }
  }
  kit.geo('lampGlass', at(new THREE.CylinderGeometry(0.16, 0.2, 0.8, 16), CH.x, 4.0, CH.n), { zone: Z, edges: false });

  // round table under the chandelier: gilt pedestal, white marble top, flowers
  const ped = new THREE.LatheGeometry(
    [[0, 0], [0.42, 0], [0.42, 0.06], [0.2, 0.12], [0.11, 0.3], [0.15, 0.45], [0.09, 0.6], [0.24, 0.72], [0, 0.72]].map(([r, y]) => new THREE.Vector2(r, y)),
    32
  );
  kit.geo('gold', at(ped, CH.x, 0, CH.n), { zone: Z, angle: 40 });
  kit.geo('marbleWhite', at(new THREE.CylinderGeometry(0.72, 0.72, 0.05, 48), CH.x, 0.745, CH.n), { zone: Z });
  const vase = new THREE.LatheGeometry(
    [[0, 0], [0.12, 0], [0.2, 0.12], [0.2, 0.28], [0.1, 0.42], [0.13, 0.48], [0, 0.48]].map(([r, y]) => new THREE.Vector2(r, y)),
    28
  );
  kit.geo('porcelain', at(vase, CH.x, 0.77, CH.n), { zone: Z, angle: 40 });
  {
    const rnd = seeded(41);
    const ball = new THREE.IcosahedronGeometry(1, 1);
    // a dome of small blossoms over the vase, and a few stems standing out of it
    for (let k = 0; k < 420; k++) {
      const a = rnd() * Math.PI * 2, el = Math.acos(1 - rnd() * 1.1), R = 0.3 + rnd() * 0.05;
      const px = CH.x + Math.cos(a) * Math.sin(el) * R, pn = CH.n + Math.sin(a) * Math.sin(el) * R, py = 1.22 + Math.cos(el) * R * 0.85;
      const r = 0.018 + rnd() * 0.02;
      const g = ball.clone().scale(r, r * 0.8, r);
      const c = rnd();
      kit.geo(c < 0.45 ? 'flowerWhite' : c < 0.8 ? 'flowerPink' : 'flowerPlum', at(g, px, py, pn), { zone: Z, edges: false });
    }
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * Math.PI * 2 + rnd();
      frond(kit, Z, new THREE.Vector3(CH.x + Math.cos(a) * 0.15, 1.2, -(CH.n + Math.sin(a) * 0.15)), new THREE.Vector3(Math.cos(a), 0, Math.sin(a)), 0.42, 0.4, 1.1, 0.05, rnd);
    }
  }

  // west wall: a gilt sunburst mirror over a marble console
  const MX = 16.1, MN = 3.85;
  const mirror = new THREE.CircleGeometry(0.46, 48);
  mirror.rotateY(Math.PI / 2);
  kit.geo('mirror', at(mirror, MX + 0.035, 2.25, MN), { zone: Z });
  const frame = new THREE.TorusGeometry(0.5, 0.045, 10, 48);
  frame.rotateY(Math.PI / 2);
  kit.geo('gold', at(frame, MX + 0.04, 2.25, MN), { zone: Z, edges: false });
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2;
    const len = k % 2 ? 0.32 : 0.48;
    const ray = new THREE.BoxGeometry(0.02, len, k % 2 ? 0.035 : 0.05);
    ray.translate(0, 0.55 + len / 2, 0);
    ray.rotateX(a);
    kit.geo('gold', at(ray, MX + 0.03, 2.25, MN), { zone: Z, edges: false });
  }
  kit.box('marbleWhite', 16.1, 3.0, 16.55, 4.7, 0.86, 0.9, { zone: Z });
  for (const nn of [3.1, 4.6]) {
    const leg = new THREE.LatheGeometry([[0.0, 0], [0.05, 0], [0.03, 0.2], [0.045, 0.45], [0.025, 0.7], [0.05, 0.86], [0, 0.86]].map(([r, y]) => new THREE.Vector2(r, y)), 12);
    kit.geo('gold', at(leg, 16.42, 0, nn), { zone: Z, angle: 50 });
  }
  kit.box('gold', 16.15, 3.0, 16.5, 4.7, 0.78, 0.86, { zone: Z });
  lantern(kit, 16.38, 1.12, 3.3, { zone: Z, scale: 0.7 });
  kit.geo('porcelain', at(vase.clone().scale(0.7, 0.9, 0.7), 16.33, 0.9, 4.35), { zone: Z, angle: 40 });

  // south wall: the lift, in black marble and gold, between tiled walls and lanterns
  kit.box('wallTile', 20.45, 2.6, 23.65, 2.615, 0, 3.6, { zone: Z, edges: false });
  kit.line(Z, [[20.45, 0, -2.615], [20.45, 3.6, -2.615], [23.65, 3.6, -2.615], [23.65, 0, -2.615]]);
  kit.box('blackMarble', 21.25, 2.6, 21.55, 2.7, 0, 2.95, { zone: Z });
  kit.box('blackMarble', 22.75, 2.6, 23.05, 2.7, 0, 2.95, { zone: Z });
  kit.box('blackMarble', 21.25, 2.6, 23.05, 2.7, 2.5, 2.95, { zone: Z });
  kit.box('gold', 21.55, 2.47, 22.15, 2.52, 0, 2.5, { zone: Z });
  kit.box('gold', 22.15, 2.47, 22.75, 2.52, 0, 2.5, { zone: Z });
  kit.box('night', 21.95, 2.7, 22.35, 2.71, 2.62, 2.82, { zone: Z, edges: false });
  kit.box('gold', 22.85, 2.7, 22.95, 2.72, 1.05, 1.3, { zone: Z, edges: false });
  lantern(kit, 20.95, 2.25, 2.8, { zone: Z });
  lantern(kit, 23.35, 2.25, 2.8, { zone: Z });
  for (const lx of [20.95, 23.35]) kit.box('gold', lx - 0.02, 2.6, lx + 0.02, 2.82, 2.1, 2.14, { zone: Z, edges: false });

  // powder room door, standing open
  kit.box('teak', 18.6, 1.65, 18.65, 2.5, 0, 2.65, { zone: Z });

  // a velvet bench against the tiled wall, by the powder room
  kit.box('velvet', 16.7, 2.75, 18.3, 3.2, 0.38, 0.5, { zone: Z });
  for (const [bx, bn] of [[16.78, 2.8], [18.22, 2.8], [16.78, 3.15], [18.22, 3.15]]) kit.geo('gold', at(new THREE.CylinderGeometry(0.025, 0.018, 0.38, 8), bx, 0.19, bn), { zone: Z, edges: false });

  // cornices: at the gallery lintel and under the high ceiling
  const cornice = (y, h, d) => {
    kit.box('plaster', 16.1, 2.6, 23.7, 2.6 + d, y, y + h, { zone: Z });
    kit.box('plaster', 23.7 - d, 2.6, 23.7, 14.7, y, y + h, { zone: Z });
    kit.box('plaster', 18.1, 14.7 - d, 23.7, 14.7, y, y + h, { zone: Z });
  };
  cornice(7.2, 0.2, 0.14);
  cornice(3.6, 0.1, 0.06);

  // plants
  pottedPalm(kit, 23.15, 7.35, { zone: Z, seed: 5, h: 2.4 });
  pottedPalm(kit, 18.75, 9.3, { zone: Z, seed: 9, h: 2.1 });

  // ---- the stair: black marble, a teak rail, and a brass jali between the flights ----------
  const R = 2.0 / 11, G = 0.28;
  for (let i = 0; i < 10; i++) {
    const top = (i + 1) * R;
    kit.box('blackMarble', 21.95, 9.9 + i * G, 23.7, 9.9 + (i + 1) * G + 0.02, top - R, top, { zone: Z });
  }
  kit.box('blackMarble', 20.1, 12.7, 23.7, 14.7, 1.82, 2.0, { zone: Z });
  for (let j = 0; j < 10; j++) {
    const top = 2.0 + (j + 1) * R;
    kit.box('blackMarble', 20.1, 12.7 - (j + 1) * G - 0.02, 21.85, 12.7 - j * G, top - R, top, { zone: Z });
  }
  // the underside of the upper flight, a sloping soffit
  {
    const s = new THREE.BufferGeometry();
    const y0 = 1.82, y1 = 3.82 - 0.2;
    const p = [20.1, y0, -12.7, 21.85, y0, -12.7, 21.85, y1, -9.9, 20.1, y0, -12.7, 21.85, y1, -9.9, 20.1, y1, -9.9];
    s.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    s.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(12).fill(0), 2));
    s.computeVertexNormals();
    kit.geo('plaster', s, { zone: Z, edges: false });
  }
  // jali screen between the flights
  {
    const g = new THREE.PlaneGeometry(2.8, 3.9);
    g.rotateY(Math.PI / 2);
    kit.geo('jali', at(g, 21.9, 1.95, 11.3), { zone: Z, edges: false });
    kit.line(Z, [[21.9, 0, -9.9], [21.9, 3.9, -9.9], [21.9, 3.9, -12.7], [21.9, 0, -12.7], [21.9, 0, -9.9]]);
    kit.box('gold', 21.87, 9.88, 21.93, 9.92, 0, 3.9, { zone: Z, edges: false });
    kit.box('gold', 21.87, 12.68, 21.93, 12.72, 0, 3.9, { zone: Z, edges: false });
  }
  // balustrades: teak rail on brass balusters
  const rail = (x0, n0, y0, x1, n1, y1) => {
    const a = new THREE.Vector3(x0, y0 + 0.95, -n0), b = new THREE.Vector3(x1, y1 + 0.95, -n1);
    const len = a.distanceTo(b);
    const g = new THREE.BoxGeometry(0.07, 0.06, len);
    g.lookAt(b.clone().sub(a));
    g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    kit.geo('teak', g, { zone: Z, angle: 40 });
    const count = Math.max(2, Math.round(len / 0.14));
    for (let i = 0; i <= count; i++) {
      const t = i / count;
      const x = x0 + (x1 - x0) * t, n = n0 + (n1 - n0) * t, y = y0 + (y1 - y0) * t;
      kit.geo('gold', at(new THREE.CylinderGeometry(0.012, 0.012, 0.92, 5), x, y + 0.47, n), { zone: Z, edges: false });
    }
    kit.line(Z, [[x0, y0 + 0.95, -n0], [x1, y1 + 0.95, -n1]]);
  };
  rail(20.15, 12.68, 2.0, 20.15, 9.9, 4.0);
  rail(18.1, 7.95, 4.0, 21.82, 7.95, 4.0);
  rail(21.82, 7.95, 4.0, 21.82, 9.9, 4.0);
  rail(20.15, 14.65, 2.0, 20.15, 12.68, 2.0);
  // a door to the first floor, in teak
  kit.box('teak', 17.78, 8.3, 17.82, 9.5, 4.0, 6.4, { zone: Z });

  // ---- outside: the portico and the approach --------------------------------------------
  const E = 'entry';
  for (const cn of [2.95, 7.55]) {
    kit.geo('render', at(new THREE.CylinderGeometry(0.24, 0.27, 3.9, 24), 28.0, 0.35 + 1.95, cn), { zone: E, angle: 40 });
    kit.box('render', 27.68, cn - 0.34, 28.32, cn + 0.34, 0, 0.35, { zone: E });
    kit.box('render', 27.68, cn - 0.34, 28.32, cn + 0.34, 4.25, 4.6, { zone: E });
    kit.geo('render', at(new THREE.TorusGeometry(0.27, 0.05, 8, 24).rotateX(Math.PI / 2), 28.0, 4.2, cn), { zone: E, angle: 40 });
  }
  // cheek walls of the steps, ending in round pedestals with finials
  for (const cn of [3.12, 7.38]) {
    kit.box('render', 28.0, cn - 0.16, 29.2, cn + 0.16, GROUND_Y, 0.25, { zone: E });
    kit.geo('render', at(new THREE.CylinderGeometry(0.32, 0.36, 0.95, 28), 29.4, GROUND_Y + 0.475, cn), { zone: E, angle: 40 });
    kit.geo('render', at(new THREE.SphereGeometry(0.22, 24, 16), 29.4, GROUND_Y + 1.15, cn), { zone: E, edges: false });
  }
  // the Dutch gable over the portico, with a round window
  {
    const W = 5.7, s = new THREE.Shape();
    s.moveTo(0, 0);
    s.lineTo(W, 0);
    s.lineTo(W, 0.5);
    s.bezierCurveTo(W - 0.2, 1.3, W - 1.25, 0.9, W - 1.35, 1.9);
    s.lineTo(W - 1.6, 2.1);
    s.bezierCurveTo(W - 1.7, 2.8, W - 2.0, 2.75, W - 2.05, 2.9);
    s.absarc(W / 2, 2.9, 0.8, 0, Math.PI, false);
    s.bezierCurveTo(2.0, 2.75, 1.7, 2.8, 1.6, 2.1);
    s.lineTo(1.35, 1.9);
    s.bezierCurveTo(1.25, 0.9, 0.2, 1.3, 0, 0.5);
    s.lineTo(0, 0);
    const hole = new THREE.Path();
    hole.absarc(W / 2, 1.75, 0.42, 0, Math.PI * 2, true);
    s.holes.push(hole);
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.35, bevelEnabled: false, curveSegments: 20 });
    const m = new THREE.Matrix4().set(0, 0, 1, 27.2, 0, 1, 0, 5.0, -1, 0, 0, -2.4, 0, 0, 0, 1);
    kit.geo('render', g.applyMatrix4(m), { zone: E, angle: 25 });
    kit.geo('night', at(new THREE.CircleGeometry(0.42, 32).rotateY(Math.PI / 2), 27.36, 6.75, 5.25), { zone: E, edges: false });
  }
  // lanterns: one hanging in the portico, two at the door
  lantern(kit, 25.8, 3.25, 5.25, { zone: E, scale: 1.3, hanging: 0.9 });
  lantern(kit, 24.22, 2.35, 3.75, { zone: E, scale: 0.9 });
  lantern(kit, 24.22, 2.35, 6.75, { zone: E, scale: 0.9 });
  for (const ln of [3.75, 6.75]) kit.box('gold', 24.0, ln - 0.02, 24.2, ln + 0.02, 2.2, 2.24, { zone: E, edges: false });
  // a name in brass, cut into the plinth by the steps
  // stepping stones to the gate
  for (let k = 0; k < 7; k++) {
    const x0 = 29.0 + k * 1.3;
    kit.box('paving', x0 + 0.6, 4.4, x0 + 1.6, 6.1, GROUND_Y, GROUND_Y + 0.05, { zone: k < 6 ? E : 'rest' });
  }
  // planting by the steps
  palm(kit, 30.4, 1.6, GROUND_Y, 6.4, { zone: E, seed: 2 });
  palm(kit, 31.2, 9.4, GROUND_Y, 7.4, { zone: E, seed: 6 });
  for (const [px, pn, sd] of [[29.6, 2.2, 11], [29.8, 8.4, 12], [26.0, 1.4, 13], [26.2, 9.1, 14]]) pottedPalm(kit, px, pn, { zone: E, seed: sd, h: 1.7, pot: 'clay' });

  // ---- the rest: drawn, not walked yet ---------------------------------------------------------
  for (const t of TREES) palm(kit, t.x, t.n, GROUND_Y, t.h, { zone: 'rest', seed: Math.round(t.x * 7 + t.n), len: t.r * 1.3 });
  kit.box('water', 2.5, 16.5, 13.5, 21.5, -1.5, -0.18, { zone: 'rest', edges: false });
  // inner doors, standing open
  for (const d of DOORS) {
    if (d.n === 2.5) continue;
    const a = (d.open * Math.PI) / 180;
    const ex = d.x + Math.cos(a) * d.w, en = d.n + Math.sin(a) * d.w;
    kit.box('teak', Math.min(d.x, ex) - (Math.abs(Math.cos(a)) < 0.5 ? 0.025 : 0), Math.min(d.n, en) - (Math.abs(Math.sin(a)) < 0.5 ? 0.025 : 0), Math.max(d.x, ex) + (Math.abs(Math.cos(a)) < 0.5 ? 0.025 : 0), Math.max(d.n, en) + (Math.abs(Math.sin(a)) < 0.5 ? 0.025 : 0), 0, 2.65);
  }

  return { shell, kit, leaves, chandelier: CH };
}
