// Render the page at exact scroll positions in headless Chromium.
//
//   node tools/shoot.mjs stills OUT_DIR [s1 s2 ...]     one PNG per position
//   node tools/shoot.mjs video OUT.mp4 [seconds] [fps]  a full scroll, frame by frame
//
// Options through the environment: W, H (viewport), DPR.
// The page runs with ?capture, which turns off smoothing and exposes
// window.__frame(s), so every frame is exactly the requested position.

import { createRequire } from 'module';
import { createServer } from 'http';
import { readFile, mkdir, rm } from 'fs/promises';
import { extname, join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = require(join(execFileSync('npm', ['root', '-g']).toString().trim(), 'playwright')));
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  const path = join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  try {
    const body = await readFile(path.endsWith('/') ? join(path, 'index.html') : path);
    res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(0, r));
const url = `http://localhost:${server.address().port}/index.html?capture`;

const [mode = 'stills', out = 'shots', ...rest] = process.argv.slice(2);
const W = +(process.env.W || 1280), H = +(process.env.H || 720), DPR = +(process.env.DPR || 1);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: DPR });
page.on('console', (m) => m.type() === 'error' && console.log('console:', m.text()));
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.goto(url);
await page.waitForFunction(() => window.__ready || (window.__errors && window.__errors.length), null, { timeout: 240000 });
const errs = await page.evaluate(() => window.__errors);
if (errs.length) console.log('errors:', errs);

if (mode === 'stills') {
  await mkdir(out, { recursive: true });
  const list = rest.length ? rest.map(Number) : [0, 0.12, 0.25, 0.4, 0.5, 0.56, 0.66, 0.76, 0.86, 1];
  for (const s of list) {
    const t = Date.now();
    await page.evaluate((s) => window.__frame(s), s);
    await page.screenshot({ path: join(out, `s_${s.toFixed(3)}.png`) });
    const st = await page.evaluate(() => window.__state());
    console.log(s.toFixed(3), `${Date.now() - t} ms`, `calls ${st.calls}`, `tris ${st.tris}`, st.errors.length ? st.errors : '');
  }
} else {
  const seconds = +(rest[0] || 16), fps = +(rest[1] || 30);
  const dir = out + '.frames';
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const N = Math.round(seconds * fps);
  // scroll speed through the page: linger on the sheet, then a steady walk
  const ease = (u) => {
    const keys = [[0, 0], [0.07, 0.0], [0.18, 0.06], [0.5, 0.42], [0.62, 0.58], [0.72, 0.64], [0.95, 1], [1, 1]];
    for (let i = 1; i < keys.length; i++) if (u <= keys[i][0]) {
      const t = (u - keys[i - 1][0]) / (keys[i][0] - keys[i - 1][0]);
      const e = t * t * (3 - 2 * t);
      return keys[i - 1][1] + (keys[i][1] - keys[i - 1][1]) * (i === 1 || i === keys.length - 1 ? t : 0.5 * t + 0.5 * e);
    }
    return 1;
  };
  for (let i = 0; i < N; i++) {
    await page.evaluate((s) => window.__frame(s), ease(i / (N - 1)));
    await page.screenshot({ path: join(dir, `f${String(i).padStart(5, '0')}.png`) });
    if (i % 30 === 0) console.log(`frame ${i}/${N}`);
  }
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-framerate', String(fps), '-i', join(dir, 'f%05d.png'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-movflags', '+faststart', out]);
  await rm(dir, { recursive: true, force: true });
  console.log('wrote', out);
}
await browser.close();
server.close();
