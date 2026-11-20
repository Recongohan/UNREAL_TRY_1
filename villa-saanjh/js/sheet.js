// What an architect adds to a plan that is not the building: room names and
// sizes, dimension strings, door swings, the stair arrow, the pool, the cars,
// the border and the title block. It all lies flat on the floor and the
// ground of the model, so it is still under your feet when you walk in.

import * as THREE from 'three';
import { INK, PAPER, ROOMS, DOORS, TREES, GROUND_Y, PROJECT, FRONT_DOOR } from './plan.js';
import { zoneOf } from './house.js';

export const MONO = '"DM Mono", ui-monospace, Menlo, monospace';
export const SERIF = '"Cormorant Garamond", Georgia, serif';
const PXM = 120; // canvas pixels per metre for labels
const f2 = (v) => v.toFixed(2);

export function buildSheet({ frame, portrait, labelScale = 1, anisotropy = 8, planesFor }) {
  const group = new THREE.Group();
  const lines = {}; // 'kind|zone' -> positions
  const FLOOR = 0.006, OUT = GROUND_Y + 0.006;
  const seg = (kind, zone, x0, n0, x1, n1, y) => (lines[kind + '|' + zone] ??= []).push(x0, y, -n0, x1, y, -n1);
  const trash = [];

  // ---- text -------------------------------------------------------------------
  function text(rows, { x, n, y = FLOOR, rot = 0, zone = 'rest', align = 'center' }) {
    const c = document.createElement('canvas');
    const g = c.getContext('2d');
    const specs = rows.map((r) => {
      const px = r.size * labelScale * PXM;
      return { ...r, px, font: `${r.weight ?? 400} ${px}px ${r.font ?? MONO}`, track: (r.track ?? 0.1) * px, lead: px * (r.lead ?? 1.45) };
    });
    let w = 0, h = 0;
    for (const s of specs) {
      g.font = s.font;
      g.letterSpacing = s.track + 'px';
      s.w = g.measureText(s.t).width;
      w = Math.max(w, s.w);
      h += s.lead;
    }
    const pad = 6;
    c.width = Math.ceil(w + pad * 2);
    c.height = Math.ceil(h + pad * 2);
    let yy = pad;
    g.fillStyle = INK;
    for (const s of specs) {
      g.font = s.font;
      g.letterSpacing = s.track + 'px';
      g.globalAlpha = s.alpha ?? 1;
      g.textBaseline = 'middle';
      g.fillText(s.t, align === 'center' ? (c.width - s.w) / 2 : pad, yy + s.lead / 2);
      yy += s.lead;
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = anisotropy;
    const m = new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, toneMapped: false, clippingPlanes: planesFor(zone) });
    const geo = new THREE.PlaneGeometry(c.width / PXM, c.height / PXM);
    const mesh = new THREE.Mesh(geo, m);
    mesh.rotation.set(-Math.PI / 2, 0, rot);
    mesh.position.set(x, y, -n);
    mesh.renderOrder = 2;
    group.add(mesh);
    trash.push(t, m, geo);
  }

  // ---- rooms -------------------------------------------------------------------
  for (const r of ROOMS) {
    const [x, n] = r.label;
    const w = r.x1 - r.x0, d = r.n1 - r.n0;
    const rows = [{ t: r.name, size: r.small ? 0.2 : 0.27, weight: 500, track: 0.14 }];
    if (!r.small && !r.noDims) {
      rows.push({ t: `${f2(w)} × ${f2(d)}`, size: 0.2 });
      rows.push({ t: `${(w * d).toFixed(1)} m²`, size: 0.2, alpha: 0.7 });
    }
    if (r.key === 'foyer') rows.push({ t: 'CEILING +7.40', size: 0.17, alpha: 0.7 });
    text(rows, { x, n, zone: zoneOf(x, 0.1, n) });
  }
  text([{ t: 'ENTRY', size: 0.27, weight: 500, track: 0.14 }, { t: 'PORTICO 3.60 × 4.90', size: 0.17, alpha: 0.7 }], { x: 25.8, n: 5.25, zone: 'entry' });
  text([{ t: 'SWIMMING POOL', size: 0.3, weight: 500, track: 0.14 }, { t: '11.00 × 5.00', size: 0.22 }], { x: 8.0, n: 19.0, y: -0.17 });
  text([{ t: 'POOL TERRACE', size: 0.22, weight: 500, track: 0.14 }], { x: 8.0, n: 22.6, y: FLOOR });
  text([{ t: 'PARKING', size: 0.27, weight: 500, track: 0.14 }], { x: 21.6, n: 20.3, y: -0.33 + 0.006 });
  text([{ t: 'UP', size: 0.2, weight: 500 }], { x: 22.85, n: 9.45, zone: 'foyer' });

  // ---- dimension strings -----------------------------------------------------------
  // `along` 'n': a north-south string at x = at; 'x': east-west at n = at
  function dims(along, at, ticks, side = -1, ext) {
    const T = 0.2, k = 'anno', z = 'rest';
    const a0 = ticks[0], a1 = ticks[ticks.length - 1];
    if (along === 'n') {
      seg(k, z, at, a0 - 0.4, at, a1 + 0.4, OUT);
      for (const t of ticks) {
        seg(k, z, at - T, t - T, at + T, t + T, OUT);
        if (ext !== undefined) seg('thin', z, ext, t, at - side * 0.25, t, OUT);
      }
      for (let i = 0; i < ticks.length - 1; i++) {
        const d = ticks[i + 1] - ticks[i];
        if (d >= 0.9) text([{ t: f2(d), size: 0.2 }], { x: at + side * 0.36, n: (ticks[i] + ticks[i + 1]) / 2, y: OUT, rot: Math.PI / 2 });
      }
    } else {
      seg(k, z, a0 - 0.4, at, a1 + 0.4, at, OUT);
      for (const t of ticks) {
        seg(k, z, t - T, at - T, t + T, at + T, OUT);
        if (ext !== undefined) seg('thin', z, t, ext, t, at - side * 0.25, OUT);
      }
      for (let i = 0; i < ticks.length - 1; i++) {
        const d = ticks[i + 1] - ticks[i];
        if (d >= 0.9) text([{ t: f2(d), size: 0.2 }], { x: (ticks[i] + ticks[i + 1]) / 2, n: at + side * 0.36, y: OUT });
      }
    }
  }
  dims('x', -1.7, [0, 8.0, 11.5, 16.0, 20.5, 24.0], -1, -0.3);
  dims('x', -2.9, [0, 24.0, 28.4], -1, -1.9);
  dims('n', -1.6, [0, 8.0, 15.0], 1, -0.3);
  dims('n', -2.8, [0, 15.0, 23.5], 1, -1.9);
  dims('n', 36.6, [0, 2.6, 7.9, 15.0], -1, 29.8);

  // ---- door swings ----------------------------------------------------------------
  const arc = (kind, zone, cx, cn, r, a0, a1, y, N = 20) => {
    for (let i = 0; i < N; i++) {
      const t0 = ((a0 + ((a1 - a0) * i) / N) * Math.PI) / 180, t1 = ((a0 + ((a1 - a0) * (i + 1)) / N) * Math.PI) / 180;
      seg(kind, zone, cx + Math.cos(t0) * r, cn + Math.sin(t0) * r, cx + Math.cos(t1) * r, cn + Math.sin(t1) * r, y);
    }
  };
  for (const d of DOORS) arc('thin', zoneOf(d.x - 0.2, 0.1, d.n), d.x, d.n, d.w, d.sweep[0], d.sweep[1], FLOOR);
  // the front door: two leaves opening inward
  const w2 = (FRONT_DOOR.n1 - FRONT_DOOR.n0) / 2;
  arc('thin', 'foyer', 23.7, FRONT_DOOR.n0, w2, 90, 180, FLOOR);
  arc('thin', 'foyer', 23.7, FRONT_DOOR.n1, w2, 180, 270, FLOOR);

  // ---- stair: walking line with an arrow, a break line at the cut ----------------------------
  const sl = (x0, n0, x1, n1) => seg('anno', 'foyer', x0, n0, x1, n1, FLOOR);
  sl(22.83, 9.75, 22.83, 13.7);
  sl(22.83, 13.7, 20.98, 13.7);
  sl(20.98, 13.7, 20.98, 10.6);
  sl(20.98, 10.6, 20.8, 10.95);
  sl(20.98, 10.6, 21.16, 10.95);
  sl(21.95, 11.4, 23.7, 11.9); // break line
  // lift: a cross through the shaft
  seg('thin', 'rest', 20.6, 0.3, 23.7, 2.4, FLOOR);
  seg('thin', 'rest', 20.6, 2.4, 23.7, 0.3, FLOOR);

  // ---- floor patterns, as a plan shows them ---------------------------------------------------
  // the foyer's tile field: a 0.6 m grid inside the border
  for (let x = 16.55 + 0.6; x < 23.25 - 0.01; x += 0.6) seg('hatch', 'foyer', x, 3.05, x, 7.45, FLOOR);
  for (let n = 3.05 + 0.6; n < 7.45 - 0.01; n += 0.6) seg('hatch', 'foyer', 16.55, n, 23.25, n, FLOOR);
  // bedrooms: floorboards
  for (const r of ROOMS.filter((q) => ['bed2', 'master', 'ward'].includes(q.key))) for (let n = r.n0 + 0.19; n < r.n1; n += 0.19) seg('hatch', 'rest', r.x0, n, r.x1, n, FLOOR);
  // pool: a few ripple strokes
  for (let n = 17.0; n < 21.2; n += 0.45) {
    const k = Math.round((n - 17) / 0.45);
    seg('hatch', 'rest', 3.2 + (k % 3) * 0.9, n, 4.4 + (k % 3) * 0.9, n, -0.17);
    seg('hatch', 'rest', 9.0 - (k % 2) * 0.7, n + 0.2, 10.0 - (k % 2) * 0.7, n + 0.2, -0.17);
  }
  // parking: two cars, dashed (they are not part of the building)
  const car = (cx, cn) => {
    const L = 4.8, W = 1.9;
    const x0 = cx - L / 2, x1 = cx + L / 2, n0 = cn - W / 2, n1 = cn + W / 2, y = -0.33 + 0.006;
    for (const [a, b, c, d] of [[x0, n0, x1, n0], [x1, n0, x1, n1], [x1, n1, x0, n1], [x0, n1, x0, n0]]) seg('dash', 'rest', a, b, c, d, y);
    seg('dash', 'rest', x0 + 1.4, n0 + 0.15, x0 + 1.4, n1 - 0.15, y);
    seg('dash', 'rest', x1 - 1.3, n0 + 0.15, x1 - 1.3, n1 - 0.15, y);
  };
  car(21.6, 23.0);
  car(21.6, 17.7);
  // the path from the gate, and the drive
  seg('dash', 'rest', 30.5, 5.25, 38.3, 5.25, OUT);
  for (const n of [15.8, 24.8]) seg('anno', 'rest', 26.2, n, 38.3, n, OUT);
  // tree crowns are above the cut: dashed circles
  for (const t of TREES) arc('dash', 'rest', t.x, t.n, t.r, 0, 360, OUT, 36);
  arc('dash', 'entry', 30.4, 1.6, 2.2, 0, 360, OUT, 36);
  arc('dash', 'entry', 31.2, 9.4, 2.6, 0, 360, OUT, 36);

  // ---- border and title block -------------------------------------------------------------------
  const inset = 1.2;
  const sideInset = portrait ? -6 : inset;
  const bx0 = frame.cx - frame.w / 2 + sideInset, bx1 = frame.cx + frame.w / 2 - sideInset;
  const bn0 = frame.cn - frame.h / 2 + inset, bn1 = frame.cn + frame.h / 2 - inset;
  for (const k of [0, 0.25]) {
    seg('anno', 'rest', bx0 + k, bn0 + k, bx1 - k, bn0 + k, OUT);
    seg('anno', 'rest', bx1 - k, bn0 + k, bx1 - k, bn1 - k, OUT);
    seg('anno', 'rest', bx1 - k, bn1 - k, bx0 + k, bn1 - k, OUT);
    seg('anno', 'rest', bx0 + k, bn1 - k, bx0 + k, bn0 + k, OUT);
  }
  const TW = portrait ? frame.w * 0.62 : Math.min(18, frame.w * 0.26), TH = TW * 0.42;
  const tb = titleBlock(TW, TH);
  tb.anisotropy = anisotropy;
  const tbm = new THREE.Mesh(new THREE.PlaneGeometry(TW, TH), new THREE.MeshBasicMaterial({ map: tb, transparent: true, depthWrite: false, toneMapped: false }));
  tbm.rotation.x = -Math.PI / 2;
  const tbx = portrait ? frame.cx - frame.w / 2 + 2.2 + TW / 2 : bx0 + 0.25 + TW / 2;
  tbm.position.set(tbx, OUT, -(bn0 + 0.25 + TH / 2));
  tbm.renderOrder = 2;
  group.add(tbm);
  trash.push(tb, tbm.material, tbm.geometry);

  return { group, lines, dispose: () => trash.forEach((d) => d.dispose()) };
}

