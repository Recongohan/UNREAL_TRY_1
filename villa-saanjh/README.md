# Villa Saanjh: a floor plan you can walk into

A scroll-driven landing page. It opens on a printed ground-floor plan. On scroll, the walls rise out of the drawing, the camera comes down to the portico and walks through the front door at eye height. Each room stays a line drawing until the camera reaches it, then the real materials sweep across it.

The plan is not a picture: it is the 3D model, cut at 1.2 m and seen from straight above through a 1.6° lens.

**Status: checkpoint 1.** The sheet, the walls rising, the entry, and the walk into the double-height foyer. The dining room beyond is still ink.

## Run it

Plain files, no build step. The page needs a server because browsers block modules and textures from a double-clicked file:

```bash
cd villa-saanjh && python3 -m http.server 8231
```

Then open http://localhost:8231.

## Record it

```bash
node tools/shoot.mjs stills out 0 0.3 0.56 1     # PNG at chosen scroll positions
node tools/shoot.mjs video media/walk.mp4 14 24  # full scroll, frame by frame
```

`?capture` on the URL turns off smoothing and exposes `window.__frame(s)`.

## How it is built

| file | what it does |
|---|---|
| `js/plan.js` | every number: rooms, zones, doors, sun |
| `js/solid.js` | box modeller: adds and carves boxes, returns one watertight skin and its true edges. The cut plane shows the inside of the skin, painted black: the walls of the plan |
| `js/house.js` | the villa: shell, arches, portico, Dutch gable, stair, chandelier, furniture, plants |
| `js/materials.js` | one shader blends paper-and-ink into lit material as each zone's sweep front passes |
| `js/patterns.js` | cement tile, wall tile, black marble and brass jali, painted in code |
| `js/sheet.js` | labels, dimension strings, door swings, title block, scale bar |
| `js/rig.js` | the camera as a function of scroll |
| `js/main.js` | renderer, lights, lines, GSAP ScrollTrigger + Lenis |

three.js 0.170, GSAP 3.12.5 and Lenis 1.1.14 load from jsDelivr. With `prefers-reduced-motion`, the page moves in still frames, one per stop.

## Credits

- Limestone, white oak, lime plaster and leather maps: CC0 scans from [Poly Haven](https://polyhaven.com).
- Patterned tiles, marble and jali: generated in `js/patterns.js`.
- Motion modelled on the casa-larga demo; look after the brief's reference villa (Goan heritage, Moroccan detail). The house, its name and the place are invented.
