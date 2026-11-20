// Villa Saanjh: the model. One building serves the plan, the rising walls and
// the walk. Plan (x east, n north) becomes three.js (x, y, -n).

import * as THREE from 'three';
import { BoxSolid, Part, boxEdges } from './solid.js';
import { ROOMS, ZONES, DOORS, FRONT_DOOR, TREES, GROUND_Y, POOL } from './plan.js';

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
  const N = 22;
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
  for (let i = 3; i < N; i++) {
    const p = pts[i], q = pts[i + 1];
    const t = i / N;
    // leaflets are longest mid-frond, short at the tip, and droop a little
    const L = width * 2.2 * Math.sin(Math.PI * Math.min(1, t * 1.05)) * (0.85 + 0.3 * rnd());
    const mid = p.clone().lerp(q, 0.55);
    for (const sgn of [-1, 1]) {
      const tip = p.clone().addScaledVector(side, sgn * L).add(new THREE.Vector3(0, -L * 0.45, 0)).addScaledVector(dir, L * 0.55);
      const w = mid.clone().addScaledVector(side, sgn * L * 0.5).add(new THREE.Vector3(0, -L * 0.2, 0)).addScaledVector(dir, L * 0.3);
      // two thin triangles: base to shoulder, shoulder to tip
      pos.push(p.x, p.y, p.z, mid.x, mid.y, mid.z, w.x, w.y, w.z);
      pos.push(p.x, p.y, p.z, w.x, w.y, w.z, tip.x, tip.y, tip.z);
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
    frond(kit, zone, top, dir, len * (0.75 + rnd() * 0.4), 0.5 + rnd() * 0.5, 1.1 + rnd() * 0.5, 0.26, rnd);
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
    frond(kit, zone, base, dir, h * (0.6 + rnd() * 0.25), 2.2 + rnd() * 0.6, 1.6 + rnd() * 0.4, 0.11, rnd);
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

// A crystal chandelier: gilt rings hung with strings of drops, a chain to the ceiling.
// `bottom` is the height of the lowest ring; `k` scales the whole fitting.
function chandelier(kit, zone, x, n, ceiling, bottom, k = 1) {
  const top = bottom + 0.85 * k;
  kit.geo('gold', at(new THREE.CylinderGeometry(0.012, 0.012, ceiling - top, 5), x, (ceiling + top) / 2, n), { zone, edges: false });
  kit.geo('gold', at(new THREE.CylinderGeometry(0.25 * k, 0.08 * k, 0.12, 16), x, ceiling - 0.06, n), { zone });
  const drop = new THREE.OctahedronGeometry(0.03 * k, 0);
  drop.scale(1, 1.8, 1);
  const tiers = [[0.78, 0, 34, 5], [0.58, 0.45, 26, 4], [0.38, 0.85, 18, 3]];
  for (const [r0, dy, count, len] of tiers) {
    const r = r0 * k, y = bottom + dy * k;
    const ring = new THREE.TorusGeometry(r, 0.02, 6, 48);
    ring.rotateX(Math.PI / 2);
    kit.geo('gold', at(ring, x, y, n), { zone });
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      for (let j = 0; j < len; j++) kit.geo('crystal', at(drop.clone(), x + Math.cos(a) * r, y - 0.07 * k - j * 0.085 * k, n + Math.sin(a) * r), { zone, edges: false });
    }
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      kit.line(zone, [[x + Math.cos(a) * r, y, -(n + Math.sin(a) * r)], [x, y + 0.25 * k, -n]]);
    }
  }
  kit.geo('lampGlass', at(new THREE.CylinderGeometry(0.16 * k, 0.2 * k, 0.8 * k, 16), x, bottom + 0.4 * k, n), { zone, edges: false });
}

// A dining chair in the Don Joao manner: navy velvet on a gilt frame with an
// arched, buttoned back. (cx, cn) is the seat centre; `face` turns it about y
// so that 0 faces north.
function chair(kit, zone, cx, cn, face, fabric = 'velvet', k = 1) {
  const parts = [];
  const g = (geo, mat, edges = true, angle = 40) => parts.push([geo, mat, edges, angle]);
  // seat
  g(new THREE.BoxGeometry(0.5, 0.09, 0.48).translate(0, 0.47, 0), fabric);
  g(new THREE.BoxGeometry(0.52, 0.05, 0.5).translate(0, 0.41, 0), 'gold');
  // legs, turned
  const L = [[0, 0], [0.025, 0], [0.018, 0.12], [0.028, 0.25], [0.02, 0.4], [0, 0.4]].map(([r, y]) => new THREE.Vector2(r, y));
  for (const [lx, lz] of [[-0.22, -0.2], [0.22, -0.2], [-0.22, 0.21], [0.22, 0.21]]) g(new THREE.LatheGeometry(L, 10).translate(lx, 0, lz), 'gold', true, 50);
  // back: an arched velvet panel in a gilt frame
  const s = new THREE.Shape();
  s.moveTo(-0.22, 0); s.lineTo(0.22, 0); s.lineTo(0.22, 0.42); s.absarc(0, 0.42, 0.22, 0, Math.PI, false); s.lineTo(-0.22, 0);
  g(new THREE.ExtrudeGeometry(s, { depth: 0.06, bevelEnabled: false, curveSegments: 16 }).translate(0, 0.52, 0.2), fabric, true, 30);
  const f = new THREE.Shape();
  f.moveTo(-0.25, 0); f.lineTo(0.25, 0); f.lineTo(0.25, 0.42); f.absarc(0, 0.42, 0.25, 0, Math.PI, false); f.lineTo(-0.25, 0);
  const hole = new THREE.Path();
  hole.moveTo(-0.215, 0.03); hole.lineTo(-0.215, 0.42); hole.absarc(0, 0.42, 0.215, Math.PI, 0, true); hole.lineTo(0.215, 0.03); hole.lineTo(-0.215, 0.03);
  f.holes.push(hole);
  g(new THREE.ExtrudeGeometry(f, { depth: 0.07, bevelEnabled: false, curveSegments: 16 }).translate(0, 0.5, 0.195), 'gold', true, 30);
  // the chair faces -z (north) at face = 0; its back is at +z
  const m = new THREE.Matrix4().makeScale(k, k, k).premultiply(new THREE.Matrix4().makeRotationY(face)).premultiply(new THREE.Matrix4().makeTranslation(cx, 0, -cn));
  for (const [geo, mat, edges, angle] of parts) kit.geo(mat, geo.applyMatrix4(m), { zone, edges, angle });
}

