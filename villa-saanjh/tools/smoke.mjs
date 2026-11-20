// Smoke test of the real page: smooth scroll (Lenis + ScrollTrigger), no capture mode.
//
//   node tools/smoke.mjs [url]
//
// Loads the page, scrolls to the bottom with the mouse wheel, and checks that the
// story reaches its end, the closing card shows, and nothing threw. Then scrolls
// back to the top and checks the sheet returns. Headless Chromium renders in
// software, so the frame rate it reports is a floor, not what a real GPU gets.

import { createRequire } from 'module';
import { createServer } from 'http';
import { readFile } from 'fs/promises';
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
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.json': 'application/json', '.glb': 'model/gltf-binary', '.hdr': 'application/octet-stream' };
let url = process.argv[2];
let server;
if (!url) {
  server = createServer(async (req, res) => {
    const p = join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    try {
      const body = await readFile(p.endsWith('/') ? join(p, 'index.html') : p);
      res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((r) => server.listen(0, r));
  url = `http://localhost:${server.address().port}/index.html`;
}

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const problems = [];
page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
page.on('console', (m) => m.type() === 'error' && problems.push('console: ' + m.text()));
page.on('requestfailed', (r) => problems.push('request failed: ' + r.url()));
const t0 = Date.now();
await page.goto(url);
await page.waitForFunction(() => window.__ready, null, { timeout: 240000 });
console.log(`ready in ${((Date.now() - t0) / 1000).toFixed(1)} s, baked meshes: ${(await page.evaluate(() => window.__state())).baked}`);

const state = () => page.evaluate(() => {
  const st = window.__state();
  const end = getComputedStyle(document.getElementById('end'));
  return { s: st.s, fov: st.fov, errors: st.errors.length, end: +end.opacity };
});
await page.mouse.move(640, 360);
let last = await state(), frames = 0;
const tScroll = Date.now();
for (let i = 0; i < 400 && last.s < 2.74; i++) {
  await page.mouse.wheel(0, 900);
  await page.waitForTimeout(60);
  frames++;
  if (i % 40 === 0) {
    last = await state();
    console.log(`wheel ${i}: story ${last.s.toFixed(3)}, lens ${last.fov.toFixed(1)}°`);
  }
}
await page.waitForTimeout(2500);
last = await state();
console.log(`bottom: story ${last.s.toFixed(3)}, closing card opacity ${last.end.toFixed(2)}, ${((Date.now() - tScroll) / 1000).toFixed(0)} s`);
const ok1 = last.s > 2.7 && last.end > 0.9;
await page.screenshot({ path: join(ROOT, 'build', 'smoke-end.png') });

for (let i = 0; i < 400; i++) await page.mouse.wheel(0, -2000);
await page.waitForTimeout(3500);
const top = await state();
console.log(`back at top: story ${top.s.toFixed(3)}, lens ${top.fov.toFixed(1)}°`);
const ok2 = top.s < 0.02 && top.fov < 2;
await page.screenshot({ path: join(ROOT, 'build', 'smoke-top.png') });

console.log(problems.length ? 'problems:\n  ' + problems.join('\n  ') : 'no errors');
console.log(ok1 && ok2 && !problems.length ? 'PASS' : 'FAIL');
await browser.close();
server?.close();
process.exit(ok1 && ok2 && !problems.length ? 0 : 1);