function titleBlock(TW, TH) {
  const P = 80;
  const c = document.createElement('canvas');
  c.width = Math.round(TW * P);
  c.height = Math.round(TH * P);
  const g = c.getContext('2d');
  const W = c.width, H = c.height;
  g.fillStyle = PAPER;
  g.fillRect(0, 0, W, H);
  g.strokeStyle = g.fillStyle = INK;
  g.lineWidth = 4;
  g.strokeRect(2, 2, W - 4, H - 4);
  const line = (a, b, c2, d) => { g.beginPath(); g.moveTo(a, b); g.lineTo(c2, d); g.stroke(); };
  const yA = Math.round(H * 0.5), yB = Math.round(H * 0.74);
  g.lineWidth = 2;
  line(0, yA, W, yA);
  line(0, yB, W, yB);
  const xS = Math.round(W * 0.68);
  line(xS, yA, xS, yB);
  const cells = [0.2, 0.46, 0.66, 0.83].map((f) => Math.round(W * f));
  for (const x of cells) line(x, yB, x, H);
  const m = P * 0.3;
  const label = (t, x, y) => {
    g.font = `500 ${P * 0.26}px ${MONO}`;
    g.letterSpacing = P * 0.04 + 'px';
    g.globalAlpha = 0.6;
    g.textBaseline = 'top';
    g.fillText(t, x + m, y + m * 0.8);
    g.globalAlpha = 1;
  };
  const value = (t, x, yBottom, size = 0.46) => {
    g.font = `400 ${P * size}px ${MONO}`;
    g.letterSpacing = '0px';
    g.textBaseline = 'alphabetic';
    g.fillText(t, x + m, yBottom - m * 0.8);
  };
  label('PROJECT', 0, 0);
  g.font = `500 ${Math.min(yA * 0.56, W * 0.12)}px ${SERIF}`;
  g.letterSpacing = '0px';
  g.textBaseline = 'alphabetic';
  g.fillText(PROJECT.name, m, yA - m * 0.9);
  g.textAlign = 'right';
  value(PROJECT.place, W - 2 * m, yA, 0.4);
  g.textAlign = 'left';
  label('DRAWING', 0, yA);
  value(PROJECT.drawing, 0, yB, 0.46);
  label('SHEET', xS, yA);
  value(PROJECT.sheet, xS, yB, 0.6);
  // north arrow
  const ch = H - yB, ax = cells[0] / 2, ay = yB + ch * 0.55, r = Math.min(ch * 0.3, cells[0] * 0.28);
  g.lineWidth = 2.5;
  g.beginPath(); g.arc(ax, ay, r, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.moveTo(ax, ay - r * 1.25); g.lineTo(ax - r * 0.42, ay + r * 0.2); g.lineTo(ax, ay); g.closePath(); g.fill();
  line(ax, ay, ax, ay + r * 1.1);
  g.font = `500 ${P * 0.3}px ${MONO}`;
  g.textBaseline = 'middle';
  g.fillText('N', ax + r * 0.55, ay - r * 0.75);
  // scale bar, true to the drawing: P pixels per metre
  label('METRES', cells[0], yB);
  const sx = cells[0] + m, sy = H - m - P * 0.16, bars = Math.max(2, Math.min(4, Math.floor((cells[1] - cells[0] - 2 * m) / P)));
  g.lineWidth = 2;
  g.strokeRect(sx, sy, bars * P, P * 0.16);
  for (let i = 0; i < bars; i += 2) g.fillRect(sx + i * P, sy, P, P * 0.16);
  label('CUT AT', cells[1], yB);
  value('+1.20 m', cells[1], H, 0.4);
  label('SCALE', cells[2], yB);
  value(PROJECT.scale, cells[2], H, 0.4);
  label('DATE', cells[3], yB);
  value(PROJECT.date, cells[3], H, 0.36);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