// A gathered curtain hanging from `top` to the floor, `width` wide, pleated.
// It hangs at plan (u, n) on a wall that runs east-west, extending in direction `dir` along x.
function curtain(kit, zone, u, n, dir, width, top, mat = 'drape', along = 'x') {
  const cols = 18, rows = 14, pos = [], idx = [], uv = [];
  for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) {
    const t = i / cols, v = j / rows;
    const a = u + dir * t * width;
    const off = n - 0.06 - 0.05 * Math.sin(t * Math.PI * 7) * (0.6 + 0.4 * v);
    // along 'x': the wall runs east-west at n; along 'n': it runs north-south at x = n (u is then an n value)
    if (along === 'x') pos.push(a, top * v, -off);
    else pos.push(n + 0.06 + 0.05 * Math.sin(t * Math.PI * 7) * (0.6 + 0.4 * v), top * v, -a);
    uv.push(t * width * 3, v * top);
  }
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const a = j * (cols + 1) + i, b = a + 1, c = a + cols + 1, d = c + 1;
    idx.push(a, b, d, a, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  kit.geo(mat, g, { zone, edges: false });
  if (along === 'x') {
    kit.line(zone, [[u, 0.01, -(n - 0.06)], [u, top, -(n - 0.06)]]);
    kit.line(zone, [[u + dir * width, 0.01, -(n - 0.06)], [u + dir * width, top, -(n - 0.06)]]);
  } else {
    kit.line(zone, [[n + 0.06, 0.01, -u], [n + 0.06, top, -u]]);
    kit.line(zone, [[n + 0.06, 0.01, -(u + dir * width)], [n + 0.06, top, -(u + dir * width)]]);
  }
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
  C(POOL.x0, POOL.n0, POOL.x1, POOL.n1, POOL.floor, 0); // the pool: 11 x 5 m, 1.3 m of water
  A(2.2, 21.7, 13.8, 22.15, 0, 2.4); // a mosaic wall at the far end, with three spouts
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
  // the first floor is hollow, so a rising cut shows its walls, not a black block
  C(0.3, 0.3, 23.7, 14.7, 4.3, 7.6);
  A(15.9, 0.3, 16.1, 8.1, 4.3, 7.6); // first-floor walls around the double-height void
  A(15.9, 7.9, 18.1, 8.1, 4.3, 7.6);
  A(17.9, 7.9, 18.1, 14.7, 4.3, 7.6);
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
    if (glass === 'open') glass = false; // a door standing open: no glass in it
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
  arch('x', 14.7, 15.0, 13.35, 15.15, 2.45, 0, 'open', 'render'); // dining: French doors to the terrace, one standing open
  arch('x', 14.7, 15.0, 15.35, 17.15, 2.45, 0, true, 'render');
  arch('x', 14.7, 15.0, 1.2, 3.8, 2.2, 0, true, 'render'); // master: a window, and French doors standing open to the terrace
  arch('x', 14.7, 15.0, 5.0, 7.6, 2.2, 0, 'open', 'render');
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
    const basin = x > POOL.x0 - 0.01 && x < POOL.x1 + 0.01 && n > POOL.n0 - 0.01 && n < POOL.n1 + 0.01 && y < 0.001;
    const poolWall = x > 2.19 && x < 13.81 && n > 21.69 && n < 22.16 && y > -0.01 && y < 2.41;
    if (basin) return 'mosaic';
    if (poolWall && ny > 0) return 'paving';
    if (poolWall && nz > 0) return 'mosaic';
    if (ny > 0) {
      if (y > 7.8) return 'roof';
      if (Math.abs(y) < 0.01 && HOUSE(x, n)) {
        if (inRoom('foyer', x, n) || inRoom('stair', x, n) || inRoom('dining', x, n)) return 'cement';
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
  // bucket the skin by zone too, so each walked zone gets its own lightmap atlas
  const shell = S.build((c, nrm) => zoneOf(c[0] + nrm[0] * 0.05, c[1] + nrm[1] * 0.05, -c[2] + nrm[2] * 0.05) + '|' + faceMat(c, nrm), edgeTag);

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

  // chandelier over the round table
  const CH = { x: 19.9, n: 5.25 };
  chandelier(kit, Z, CH.x, CH.n, 7.4, 3.6, 1);

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

  // (a pair of damask chairs stands here: see models.js)

  // cornices: at the gallery lintel and under the high ceiling
  const cornice = (y, h, d) => {
    kit.box('plaster', 16.1, 2.6, 23.7, 2.6 + d, y, y + h, { zone: Z });
    kit.box('plaster', 23.7 - d, 2.6, 23.7, 14.7, y, y + h, { zone: Z });
    kit.box('plaster', 18.1, 14.7 - d, 23.7, 14.7, y, y + h, { zone: Z });
  };
  cornice(7.2, 0.2, 0.14);
  cornice(3.6, 0.1, 0.06);

  // plants
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
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2.8, uv.getY(i) * 3.9); // UVs in metres, like everything else
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


  // ---- the dining room -----------------------------------------------------------------
  const D = 'dining';
  // floor: the same cement tile, inside a navy border and a white marble surround
  {
    const x0 = 12.6, x1 = 17.9, n0 = 8.1, n1 = 14.7;
    const band = (a0, b0, a1, b1, w, mat, y) => {
      kit.box(mat, a0, b0, a1, b0 + w, 0, y, { zone: D, edges: false });
      kit.box(mat, a0, b1 - w, a1, b1, 0, y, { zone: D, edges: false });
      kit.box(mat, a0, b0 + w, a0 + w, b1 - w, 0, y, { zone: D, edges: false });
      kit.box(mat, a1 - w, b0 + w, a1, b1 - w, 0, y, { zone: D, edges: false });
      kit.line(D, [[a0 + w, y, -(b0 + w)], [a1 - w, y, -(b0 + w)], [a1 - w, y, -(b1 - w)], [a0 + w, y, -(b1 - w)], [a0 + w, y, -(b0 + w)]]);
    };
    band(x0, n0, x1, n1, 0.4, 'marbleWhite', 0.004);
    band(x0 + 0.4, n0 + 0.4, x1 - 0.4, n1 - 0.4, 0.12, 'navy', 0.005);
  }
  // panelled walls: gilt mouldings in rectangles, a dado rail and a cornice
  const frameOn = (axis, at0, u0, u1, y0, y1, out, Zf = D) => {
    const t = 0.03, d = 0.025;
    const B = (a0, b0, a1, b1, ya, yb) => kit.box('gold', a0, b0, a1, b1, ya, yb, { zone: Zf, edges: false });
    if (axis === 'x') { // wall facing along n, at n = at0, room side `out`
      const n0 = out > 0 ? at0 : at0 - d, n1 = out > 0 ? at0 + d : at0;
      B(u0, n0, u1, n1, y0, y0 + t); B(u0, n0, u1, n1, y1 - t, y1);
      B(u0, n0, u0 + t, n1, y0, y1); B(u1 - t, n0, u1, n1, y0, y1);
      kit.line(Zf, [[u0, y0, -n1], [u1, y0, -n1], [u1, y1, -n1], [u0, y1, -n1], [u0, y0, -n1]].map((p) => (out > 0 ? p : [p[0], p[1], -n0])));
    } else { // wall facing along x, at x = at0
      const x0 = out > 0 ? at0 : at0 - d, x1 = out > 0 ? at0 + d : at0;
      B(x0, u0, x1, u1, y0, y0 + t); B(x0, u0, x1, u1, y1 - t, y1);
      B(x0, u0, x1, u0 + t, y0, y1); B(x0, u1 - t, x1, u1, y0, y1);
      const xf = out > 0 ? x1 : x0;
      kit.line(Zf, [[xf, y0, -u0], [xf, y0, -u1], [xf, y1, -u1], [xf, y1, -u0], [xf, y0, -u0]]);
    }
  };
  // west wall (x = 12.6, facing east): three tall panels behind the sideboard
  for (const [u0, u1] of [[8.6, 10.2], [10.55, 12.25], [12.6, 14.2]]) {
    frameOn('n', 12.6, u0, u1, 0.25, 0.85, 1);
    frameOn('n', 12.6, u0, u1, 1.05, 3.25, 1);
  }
  kit.box('plaster', 12.6, 8.1, 12.68, 14.7, 0.9, 0.98, { zone: D });
  kit.box('plaster', 12.6, 8.1, 17.9, 8.22, 3.4, 3.6, { zone: D });
  kit.box('plaster', 12.6, 14.58, 17.9, 14.7, 3.4, 3.6, { zone: D });
  kit.box('plaster', 12.6, 8.1, 12.72, 14.7, 3.4, 3.6, { zone: D });
  kit.box('plaster', 17.78, 8.1, 17.9, 14.7, 3.4, 3.6, { zone: D });

  // sideboard against the west wall, with an arched gilt mirror above
  kit.box('teak', 12.62, 10.3, 13.1, 12.5, 0.12, 0.88, { zone: D });
  kit.box('marbleWhite', 12.6, 10.25, 13.14, 12.55, 0.88, 0.92, { zone: D });
  for (const [u0, u1] of [[10.4, 11.05], [11.1, 11.75], [11.8, 12.4]]) kit.box('teak', 13.1, u0, 13.13, u1, 0.2, 0.8, { zone: D });
  for (const u of [10.72, 11.42, 12.1]) kit.geo('gold', at(new THREE.SphereGeometry(0.018, 8, 6), 13.15, 0.66, u), { zone: D, edges: false });
  for (const [u, side] of [[10.35, 0], [12.45, 1]]) kit.geo('gold', at(new THREE.CylinderGeometry(0.03, 0.02, 0.12, 8), 12.85, 0.06, u), { zone: D, edges: false });
  kit.geo('mirror', archPane(10.55, 12.25, 1.25, 2.55, 'n', 12.64).applyMatrix4(new THREE.Matrix4().makeTranslation(0.02, 0, 0)), { zone: D });
  kit.geo('gold', archFill(10.45, 12.35, 2.55, 2.55 + 0.95 + 0.01, 'n', 12.6, 12.68).applyMatrix4(new THREE.Matrix4().makeScale(1, 1, 1)), { zone: D, edges: false });
  for (const [u0, u1] of [[10.45, 10.55], [12.25, 12.35]]) kit.box('gold', 12.6, u0, 12.68, u1, 1.2, 2.55, { zone: D, edges: false });
  kit.box('gold', 12.6, 10.45, 12.68, 12.35, 1.17, 1.25, { zone: D, edges: false });
  lantern(kit, 12.95, 1.12, 10.7, { zone: D, scale: 0.6 });
  lantern(kit, 12.95, 1.12, 12.1, { zone: D, scale: 0.6 });
  kit.geo('porcelain', at(new THREE.LatheGeometry([[0, 0], [0.09, 0], [0.15, 0.1], [0.14, 0.3], [0.06, 0.42], [0.08, 0.46], [0, 0.46]].map(([r, y]) => new THREE.Vector2(r, y)), 24), 12.88, 0.92, 11.4), { zone: D, angle: 40 });

  // the table: teak top on four carved gilt legs, for eight
  const TX = 15.25, TN0 = 10.15, TN1 = 12.75, TW = 1.1;
  kit.box('teak', TX - TW / 2, TN0, TX + TW / 2, TN1, 0.72, 0.77, { zone: D });
  kit.box('teak', TX - TW / 2 + 0.06, TN0 + 0.06, TX + TW / 2 - 0.06, TN1 - 0.06, 0.64, 0.72, { zone: D });
  const leg = [[0, 0], [0.06, 0], [0.045, 0.08], [0.035, 0.25], [0.06, 0.38], [0.035, 0.5], [0.05, 0.64], [0, 0.64]].map(([r, y]) => new THREE.Vector2(r, y));
  for (const [lx, ln] of [[TX - TW / 2 + 0.1, TN0 + 0.1], [TX + TW / 2 - 0.1, TN0 + 0.1], [TX - TW / 2 + 0.1, TN1 - 0.1], [TX + TW / 2 - 0.1, TN1 - 0.1]]) {
    kit.geo('gold', at(new THREE.LatheGeometry(leg, 16), lx, 0, ln), { zone: D, angle: 45 });
  }
  // a table runner, a low arrangement, candlesticks and eight place settings
  kit.box('velvet', TX - 0.22, TN0 + 0.15, TX + 0.22, TN1 - 0.15, 0.77, 0.775, { zone: D, edges: false });
  {
    const rnd = seeded(77);
    const ball = new THREE.IcosahedronGeometry(1, 1);
    for (let k = 0; k < 160; k++) {
      const a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd());
      const px = TX + Math.cos(a) * rr * 0.16, pn = (TN0 + TN1) / 2 + Math.sin(a) * rr * 0.42, py = 0.86 + (1 - rr) * 0.1 + rnd() * 0.04;
      const r = 0.02 + rnd() * 0.018;
      const c = rnd();
      kit.geo(c < 0.5 ? 'flowerWhite' : c < 0.85 ? 'flowerPink' : 'flowerPlum', at(ball.clone().scale(r, r * 0.8, r), px, py, pn), { zone: D, edges: false });
    }
    kit.geo('porcelain', at(new THREE.CylinderGeometry(0.2, 0.16, 0.09, 24).scale(1, 1, 2.4), TX, 0.82, (TN0 + TN1) / 2), { zone: D, angle: 40 });
  }
  for (const dn of [-0.75, 0.75]) {
    const stick = new THREE.LatheGeometry([[0, 0], [0.06, 0], [0.04, 0.03], [0.015, 0.08], [0.025, 0.2], [0.012, 0.3], [0.03, 0.33], [0, 0.33]].map(([r, y]) => new THREE.Vector2(r, y)), 12);
    kit.geo('gold', at(stick, TX, 0.775, (TN0 + TN1) / 2 + dn), { zone: D, angle: 50 });
    kit.geo('porcelain', at(new THREE.CylinderGeometry(0.011, 0.011, 0.2, 8), TX, 1.2, (TN0 + TN1) / 2 + dn), { zone: D, edges: false });
  }
  const seats = [];
  for (const sn of [10.75, 11.45, 12.15]) {
    seats.push([TX - TW / 2 - 0.32, sn, -Math.PI / 2]);
    seats.push([TX + TW / 2 + 0.32, sn, Math.PI / 2]);
  }
  seats.push([TX, TN0 - 0.38, 0]);
  seats.push([TX, TN1 + 0.38, Math.PI]);
  for (const [cx, cn, face] of seats) {
    chair(kit, D, cx, cn, face);
    // the place setting on the table in front of the chair
    const px = cx + Math.sin(-face) * 0.0 + (face === -Math.PI / 2 ? 0.42 : face === Math.PI / 2 ? -0.42 : 0);
    const pn = cn + (face === 0 ? 0.48 : face === Math.PI ? -0.48 : 0);
    kit.geo('porcelain', at(new THREE.CylinderGeometry(0.14, 0.12, 0.018, 32), px, 0.779, pn), { zone: D, edges: false });
    kit.geo('ceramic', at(new THREE.CylinderGeometry(0.1, 0.085, 0.022, 32), px, 0.795, pn), { zone: D, edges: false });
    kit.geo('gold', at(new THREE.TorusGeometry(0.14, 0.004, 4, 32).rotateX(Math.PI / 2), px, 0.789, pn), { zone: D, edges: false });
    const glass = new THREE.LatheGeometry([[0, 0], [0.035, 0], [0.006, 0.01], [0.005, 0.09], [0.04, 0.13], [0.038, 0.2], [0.036, 0.2]].map(([r, y]) => new THREE.Vector2(r, y)), 16);
    const gx = px + (face === -Math.PI / 2 ? 0.0 : face === Math.PI / 2 ? 0.0 : 0.17);
    const gn = pn + (face === -Math.PI / 2 ? 0.17 : face === Math.PI / 2 ? -0.17 : 0);
    kit.geo('crystal', at(glass, gx, 0.775, gn), { zone: D, edges: false });
  }
  chandelier(kit, D, TX, (TN0 + TN1) / 2, 3.6, 2.5, 0.62);

  // curtains: navy velvet, gathered either side of each French door
  for (const [c0, c1] of [[13.35, 15.15], [15.35, 17.15]]) {
    // curtains on the outer sides only, so nothing hangs across a door
    for (const [u, dir] of c0 < 14 ? [[c0 - 0.05, -1]] : [[c1 + 0.05, 1]]) curtain(kit, D, u, 14.62, dir, 0.45, 3.35);
    kit.geo('gold', at(new THREE.CylinderGeometry(0.018, 0.018, c1 - c0 + 1.1, 8).rotateZ(Math.PI / 2), (c0 + c1) / 2, 3.38, 14.6), { zone: D, edges: false });
  }
  for (const [hx, dir] of [[13.35, 1], [15.15, -1]]) kit.box('teak', hx - (dir > 0 ? 0 : 0.05), 14.75, hx + (dir > 0 ? 0.05 : 0), 15.6, 0, 2.4, { zone: D });
  // two palms in the corners, by the doors
  pottedPalm(kit, 12.95, 13.2, { zone: D, seed: 21, h: 2.0 });


  // ---- the master bedroom -----------------------------------------------------------------
  const MB = 'master';
  // a big wool rug under the bed, with a navy border
  kit.box('rug', 2.4, 8.7, 7.2, 12.9, 0, 0.012, { zone: MB });
  kit.box('navy', 2.55, 8.85, 7.05, 12.75, 0.012, 0.014, { zone: MB, edges: false });
  kit.box('rug', 2.7, 9.0, 6.9, 12.6, 0.012, 0.016, { zone: MB, edges: false });
  // gilt panels on the walls, a dado rail and a cornice
  for (const [u0, u1] of [[0.7, 2.6], [7.0, 8.2]]) frameOn('x', 8.1, u0, u1, 0.3, 3.2, 1, MB);
  frameOn('x', 8.1, 2.9, 6.7, 2.55, 3.25, 1, MB);
  for (const [u0, u1] of [[9.0, 9.9], [13.6, 14.4]]) frameOn('n', 0.3, u0, u1, 0.3, 3.2, 1, MB);
  for (const [u0, u1] of [[8.4, 8.9], [10.2, 10.8], [13.3, 14.4]]) frameOn('n', 9.9, u0, u1, 0.3, 3.2, -1, MB);
  kit.box('plaster', 0.3, 8.1, 9.9, 8.22, 3.4, 3.6, { zone: MB });
  kit.box('plaster', 0.3, 14.58, 9.9, 14.7, 3.4, 3.6, { zone: MB });
  kit.box('plaster', 0.3, 8.1, 0.42, 14.7, 3.4, 3.6, { zone: MB });
  kit.box('plaster', 9.78, 8.1, 9.9, 14.7, 3.4, 3.6, { zone: MB });

  // the bed: tufted green velvet headboard in a carved gilt frame, white linen, a bench at the foot
  const BX = 4.8, BN0 = 8.2, BL = 2.25, BWD = 2.0;
  {
    const hs = new THREE.Shape();
    hs.moveTo(-1.15, 0); hs.lineTo(1.15, 0); hs.lineTo(1.15, 1.05);
    hs.bezierCurveTo(1.0, 1.25, 0.45, 1.2, 0.3, 1.38);
    hs.absarc(0, 1.38, 0.3, 0, Math.PI, false);
    hs.bezierCurveTo(-0.45, 1.2, -1.0, 1.25, -1.15, 1.05);
    hs.lineTo(-1.15, 0);
    const panel = new THREE.ExtrudeGeometry(hs, { depth: 0.1, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 2, curveSegments: 18 });
    panel.translate(0, 0.55, 0);
    panel.applyMatrix4(new THREE.Matrix4().makeTranslation(BX, 0, -(BN0 + 0.02)).multiply(new THREE.Matrix4().makeRotationY(Math.PI)));
    kit.geo('velvetGreen', panel, { zone: MB, angle: 30 });
    const fr = new THREE.Shape();
    fr.moveTo(-1.27, 0); fr.lineTo(1.27, 0); fr.lineTo(1.27, 1.12);
    fr.bezierCurveTo(1.1, 1.36, 0.5, 1.3, 0.38, 1.46);
    fr.absarc(0, 1.46, 0.38, 0, Math.PI, false);
    fr.bezierCurveTo(-0.5, 1.3, -1.1, 1.36, -1.27, 1.12);
    fr.lineTo(-1.27, 0);
    fr.holes.push(new THREE.Path(hs.getPoints(18).map((p) => new THREE.Vector2(p.x * 0.97, p.y * 0.97 + 0.02)).reverse()));
    const frame = new THREE.ExtrudeGeometry(fr, { depth: 0.08, bevelEnabled: false, curveSegments: 18 });
    frame.translate(0, 0.5, 0);
    frame.applyMatrix4(new THREE.Matrix4().makeTranslation(BX, 0, -(BN0 + 0.0)).multiply(new THREE.Matrix4().makeRotationY(Math.PI)));
    kit.geo('gold', frame, { zone: MB, angle: 30 });
    // buttons on the headboard
    for (let r = 0; r < 4; r++) for (let c = -4; c <= 4; c++) {
      if ((r + c) % 2) continue;
      kit.geo('gold', at(new THREE.SphereGeometry(0.018, 6, 4), BX + c * 0.24, 0.85 + r * 0.24, BN0 + 0.15), { zone: MB, edges: false });
    }
  }
  kit.box('velvetGreen', BX - BWD / 2, BN0 + 0.1, BX + BWD / 2, BN0 + BL, 0.12, 0.42, { zone: MB });
  kit.box('linen', BX - BWD / 2 + 0.03, BN0 + 0.12, BX + BWD / 2 - 0.03, BN0 + BL - 0.02, 0.42, 0.62, { zone: MB });
  kit.box('linen', BX - BWD / 2 - 0.02, BN0 + 0.75, BX + BWD / 2 + 0.02, BN0 + BL + 0.03, 0.55, 0.68, { zone: MB });
  kit.box('velvetGreen', BX - BWD / 2 - 0.03, BN0 + BL - 0.55, BX + BWD / 2 + 0.03, BN0 + BL + 0.04, 0.6, 0.7, { zone: MB });
  for (const px of [-0.5, 0.5]) {
    const pil = new THREE.SphereGeometry(1, 20, 12).scale(0.36, 0.11, 0.2);
    kit.geo('linen', at(pil, BX + px, 0.76, BN0 + 0.45), { zone: MB, edges: false });
    kit.geo('velvetGreen', at(new THREE.SphereGeometry(1, 16, 10).scale(0.22, 0.12, 0.08), BX + px * 0.75, 0.85, BN0 + 0.68), { zone: MB, edges: false });
  }
  for (const [lx, ln] of [[BX - BWD / 2 + 0.05, BN0 + BL - 0.05], [BX + BWD / 2 - 0.05, BN0 + BL - 0.05]]) kit.geo('gold', at(new THREE.CylinderGeometry(0.04, 0.03, 0.12, 10), lx, 0.06, ln), { zone: MB, edges: false });
  // the bench at the foot
  kit.box('velvetGreen', BX - 0.8, BN0 + BL + 0.25, BX + 0.8, BN0 + BL + 0.7, 0.38, 0.5, { zone: MB });
  for (const [lx, ln] of [[-0.72, 0.3], [0.72, 0.3], [-0.72, 0.65], [0.72, 0.65]]) kit.geo('gold', at(new THREE.CylinderGeometry(0.025, 0.018, 0.38, 8), BX + lx, 0.19, BN0 + BL + ln), { zone: MB, edges: false });
  // nightstands and lamps
  for (const sx of [-1, 1]) {
    const nx = BX + sx * (BWD / 2 + 0.38);
    kit.box('teak', nx - 0.28, BN0 + 0.05, nx + 0.28, BN0 + 0.5, 0.1, 0.62, { zone: MB });
    kit.box('marbleWhite', nx - 0.3, BN0 + 0.04, nx + 0.3, BN0 + 0.52, 0.62, 0.65, { zone: MB });
    kit.box('gold', nx - 0.08, BN0 + 0.5, nx + 0.08, BN0 + 0.52, 0.42, 0.44, { zone: MB, edges: false });
    kit.geo('porcelain', at(new THREE.LatheGeometry([[0, 0], [0.09, 0], [0.12, 0.08], [0.1, 0.22], [0.03, 0.3], [0.025, 0.42], [0, 0.42]].map(([r, y]) => new THREE.Vector2(r, y)), 20), nx, 0.65, BN0 + 0.28), { zone: MB, angle: 40 });
    kit.geo('shade', at(new THREE.CylinderGeometry(0.13, 0.2, 0.26, 24, 1, true), nx, 1.18, BN0 + 0.28), { zone: MB, angle: 40 });
  }
  chandelier(kit, MB, 5.1, 11.6, 3.6, 2.55, 0.7);

  // by the west window: two armchairs and a small round table
  // (two peacock-velvet armchairs stand here: see models.js)
  kit.geo('gold', at(new THREE.LatheGeometry([[0, 0], [0.22, 0], [0.06, 0.06], [0.04, 0.5], [0.12, 0.56], [0, 0.56]].map(([r, y]) => new THREE.Vector2(r, y)), 16), 1.05, 0, 11.65), { zone: MB, angle: 45 });
  kit.geo('marbleWhite', at(new THREE.CylinderGeometry(0.32, 0.32, 0.04, 32), 1.05, 0.58, 11.65), { zone: MB });
  kit.geo('porcelain', at(new THREE.LatheGeometry([[0, 0], [0.05, 0], [0.08, 0.08], [0.04, 0.2], [0.05, 0.24], [0, 0.24]].map(([r, y]) => new THREE.Vector2(r, y)), 16), 1.05, 0.6, 11.65), { zone: MB, angle: 40 });

  // east wall: a dresser under an arched gilt mirror
  kit.box('teak', 9.35, 11.0, 9.9, 13.0, 0.12, 0.85, { zone: MB });
  kit.box('marbleWhite', 9.32, 10.95, 9.9, 13.05, 0.85, 0.89, { zone: MB });
  for (const [u0, u1] of [[11.1, 11.95], [12.05, 12.9]]) for (const [ya, yb] of [[0.18, 0.5], [0.52, 0.82]]) kit.box('teak', 9.32, u0, 9.35, u1, ya, yb, { zone: MB });
  kit.geo('mirror', archPane(11.25, 12.75, 1.2, 2.45, 'n', 9.86).applyMatrix4(new THREE.Matrix4().makeRotationY(Math.PI).premultiply(new THREE.Matrix4().makeTranslation(2 * 9.86, 0, -2 * 12.0))), { zone: MB });
  kit.box('gold', 9.82, 11.15, 9.9, 11.25, 1.15, 2.45, { zone: MB, edges: false });
  kit.box('gold', 9.82, 12.75, 9.9, 12.85, 1.15, 2.45, { zone: MB, edges: false });
  kit.box('gold', 9.82, 11.15, 9.9, 12.85, 1.12, 1.2, { zone: MB, edges: false });
  lantern(kit, 9.6, 1.12, 11.25, { zone: MB, scale: 0.6 });
  lantern(kit, 9.6, 1.12, 12.75, { zone: MB, scale: 0.6 });

  // curtains: deep red velvet beside each window
  for (const [c0, c1] of [[1.2, 3.8], [5.0, 7.6]]) {
    curtain(kit, MB, c0 - 0.05, 14.62, -1, 0.42, 3.35, 'drapeRed');
    curtain(kit, MB, c1 + 0.05, 14.62, 1, 0.42, 3.35, 'drapeRed');
  }
  curtain(kit, MB, 9.35, 0.3, -1, 0.5, 3.35, 'drapeRed', 'n');
  curtain(kit, MB, 13.45, 0.3, 1, 0.5, 3.35, 'drapeRed', 'n');
  for (const [hx, dir] of [[5.0, 1], [7.6, -1]]) kit.box('teak', hx - (dir > 0 ? 0 : 0.05), 14.75, hx + (dir > 0 ? 0.05 : 0), 16.0, 0, 2.3, { zone: 'pool' });

  pottedPalm(kit, 0.85, 8.7, { zone: MB, seed: 52, h: 2.0 });

  // ---- the gallery -----------------------------------------------------------------------
  const Gz = 'gallery';
  // a cement-tile runner with a navy edge down the middle of the white marble
  kit.box('cement', 8.7, 5.85, 15.9, 7.15, 0, 0.004, { zone: Gz, edges: false });
  for (const [a0, b0, a1, b1] of [[8.6, 5.75, 16.0, 5.85], [8.6, 7.15, 16.0, 7.25], [8.6, 5.85, 8.7, 7.15]]) kit.box('navy', a0, b0, a1, b1, 0, 0.005, { zone: Gz, edges: false });
  kit.line(Gz, [[16.0, 0.005, -5.75], [8.6, 0.005, -5.75], [8.6, 0.005, -7.25], [16.0, 0.005, -7.25]]);
  // north wall: a large painting in a gilt frame between two lanterns
  {
    const g = new THREE.PlaneGeometry(2.4, 1.5);
    kit.geo('art', at(g, 11.5, 1.85, 7.86), { zone: Gz, edges: false });
    for (const [a0, a1, ya, yb] of [[10.22, 12.78, 1.03, 1.1], [10.22, 12.78, 2.6, 2.67], [10.22, 10.3, 1.03, 2.67], [12.7, 12.78, 1.03, 2.67]]) kit.box('gold', a0, 7.83, a1, 7.9, ya, yb, { zone: Gz });
    for (const lx of [9.95, 13.05]) {
      lantern(kit, lx, 2.1, 7.72, { zone: Gz, scale: 0.8 });
      kit.box('gold', lx - 0.02, 7.72, lx + 0.02, 7.9, 1.98, 2.02, { zone: Gz, edges: false });
    }
  }
  // south wall: a brass jali niche over black marble, and a console under an arched mirror
  kit.box('blackMarble', 13.85, 5.1, 15.75, 5.13, 0.12, 2.95, { zone: Gz });
  kit.geo('jali', archPane(13.95, 15.65, 0.2, 2.0, 'x', 5.16), { zone: Gz, edges: false });
  kit.geo('gold', archFill(13.85, 15.75, 2.0, 2.95, 'x', 5.1, 5.17), { zone: Gz, edges: false });
  kit.line(Gz, [[13.95, 0.2, -5.16], [13.95, 2.0, -5.16]]);
  kit.line(Gz, [[15.65, 0.2, -5.16], [15.65, 2.0, -5.16]]);
  kit.geo('mirror', archPane(10.6, 12.0, 1.25, 2.35, 'x', 5.13), { zone: Gz });
  kit.geo('gold', archFill(10.5, 12.1, 2.35, 3.16, 'x', 5.1, 5.15), { zone: Gz, edges: false });
  kit.box('gold', 10.5, 5.1, 10.6, 5.15, 1.2, 2.35, { zone: Gz, edges: false });
  kit.box('gold', 12.0, 5.1, 12.1, 5.15, 1.2, 2.35, { zone: Gz, edges: false });
  kit.box('marbleWhite', 10.45, 5.1, 12.15, 5.52, 0.86, 0.9, { zone: Gz });
  for (const lx of [10.6, 12.0]) kit.geo('gold', at(new THREE.LatheGeometry([[0, 0], [0.04, 0], [0.025, 0.25], [0.04, 0.5], [0.02, 0.86], [0, 0.86]].map(([r, y]) => new THREE.Vector2(r, y)), 10), lx, 0, 5.4), { zone: Gz, angle: 50 });
  kit.geo('porcelain', at(new THREE.LatheGeometry([[0, 0], [0.08, 0], [0.13, 0.12], [0.12, 0.3], [0.05, 0.4], [0.07, 0.44], [0, 0.44]].map(([r, y]) => new THREE.Vector2(r, y)), 24), 11.3, 0.9, 5.32), { zone: Gz, angle: 40 });
  // three lanterns hung from the ceiling, and a palm in the far corner
  for (const lx of [10.2, 12.45, 14.7]) lantern(kit, lx, 2.55, 6.5, { zone: Gz, scale: 1.0, hanging: 0.63 });


  // ---- the terrace and the pool --------------------------------------------------------
  const PZ = 'pool';
  {
    // the water: a surface you can see through to the mosaic
    const w = new THREE.PlaneGeometry(POOL.x1 - POOL.x0, POOL.n1 - POOL.n0);
    const uv = w.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (POOL.x1 - POOL.x0), uv.getY(i) * (POOL.n1 - POOL.n0));
    w.rotateX(-Math.PI / 2);
    kit.geo('water', at(w, (POOL.x0 + POOL.x1) / 2, POOL.water, (POOL.n0 + POOL.n1) / 2), { zone: PZ, edges: false });
    // three bronze spouts in the far wall, each pouring a curved sheet of water
    for (const sx of [4.7, 8.0, 11.3]) {
      kit.box('gold', sx - 0.13, 21.3, sx + 0.13, 21.7, 1.48, 1.56, { zone: PZ });
      kit.box('gold', sx - 0.16, 21.62, sx + 0.16, 21.7, 1.42, 1.62, { zone: PZ, edges: false });
      const rows = 16, pos = [], idx = [], uvs = [];
      for (let j = 0; j <= rows; j++) {
        const t = j / rows;
        const n = 21.32 - 0.95 * t, y = 1.52 - (1.52 - POOL.water) * t * t, half = 0.11 + 0.07 * t;
        pos.push(sx - half, y, -n, sx + half, y, -n);
        uvs.push(0, t, 1, t);
      }
      for (let j = 0; j < rows; j++) idx.push(2 * j, 2 * j + 1, 2 * j + 3, 2 * j, 2 * j + 3, 2 * j + 2);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      kit.geo('cascade', g, { zone: PZ, edges: false });
      kit.line(PZ, Array.from({ length: rows + 1 }, (_, j) => { const t = j / rows; return [sx, 1.52 - (1.52 - POOL.water) * t * t, -(21.32 - 0.95 * t)]; }));
      // where it lands: a ring of foam
      kit.geo('cascade', at(new THREE.RingGeometry(0.08, 0.3, 24).rotateX(-Math.PI / 2), sx, POOL.water + 0.01, 20.37), { zone: PZ, edges: false });
    }
  }
  // two teak loungers and a navy umbrella on the east deck
  for (const lx of [14.35, 15.25]) {
    kit.box('teak', lx, 17.0, lx + 0.66, 18.7, 0.22, 0.3, { zone: PZ });
    for (const [a, b] of [[lx + 0.03, 17.05], [lx + 0.57, 17.05], [lx + 0.03, 18.6], [lx + 0.57, 18.6]]) kit.box('teak', a, b, a + 0.06, b + 0.06, 0, 0.22, { zone: PZ, edges: false });
    kit.box('linen', lx + 0.04, 17.04, lx + 0.62, 18.6, 0.3, 0.38, { zone: PZ });
    const back = new THREE.BoxGeometry(0.58, 0.07, 0.75);
    back.translate(0, 0, -0.375);
    back.rotateX(0.75);
    kit.geo('linen', at(back, lx + 0.33, 0.36, 18.62), { zone: PZ });
  }
  kit.geo('teak', at(new THREE.CylinderGeometry(0.03, 0.03, 2.5, 8), 15.15, 1.25, 19.6), { zone: PZ, edges: false });
  {
    const c = new THREE.ConeGeometry(1.5, 0.45, 8, 1, true);
    kit.geo('umbrella', at(c, 15.15, 2.4, 19.6), { zone: PZ, angle: 20 });
  }
  // planting on the terrace, and lanterns on the house wall
  palm(kit, 0.9, 22.7, 0, 6.2, { zone: PZ, seed: 41, len: 2.8 });
  palm(kit, 15.0, 22.6, 0, 6.8, { zone: PZ, seed: 43, len: 3.0 });
  for (const [px, pn, sd] of [[1.0, 15.7, 45], [11.2, 15.7, 46], [2.4, 22.9, 47], [13.6, 22.9, 48]]) pottedPalm(kit, px, pn, { zone: PZ, seed: sd, h: 1.8, pot: 'clay' });
  for (const lx of [13.25, 15.25, 17.25]) {
    lantern(kit, lx, 2.35, 15.22, { zone: PZ, scale: 0.85 });
    kit.box('gold', lx - 0.02, 15.0, lx + 0.02, 15.22, 2.2, 2.24, { zone: PZ, edges: false });
  }

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
  for (const t of TREES) palm(kit, t.x, t.n, GROUND_Y, t.h, { seed: Math.round(t.x * 7 + t.n), len: t.r * 1.3 });

  // inner doors, standing open
  for (const d of DOORS) {
    if (d.n === 2.5) continue;
    const a = (d.open * Math.PI) / 180;
    const ex = d.x + Math.cos(a) * d.w, en = d.n + Math.sin(a) * d.w;
    kit.box('teak', Math.min(d.x, ex) - (Math.abs(Math.cos(a)) < 0.5 ? 0.025 : 0), Math.min(d.n, en) - (Math.abs(Math.sin(a)) < 0.5 ? 0.025 : 0), Math.max(d.x, ex) + (Math.abs(Math.cos(a)) < 0.5 ? 0.025 : 0), Math.max(d.n, en) + (Math.abs(Math.sin(a)) < 0.5 ? 0.025 : 0), 0, 2.65);
  }

  return { shell, kit, leaves, chandelier: CH };
}
