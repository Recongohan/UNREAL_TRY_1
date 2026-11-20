// BoxSolid: boolean modelling with axis-aligned boxes, for right-angled buildings.
//
// Add and carve boxes in order (a later box wins). build() slices space along
// every box face into a grid of cells, marks each cell full or empty, and
// returns:
//   - the skin: one quad wherever a full cell meets an empty one, so the
//     surface is watertight and has nothing hidden inside it;
//   - the edges: only where the skin really turns a corner, never along the
//     seam between two boxes that happen to share a face.
//
// Because the skin is watertight, a clipping plane that cuts through a wall
// shows the inside of the skin. Shading those back faces black gives the
// solid black walls of an architect's plan for free.

import * as THREE from 'three';

const snap = (v) => Math.round(v * 1000) / 1000;

export class BoxSolid {
  constructor() {
    this.ops = [];
  }
  // x, y, z in three.js space
  box(fill, x0, y0, z0, x1, y1, z1) {
    this.ops.push({
      fill,
      lo: [snap(Math.min(x0, x1)), snap(Math.min(y0, y1)), snap(Math.min(z0, z1))],
      hi: [snap(Math.max(x0, x1)), snap(Math.max(y0, y1)), snap(Math.max(z0, z1))],
    });
  }

  // faceMat(center, normal) -> material key
  // edgeTag(mid, air) -> line set key; `air` is a point just off the edge, outside the solid
  build(faceMat, edgeTag) {
    const axisCoords = (a) => [...new Set(this.ops.flatMap((o) => [o.lo[a], o.hi[a]]))].sort((p, q) => p - q);
    const C = [axisCoords(0), axisCoords(1), axisCoords(2)];
    const N = C.map((c) => c.length - 1);
    const index = C.map((c) => new Map(c.map((v, i) => [v, i])));
    const cells = new Uint8Array(N[0] * N[1] * N[2]);
    const id = (i, j, k) => i + N[0] * (j + N[1] * k);
    for (const o of this.ops) {
      const [i0, j0, k0] = [0, 1, 2].map((a) => index[a].get(o.lo[a]));
      const [i1, j1, k1] = [0, 1, 2].map((a) => index[a].get(o.hi[a]));
      for (let k = k0; k < k1; k++) for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) cells[id(i, j, k)] = o.fill ? 1 : 0;
    }
    const full = (i, j, k) => i >= 0 && j >= 0 && k >= 0 && i < N[0] && j < N[1] && k < N[2] && cells[id(i, j, k)] === 1;

    // ---- skin --------------------------------------------------------------
    const parts = {};
    const sides = [
      [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
    ];
    for (let k = 0; k < N[2]; k++) for (let j = 0; j < N[1]; j++) for (let i = 0; i < N[0]; i++) {
      if (!full(i, j, k)) continue;
      const lo = [C[0][i], C[1][j], C[2][k]];
      const hi = [C[0][i + 1], C[1][j + 1], C[2][k + 1]];
      for (const n of sides) {
        if (full(i + n[0], j + n[1], k + n[2])) continue;
        const a = n[0] ? 0 : n[1] ? 1 : 2; // the axis the face looks along
        const s = n[a] > 0 ? hi[a] : lo[a];
        const centre = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
        centre[a] = s;
        const key = faceMat(centre, n);
        const P = (parts[key] ??= new Part());
        P.quad(lo, hi, a, s, n);
      }
    }
    const geometries = {};
    for (const key in parts) geometries[key] = parts[key].geometry();

    // ---- edges -------------------------------------------------------------
    // For each short piece of grid line along axis a, look at the four cells
    // around it. One or three full: a corner. Two full across a diagonal: two
    // corners touching. Anything else: flat or empty, no line.
    const edges = {};
    const AIR = 0.05;
    for (let a = 0; a < 3; a++) {
      const b = (a + 1) % 3, c = (a + 2) % 3;
      const cell = (ia, ib, ic) => {
        const v = [0, 0, 0];
        v[a] = ia; v[b] = ib; v[c] = ic;
        return full(v[0], v[1], v[2]) ? 1 : 0;
      };
      const pt = (va, vb, vc) => {
        const v = [0, 0, 0];
        v[a] = va; v[b] = vb; v[c] = vc;
        return v;
      };
      for (let ib = 0; ib <= N[b]; ib++) for (let ic = 0; ic <= N[c]; ic++) {
        let start = -1, startSig = '', startKey = '';
        const close = (endIa) => {
          if (start < 0) return;
          const p0 = pt(C[a][start], C[b][ib], C[c][ic]);
          const p1 = pt(C[a][endIa], C[b][ib], C[c][ic]);
          (edges[startKey] ??= []).push(...p0, ...p1);
          start = -1;
        };
        for (let ia = 0; ia < N[a]; ia++) {
          const q00 = cell(ia, ib - 1, ic - 1), q10 = cell(ia, ib, ic - 1);
          const q01 = cell(ia, ib - 1, ic), q11 = cell(ia, ib, ic);
          const sum = q00 + q10 + q01 + q11;
          const corner = sum === 1 || sum === 3 || (sum === 2 && q00 === q11);
          if (!corner) { close(ia); continue; }
          // average direction towards the empty cells
          let db = 0, dc = 0;
          if (!q00) { db--; dc--; }
          if (!q10) { db++; dc--; }
          if (!q01) { db--; dc++; }
          if (!q11) { db++; dc++; }
          const len = Math.hypot(db, dc) || 1;
          const ma = (C[a][ia] + C[a][ia + 1]) / 2;
          const mid = pt(ma, C[b][ib], C[c][ic]);
          const air = pt(ma, C[b][ib] + (db / len) * AIR, C[c][ic] + (dc / len) * AIR);
          const key = edgeTag(mid, air);
          const sig = `${q00}${q10}${q01}${q11}`;
          if (start >= 0 && (sig !== startSig || key !== startKey)) close(ia);
          if (start < 0) { start = ia; startSig = sig; startKey = key; }
        }
        close(N[a]);
      }
    }
    return { geometries, edges, cells: cells.length };
  }
}

