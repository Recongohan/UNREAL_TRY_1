// Villa Saanjh: every number in the building.
//
// Plan coordinates, in metres: x runs east, n runs north. The outside faces of
// the house run from x 0 to 24 and from n 0 to 15. In three.js a plan point
// (x, n) at height y is (x, y, -n), so north is the -z axis.

export const PAPER = '#f2efe7';
export const INK = '#1a1a1d';

export const GROUND_Y = -0.45; // the sheet: garden level, three steps below the floor
export const CUT_PLAN = 1.2; // where an architect cuts a plan
export const CUT_OPEN = 9.0; // above the parapet: nothing is cut
export const EYE = 1.6;

export const PROJECT = {
  name: 'Villa Saanjh',
  place: 'Kihim, Alibag',
  drawing: 'Ground floor plan',
  sheet: 'A-101',
  scale: '1:100',
  date: '20.11.2026',
};

// The whole site, used to frame the sheet.
export const SITE = { x0: -4.5, x1: 38.5, n0: -4.5, n1: 27.5 };

// Rooms as clear interior boxes. The walls are whatever is left of the solid.
// h: ceiling height. label: where the name sits on the plan.
export const ROOMS = [
  { key: 'bed2', name: 'BEDROOM 2', x0: 0.3, x1: 7.9, n0: 0.3, n1: 7.9, h: 3.6, label: [4.1, 3.4] },
  { key: 'ward', name: 'WARDROBE', x0: 8.1, x1: 11.4, n0: 0.3, n1: 4.9, h: 3.6, label: [9.75, 2.6] },
  { key: 'bath2', name: 'BATH', x0: 11.6, x1: 15.9, n0: 0.3, n1: 4.9, h: 3.6, label: [13.75, 2.6] },
  { key: 'gallery', name: 'GALLERY', x0: 8.1, x1: 16.1, n0: 5.1, n1: 7.9, h: 3.6, label: [12.0, 6.5], noDims: true },
  { key: 'master', name: 'MASTER BEDROOM', x0: 0.3, x1: 9.9, n0: 8.1, n1: 14.7, h: 3.6, label: [5.1, 11.0] },
  { key: 'mbath', name: 'BATH', x0: 10.1, x1: 12.4, n0: 8.1, n1: 14.7, h: 3.6, label: [11.25, 11.4], small: true },
  { key: 'dining', name: 'DINING', x0: 12.6, x1: 17.9, n0: 8.1, n1: 14.7, h: 3.6, label: [15.25, 9.3] },
  { key: 'foyer', name: 'FOYER', x0: 16.1, x1: 23.7, n0: 2.6, n1: 7.9, h: 7.4, label: [21.4, 3.45] },
  { key: 'stair', name: 'STAIR HALL', x0: 18.1, x1: 23.7, n0: 7.9, n1: 14.7, h: 7.4, label: [19.6, 13.7], noDims: true },
  { key: 'powder', name: 'POWDER', x0: 16.1, x1: 20.4, n0: 0.3, n1: 2.4, h: 3.0, label: [17.4, 1.35], small: true },
  { key: 'lift', name: 'LIFT', x0: 20.6, x1: 23.7, n0: 0.3, n1: 2.4, h: 3.6, label: [22.15, 1.35], small: true },
];

// Zones the camera walks into. Each one stays a line drawing until its sweep
// front passes. Box in plan coordinates plus a height range; the sweep starts
// at `from` (an x or n value) and runs in direction `dir` for `len` metres.
// The first box that holds a point wins, so the dining room comes before the
// foyer (whose box also covers the stair hall next to it).
export const ZONES = [
  { key: 'dining', x0: 12.55, x1: 17.95, n0: 7.98, n1: 14.9, y0: -0.2, y1: 3.75, dir: [0, 1], from: 7.98, len: 7.0 },
  { key: 'gallery', x0: 7.95, x1: 16.05, n0: 4.95, n1: 7.98, y0: -0.2, y1: 3.75, dir: [-1, 0], from: 16.05, len: 8.1 },
  // the terrace and pool, and the north face of the house seen from them
  { key: 'pool', x0: -1.5, x1: 17.6, n0: 14.95, n1: 26.0, y0: -2.0, y1: 8.4, dir: [0, 1], from: 14.95, len: 11 },
  { key: 'entry', x0: 23.95, x1: 38, n0: -1, n1: 12, y0: -1, y1: 4.6, dir: [-1, 0], from: 36.5, len: 13 },
  { key: 'foyer', x0: 16.0, x1: 23.95, n0: 0.25, n1: 14.75, y0: -0.2, y1: 7.6, dir: [-1, 0], from: 23.95, len: 8.2 },
];

// Doors drawn on the plan: hinge (x, n), leaf width, and the two angles of the
// swing in degrees from east (the leaf is drawn open at `open`).
export const DOORS = [
  { x: 8.0, n: 5.8, w: 1.1, open: 180, closed: 90, sweep: [90, 180] }, // bedroom 2
  { x: 8.5, n: 8.0, w: 1.1, open: 90, closed: 0, sweep: [0, 90] }, // master
  { x: 9.0, n: 5.0, w: 1.0, open: -90, closed: 0, sweep: [-90, 0] }, // wardrobe
  { x: 12.5, n: 5.0, w: 1.0, open: -90, closed: 0, sweep: [-90, 0] }, // bath 2
  { x: 10.0, n: 9.0, w: 1.0, open: 0, closed: 90, sweep: [0, 90] }, // master bath
  { x: 18.6, n: 2.5, w: 0.9, open: -90, closed: 0, sweep: [-90, 0] }, // powder
];

// The front door: a 1.9 m oak pivot door in the east wall.
export const FRONT_DOOR = { x: 23.85, n0: 4.3, n1: 6.2, h: 3.5, pivotN: 4.75, t: 0.08 };

// The pool basin, in plan.
export const POOL = { x0: 2.5, x1: 13.5, n0: 16.5, n1: 21.5, water: -0.18, floor: -1.5 };

// Trees: crowns sit above the cut, so the plan draws them dashed.
export const TREES = [
  { x: 31.0, n: 0.8, r: 2.4, h: 6.5 },
  { x: 34.5, n: 10.5, r: 2.8, h: 7.0 },
  { x: 30.0, n: 11.8, r: 1.8, h: 5.2 },
  { x: -2.0, n: 18.0, r: 2.2, h: 6.0 },
  { x: 15.0, n: 25.0, r: 2.0, h: 5.5 },
  { x: 3.0, n: -2.6, r: 1.7, h: 5.0 },
];

// Late afternoon: the sun is low in the west-south-west, so it reaches the pool past the house.
export const SUN = { elevation: 21, azimuth: 250 }; // degrees; azimuth from north, clockwise
