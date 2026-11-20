// Build a copy of the site that fits the claude.ai Artifact page contract:
// the page body without its own <html>/<head> wrapper (the host adds one), and no
// stylesheet from anywhere but Google Fonts (Lenis's few rules are inlined).
//
//   node tools/artifact.mjs build/artifact
//
// Writes <out>/index.html and <out>/files.json, the map of published path -> source
// file for every asset the page loads.

import { readFile, writeFile, mkdir, readdir } from 'fs/promises';
import { join, resolve, dirname, relative } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(process.argv[2] || join(ROOT, 'build', 'artifact'));
await mkdir(OUT, { recursive: true });

let html = await readFile(join(ROOT, 'index.html'), 'utf8');
const lenisCss = await (await fetch('https://cdn.jsdelivr.net/npm/lenis@1.1.14/dist/lenis.css')).text();
const siteCss = await readFile(join(ROOT, 'css', 'style.css'), 'utf8');

const head = html.slice(html.indexOf('<head>') + 6, html.indexOf('</head>'));
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'));
const keep = head
  .split('\n')
  .filter((l) => !/<meta charset|<meta name="viewport"|lenis\.css|css\/style\.css|<link rel="icon"/.test(l))
  .join('\n');
html = `${keep.trim()}
<style>
/* Lenis */
${lenisCss.trim()}
${siteCss.trim()}
</style>
${body.trim()}
`;
await writeFile(join(OUT, 'index.html'), html);

// everything the page fetches, by the path it asks for
const files = {};
const add = async (dir) => {
  for (const e of await readdir(join(ROOT, dir), { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) await add(p);
    else files[p] = join(ROOT, p);
  }
};
for (const d of ['js', 'assets', 'bake', 'models']) await add(d);
await writeFile(join(OUT, 'files.json'), JSON.stringify(files, null, 1));
console.log(`wrote ${relative(ROOT, OUT)}/index.html and ${Object.keys(files).length} files`);
