// The camera, as a function of scroll progress s from 0 to 1.
//
// One perspective camera does the whole page. Over the sheet it hangs a long
// way up with a lens of about 1.6 degrees, which flattens perspective until the
// model reads as a printed drawing. Coming down, the lens opens while the
// camera closes in, with the framing held, so there is never a cut.
//
//   01 sheet      0.00 - 0.06
//   02 the lift   0.06 - 0.32   the cut rises through the walls, the camera tips and turns
//      descent    0.32 - 0.56   roofs close over, the camera lands in front of the portico
//   03 entry      0.56 - 0.62   the portico turns to stone and lamplight
//   04 foyer      0.62 - 1.00   up the steps, through the door, into the double-height hall
//   05 dining     1.00 - 1.45   across the foyer, through the small arch, down the table to the pool
//   06 pool       1.45 - 1.80   up to the French doors: the pool turns real outside
//   07 gallery    1.80 - 2.10   back past the sideboard, through the arch, and west down the gallery
//
// The numbers above are story time T. Scroll progress s (0 to 1) maps to T = s * LENGTH.

import { SITE, CUT_PLAN, CUT_OPEN, GROUND_Y, EYE } from './plan.js';

const clamp01 = (t) => Math.min(1, Math.max(0, t));
const smooth = (t) => t * t * (3 - 2 * t);
const smoother = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const lin = (t) => t;
const deg = Math.PI / 180;

// piecewise track: keys are [s, value, ease into this key]
function track(keys) {
  return (s) => {
    if (s <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i++) {
      const [s1, v1, e = lin] = keys[i];
      if (s <= s1) {
        const [s0, v0] = keys[i - 1];
        return v0 + (v1 - v0) * e((s - s0) / (s1 - s0));
      }
    }
    return keys[keys.length - 1][1];
  };
}

