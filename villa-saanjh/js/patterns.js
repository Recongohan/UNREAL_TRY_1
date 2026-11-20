// Patterned surfaces painted in code, so nothing here needs a licence:
// the cement floor tile, the glazed wall tile, black marble and the brass jali.

import * as THREE from 'three';

function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}
function tex(c, { srgb = true, anisotropy = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = anisotropy;
  return t;
}
function seeded(seed) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}
const star = (g, cx, cy, r, inner) => {
  g.beginPath();
  for (let i = 0; i < 16; i++) {
    const a = (i * Math.PI) / 8 - Math.PI / 2;
    const rr = i % 2 ? inner : r;
    g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  g.closePath();
};

// Encaustic cement tile, 20 cm: an eight-point star, quarter rosettes in the
// corners, so four tiles together make a second star where they meet.
export function cementTile(anisotropy) {
  const S = 512;
  const [c, g] = canvas(S);
  const ivory = '#ece5d6', navy = '#1d2f52', blue = '#5f86ad', ochre = '#c39a45';
  g.fillStyle = ivory;
  g.fillRect(0, 0, S, S);
  // corner rosettes (each a quarter of a star centred on the corner)
  for (const [x, y] of [[0, 0], [S, 0], [0, S], [S, S]]) {
    g.fillStyle = navy;
    star(g, x, y, S * 0.36, S * 0.25);
    g.fill();
    g.fillStyle = blue;
    g.beginPath();
    g.arc(x, y, S * 0.17, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = ivory;
    g.beginPath();
    g.arc(x, y, S * 0.08, 0, Math.PI * 2);
    g.fill();
  }
  // centre star
  g.fillStyle = blue;
  star(g, S / 2, S / 2, S * 0.3, S * 0.2);
  g.fill();
  g.strokeStyle = navy;
  g.lineWidth = S * 0.018;
  star(g, S / 2, S / 2, S * 0.3, S * 0.2);
  g.stroke();
  g.fillStyle = ochre;
  star(g, S / 2, S / 2, S * 0.13, S * 0.08);
  g.fill();
  // petals on the edge midpoints
  g.fillStyle = navy;
  for (const [x, y, rot] of [[S / 2, 0, 0], [S / 2, S, 0], [0, S / 2, 1], [S, S / 2, 1]]) {
    g.beginPath();
    g.ellipse(x, y, rot ? S * 0.05 : S * 0.1, rot ? S * 0.1 : S * 0.05, 0, 0, Math.PI * 2);
    g.fill();
  }
  // wear: a soft mottling, and a fine grout line
  const rnd = seeded(5);
  for (let i = 0; i < 2600; i++) {
    g.globalAlpha = 0.035;
    g.fillStyle = rnd() > 0.5 ? '#fff' : '#000';
    g.fillRect(rnd() * S, rnd() * S, 2 + rnd() * 6, 2 + rnd() * 6);
  }
  g.globalAlpha = 1;
  g.strokeStyle = 'rgba(80,70,60,0.55)';
  g.lineWidth = 3;
  g.strokeRect(0, 0, S, S);
  return tex(c, { anisotropy });
}

// Glazed wall tile, 15 cm: white with a blue interlace, like the lift lobby.
export function wallTile(anisotropy) {
  const S = 384;
  const [c, g] = canvas(S);
  g.fillStyle = '#f4f2ec';
  g.fillRect(0, 0, S, S);
  g.strokeStyle = '#3d6593';
  g.lineWidth = S * 0.022;
  for (const [x, y] of [[0, 0], [S, 0], [0, S], [S, S], [S / 2, S / 2]]) {
    star(g, x, y, S * 0.3, S * 0.22);
    g.stroke();
  }
  g.lineWidth = S * 0.012;
  for (const [x, y] of [[S / 2, 0], [0, S / 2], [S, S / 2], [S / 2, S]]) {
    g.beginPath();
    g.arc(x, y, S * 0.12, 0, Math.PI * 2);
    g.stroke();
  }
  g.strokeStyle = 'rgba(150,150,150,0.8)';
  g.lineWidth = 2;
  g.strokeRect(0, 0, S, S);
  return tex(c, { anisotropy });
}

// Black marble with white veins (Nero Marquina), 1.2 m square.
export function blackMarble(anisotropy) {
  const S = 1024;
  const [c, g] = canvas(S);
  g.fillStyle = '#141416';
  g.fillRect(0, 0, S, S);
  const rnd = seeded(11);
  for (let i = 0; i < 900; i++) {
    g.globalAlpha = 0.04;
    g.fillStyle = rnd() > 0.5 ? '#2a2a30' : '#0a0a0b';
    g.beginPath();
    g.arc(rnd() * S, rnd() * S, 20 + rnd() * 80, 0, Math.PI * 2);
    g.fill();
  }
  // veins: wandering lines, drawn three times with falling width for a soft edge
  for (let v = 0; v < 26; v++) {
    let x = rnd() * S, y = rnd() * S, a = rnd() * Math.PI * 2;
    const pts = [];
    for (let k = 0; k < 90; k++) {
      a += (rnd() - 0.5) * 0.5;
      x += Math.cos(a) * 9;
      y += Math.sin(a) * 9 + 3;
      pts.push([x, y]);
    }
    const strong = v < 6;
    for (const [w, al] of [[6, 0.05], [2.4, 0.18], [0.9, strong ? 0.75 : 0.4]]) {
      g.globalAlpha = al;
      g.strokeStyle = '#e8e6e2';
      g.lineWidth = w * (strong ? 1.4 : 1);
      // wrap the vein around the tile edges so the texture repeats without a seam
      const wrap = (v) => ((v % S) + S) % S;
      g.beginPath();
      pts.forEach(([px, py], i) => {
        const jump = i && (Math.abs(wrap(pts[i - 1][0]) - wrap(px)) > S / 2 || Math.abs(wrap(pts[i - 1][1]) - wrap(py)) > S / 2);
        if (!i || jump) g.moveTo(wrap(px), wrap(py));
        else g.lineTo(wrap(px), wrap(py));
      });
      g.stroke();
    }
  }
  g.globalAlpha = 1;
  return tex(c, { anisotropy });
}

// Brass jali: overlapping circles cut from a sheet. Returned as an alpha map.
export function jali() {
  const S = 512;
  const [c, g] = canvas(S);
  g.fillStyle = '#000';
  g.fillRect(0, 0, S, S);
  g.strokeStyle = '#fff';
  g.lineWidth = S * 0.035;
  const r = S / 4;
  for (let i = -1; i <= 4; i++) for (let j = -1; j <= 4; j++) {
    g.beginPath();
    g.arc(i * r, j * r, r, 0, Math.PI * 2);
    g.stroke();
  }
  g.lineWidth = S * 0.05;
  g.strokeRect(0, 0, S, S);
  const t = tex(c, { srgb: false });
  return t;
}

// Glass pool mosaic, 2 cm tesserae in mixed blues, 0.5 m square.
export function mosaic(anisotropy) {
  const S = 1024, N = 25;
  const [c, g] = canvas(S);
  g.fillStyle = '#d9e4e6';
  g.fillRect(0, 0, S, S);
  const rnd = seeded(23);
  const blues = ['#1f6f9a', '#2a86b0', '#3a9cc2', '#1a5c86', '#4fb0cf', '#2d7ea6', '#6cc0d6'];
  const cell = S / N, gap = cell * 0.09;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    g.fillStyle = blues[Math.floor(rnd() * blues.length)];
    g.fillRect(i * cell + gap / 2, j * cell + gap / 2, cell - gap, cell - gap);
    g.globalAlpha = 0.15;
    g.fillStyle = '#ffffff';
    g.fillRect(i * cell + gap / 2, j * cell + gap / 2, (cell - gap) * 0.5, (cell - gap) * 0.35);
    g.globalAlpha = 1;
  }
  return tex(c, { anisotropy });
}

// Small ripples on the water, as a normal map (tiles every metre).
export function ripples() {
  const S = 256;
  const [c, g] = canvas(S);
  const img = g.createImageData(S, S);
  const h = (x, y) => {
    let v = 0;
    for (const [fx, fy, a, p] of [[3, 2, 1, 0.3], [-2, 5, 0.6, 1.1], [7, -4, 0.35, 2.0], [-6, -7, 0.25, 0.7]]) v += a * Math.sin(((fx * x + fy * y) / S) * Math.PI * 2 + p);
    return v;
  };
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = h(x + 1, y) - h(x - 1, y), dy = h(x, y + 1) - h(x, y - 1);
    const k = 6;
    let nx = -dx * k, ny = -dy * k, nz = 1;
    const l = Math.hypot(nx, ny, nz);
    const i = (y * S + x) * 4;
    img.data[i] = ((nx / l) * 0.5 + 0.5) * 255;
    img.data[i + 1] = ((ny / l) * 0.5 + 0.5) * 255;
    img.data[i + 2] = ((nz / l) * 0.5 + 0.5) * 255;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return tex(c, { srgb: false });
}

// The gallery painting: the Konkan shore at dusk, in broad strokes.
export function painting() {
  const W = 960, H = 600;
  const [c, g] = canvas(W, H);
  const sky = g.createLinearGradient(0, 0, 0, H * 0.62);
  sky.addColorStop(0, '#2b3f63');
  sky.addColorStop(0.55, '#c9785a');
  sky.addColorStop(1, '#e9b77f');
  g.fillStyle = sky;
  g.fillRect(0, 0, W, H * 0.62);
  const sea = g.createLinearGradient(0, H * 0.62, 0, H);
  sea.addColorStop(0, '#b77a62');
  sea.addColorStop(1, '#1f344d');
  g.fillStyle = sea;
  g.fillRect(0, H * 0.62, W, H);
  g.fillStyle = '#f3d29a';
  g.beginPath();
  g.arc(W * 0.66, H * 0.56, 46, 0, Math.PI * 2);
  g.fill();
  const rnd = seeded(13);
  for (let i = 0; i < 900; i++) {
    const y = rnd() * H;
    g.globalAlpha = 0.06;
    g.fillStyle = y < H * 0.62 ? (rnd() > 0.5 ? '#f0c08a' : '#3a4a70') : rnd() > 0.5 ? '#e7b07a' : '#13263a';
    g.fillRect(rnd() * W, y, 40 + rnd() * 160, 2 + rnd() * 6);
  }
  // a line of palms against the sky
  g.globalAlpha = 0.9;
  g.strokeStyle = g.fillStyle = '#1b1c22';
  for (const [x, h] of [[90, 260], [170, 300], [760, 280], [860, 240]]) {
    g.lineWidth = 6;
    g.beginPath();
    g.moveTo(x, H * 0.66);
    g.quadraticCurveTo(x + 18, H * 0.66 - h * 0.5, x + 8, H * 0.66 - h);
    g.stroke();
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * Math.PI * 2;
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(x + 8, H * 0.66 - h);
      g.quadraticCurveTo(x + 8 + Math.cos(a) * 40, H * 0.66 - h - 20, x + 8 + Math.cos(a) * 75, H * 0.66 - h + Math.abs(Math.sin(a)) * 40 + 20);
      g.stroke();
    }
  }
  g.globalAlpha = 1;
  const t = tex(c, {});
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}