// Collects quads and boxes for one material, with world-planar UVs in metres
// so every surface has the same texture scale.
export class Part {
  constructor() {
    this.p = [];
    this.n = [];
    this.uv = [];
    this.idx = [];
  }
  vertex(v, n) {
    this.p.push(v[0], v[1], v[2]);
    this.n.push(n[0], n[1], n[2]);
    if (n[0]) this.uv.push(n[0] > 0 ? -v[2] : v[2], v[1]);
    else if (n[1]) this.uv.push(v[0], -v[2]);
    else this.uv.push(n[2] > 0 ? v[0] : -v[0], v[1]);
  }
  // an axis-aligned rectangle lying in plane `a = s`, facing n
  quad(lo, hi, a, s, n) {
    const b = (a + 1) % 3, c = (a + 2) % 3;
    const corner = (vb, vc) => {
      const v = [0, 0, 0];
      v[a] = s; v[b] = vb; v[c] = vc;
      return v;
    };
    const base = this.p.length / 3;
    const vs = [corner(lo[b], lo[c]), corner(hi[b], lo[c]), corner(hi[b], hi[c]), corner(lo[b], hi[c])];
    for (const v of vs) this.vertex(v, n);
    // wind counter-clockwise when seen from the side n points to
    if (n[a] > 0) this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    else this.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
  box(x0, y0, z0, x1, y1, z1) {
    const lo = [Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)];
    const hi = [Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)];
    for (let a = 0; a < 3; a++) {
      const n = [0, 0, 0];
      n[a] = 1;
      this.quad(lo, hi, a, hi[a], n.slice());
      n[a] = -1;
      this.quad(lo, hi, a, lo[a], n.slice());
    }
  }
  // any placed three.js geometry; keeps its own UVs (scaled), or none
  mesh(g, uvScale = 1) {
    const src = g.index ? g.toNonIndexed() : g;
    const P = src.attributes.position, Nm = src.attributes.normal, U = src.attributes.uv;
    const base = this.p.length / 3;
    for (let i = 0; i < P.count; i++) {
      this.p.push(P.getX(i), P.getY(i), P.getZ(i));
      this.n.push(Nm.getX(i), Nm.getY(i), Nm.getZ(i));
      this.uv.push(U ? U.getX(i) * uvScale : 0, U ? U.getY(i) * uvScale : 0);
      this.idx.push(base + i);
    }
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    return g;
  }
}

// the 12 edges of a box, as segment pairs
export function boxEdges(out, x0, y0, z0, x1, y1, z1) {
  const v = [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]];
  for (const [p, q] of [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]) out.push(...v[p], ...v[q]);
}