// a smooth curve through points that never overshoots them (Fritsch-Carlson),
// so walking slows into each key without stopping dead between them
function glide(keys) {
  const xs = keys.map((k) => k[0]), ys = keys.map((k) => k[1]), n = keys.length;
  const d = [];
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  const m = [0];
  for (let i = 1; i < n - 1; i++) m.push(d[i - 1] * d[i] <= 0 ? 0 : (2 * d[i - 1] * d[i]) / (d[i - 1] + d[i]));
  m.push(0);
  return (s) => {
    if (s <= xs[0]) return ys[0];
    if (s >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (s > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], t = (s - xs[i]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}

export const STOPS = { sheet: 0.06, lift: 0.32, land: 0.56, entry: 0.62, foyer: 1.0, dining: 1.45, pool: 1.8 };
export const LENGTH = 2.1;

export function makeRig(aspect) {
  const portrait = aspect < 0.9;
  const fovWalk = portrait ? 74 : aspect < 1.4 ? 60 : 52; // vertical degrees

  // what the sheet shows: a frame w x h metres centred on (cx, cn)
  const siteW = SITE.x1 - SITE.x0, siteD = SITE.n1 - SITE.n0;
  let frame;
  if (portrait) {
    const w = siteW + 4, h = Math.max(w / aspect, siteD / 0.34);
    // headline above the site, title block below it
    frame = { w: h * aspect, h, cx: (SITE.x0 + SITE.x1) / 2, cn: SITE.n1 + 0.43 * h - h / 2 };
  } else {
    // the site sits in the right 62%; the headline and title block take the left
    const w = Math.max((siteW + 6) / 0.62, (siteD + 6) * aspect), h = w / aspect;
    frame = { w, h, cx: SITE.x1 + 4.6 - w / 2, cn: (SITE.n0 + SITE.n1) / 2 + 0.6 };
  }

  const T = (fov) => Math.tan((fov * deg) / 2);
  const L = Math.log;
  const DOOR = { x: 24.0, y: 1.35, n: 5.25 };
  const LAND_X = 33.4;
  const landDist = LAND_X - DOOR.x;
  const landFrame = 2 * landDist * T(fovWalk);
  const { sheet: s1, lift: s2, land: s3 } = STOPS;

  // tip early, so the walls are seen rising rather than only seen risen
  const early = (t) => 0.55 * smooth(t) + 0.45 * (1 - (1 - t) * (1 - t));
  const elev = track([[0, 90], [s1, 90], [s2, 40, early], [s3, -1.2, smooth]]);
  const yaw = track([[0, 0], [s1, 0], [s2, 28, smooth], [s3, 90, smooth]]);
  const lens = track([[0, L(T(1.6))], [s1, L(T(1.6))], [s2, L(T(6.5)), smooth], [s3, L(T(fovWalk)), smoother]]);
  const frm = track([[0, L(frame.h)], [s1, L(frame.h * 0.94)], [s2, L(portrait ? 46 : 34), smooth], [s3, L(landFrame), smoother]]);
  const tx = track([[0, frame.cx], [s1, frame.cx], [s2, 18.5, smooth], [s3, DOOR.x, smooth]]);
  const ty = track([[0, GROUND_Y], [s1, GROUND_Y], [s2, 0.6, smooth], [s3, DOOR.y, smooth]]);
  const tn = track([[0, frame.cn], [s1, frame.cn], [s2, 8.5, smooth], [s3, DOOR.n, smooth]]);
  // the cut climbs through the walls (staying under the ceilings), then lifts off once we are low
  const cut = track([[0, CUT_PLAN], [s1 + 0.01, CUT_PLAN], [s2 - 0.02, 3.45, smooth], [0.39, 3.5, lin], [0.46, CUT_OPEN, smooth]]);

  // on foot
  const walkX = glide([[s3, LAND_X], [0.6, 33.0], [0.7, 28.6], [0.8, 25.2], [0.9, 23.6], [0.97, 23.05], [1, 22.95]]);

  // 05: a curve across the foyer and through the arch into the dining room
  const P = [[22.95, 4.6], [21.2, 5.7], [19.2, 6.45], [17.65, 6.8], [17.05, 7.45], [16.95, 8.5], [16.15, 8.85], [15.25, 8.8]];
  const along = glide([[1.0, 0], [1.06, 0.06], [1.24, 0.58], [1.37, 0.9], [1.45, 1]]);
  const yaw5 = glide([[1.0, 69], [1.1, 62], [1.19, 40], [1.25, 12], [1.31, 3], [1.45, 0]]);
  const pitch5 = glide([[1.0, 8], [1.12, 1.5], [1.3, 0], [1.45, -1.5]]);
  const spline = (u) => {
    const n = P.length - 1, f = Math.min(n - 1e-6, u * n), i = Math.floor(f), t = f - i;
    const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(n, i + 2)];
    const c = (k) => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t * t + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t * t * t);
    return [c(0), c(1)];
  };
  const floorAt = (x) => (x >= 28.4 ? GROUND_Y : x <= 27.6 ? 0 : GROUND_Y * smooth((x - 27.6) / 0.8));

  // 06 and 07: to the doors, then round the table and into the gallery
  // out through the open door onto the terrace, back in, down the west side and through the arch
  const Q = [[15.25, 8.75], [16.55, 9.6], [16.85, 11.6], [16.1, 13.6], [14.3, 14.2], [14.2, 15.6], [14.05, 16.0], [14.2, 15.5], [14.15, 14.1], [13.65, 12.6], [13.6, 10.6], [13.8, 9.0], [14.45, 7.95], [14.4, 6.85], [14.15, 6.4]];
  const along6 = glide([[1.45, 0], [1.5, 0.04], [1.62, 0.36], [1.68, 0.41], [1.76, 0.43], [1.84, 0.62], [1.94, 0.82], [2.02, 0.95], [2.1, 1]]);
  const yaw6 = glide([[1.45, 0], [1.52, -8], [1.58, 15], [1.63, 35], [1.7, 52], [1.76, 60], [1.81, 150], [1.87, 178], [1.93, 172], [1.98, 130], [2.03, 92], [2.1, 80]]);
  const pitch6 = glide([[1.45, -1.5], [1.6, -5], [1.72, -10], [1.8, -3], [2.1, 1]]);
  const curve = (pts, u) => {
    const n = pts.length - 1, f = Math.min(n - 1e-6, u * n), i = Math.floor(f), t = f - i;
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n, i + 2)];
    const c = (k) => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t * t + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t * t * t);
    return [c(0), c(1)];
  };

  function at(sIn) {
    const s = Math.min(LENGTH, Math.max(0, sIn * LENGTH));
    const o = { s, cut: cut(s), dining: 0, pool: 0, gallery: 0 };
    if (s > STOPS.dining) {
      const [x, n] = curve(Q, along6(s));
      Object.assign(o, { fov: fovWalk, x, y: EYE, z: -n, yaw: yaw6(s) * deg, pitch: pitch6(s) * deg, dist: 9, door: 1, entry: 1, foyer: 1, floor: 0, dining: 1 });
      o.pool = clamp01((s - 1.55) / 0.17);
      o.gallery = clamp01((s - 1.93) / 0.13);
    } else if (s > STOPS.foyer) {
      const [x, n] = spline(along(s));
      o.fov = fovWalk;
      o.x = x;
      o.y = EYE;
      o.z = -n;
      o.yaw = yaw5(s) * deg;
      o.pitch = pitch5(s) * deg;
      o.dist = 9;
      o.door = 1;
      o.entry = 1;
      o.foyer = 1;
      o.floor = 0;
      o.dining = clamp01((s - 1.2) / 0.2);
    } else if (s <= s3) {
      const e = elev(s) * deg, y = yaw(s) * deg;
      const th = Math.exp(lens(s));
      const dist = Math.exp(frm(s)) / (2 * th);
      o.fov = (2 * Math.atan(th)) / deg;
      o.pitch = -e;
      o.yaw = y;
      // camera = target - forward * dist; forward for yaw y, pitch -e
      const fx = -Math.sin(y) * Math.cos(e), fy = -Math.sin(e), fz = -Math.cos(y) * Math.cos(e);
      o.x = tx(s) - fx * dist;
      o.y = ty(s) - fy * dist;
      o.z = -tn(s) - fz * dist;
      o.dist = dist;
      o.door = 0;
      o.entry = clamp01((s - 0.47) / (0.6 - 0.47));
      o.foyer = 0;
    } else {
      const x = walkX(s);
      const inside = smooth(clamp01((24.5 - x) / 2.4));
      o.fov = fovWalk;
      o.x = x;
      o.y = floorAt(x) + EYE;
      o.z = -(DOOR.n - 0.65 * inside);
      o.yaw = (90 - 21 * smooth(clamp01((24.6 - x) / 1.6))) * deg;
      o.pitch = (-1.2 + 1.2 * smooth(clamp01((s - s3) / 0.06)) + 8 * smooth(clamp01((24.2 - x) / 1.2))) * deg;
      o.dist = 9;
      o.door = smooth(clamp01((31.2 - x) / 4.6));
      o.entry = clamp01((s - 0.47) / (0.6 - 0.47));
      o.foyer = clamp01((25.0 - x) / (25.0 - 23.1));
      o.floor = floorAt(x);
    }
    // keep depth precise: from far above the whole house is a thin slab
    if (o.dist > 60) {
      o.near = Math.max(1, o.dist - 140);
      o.far = o.dist + 240;
    } else {
      o.near = 0.05;
      o.far = 600;
    }
    return o;
  }
  return { at, frame, portrait, fovWalk };
}
