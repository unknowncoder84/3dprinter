# 3D Flashcard Studio

Design alphabet flashcards (letter + picture + word), preview them in real 3D, and download
**real STL files** for 3D printing - one card or the whole A-Z set as a ZIP. Everything runs in
your browser: no account, no server, nothing is uploaded.

## Run it locally

**Easiest (Windows):** double-click `start.bat`. It installs and builds the first time, then opens
<http://localhost:3000>.

**Or from a terminal** (Node 18.17+; Node 20 recommended):

```bash
npm install
npm run build      # creates the static site in ./out
npm start          # serves ./out at http://localhost:3000
```

For development with hot reload use `npm run dev` (also http://localhost:3000; do not run both at once).

## Make a card

1. **Alphabet** - type `Aa`. **Word** - type `ant`.
2. **Illustration** - drag a PNG/JPG/SVG onto the picture box (or click it). SVG works best; PNG/JPG
   works well for clean, high-contrast drawings (see "Pictures" below).
3. Adjust size, thickness, corner radius, fonts, heights and positions in the left panel.
4. **Hole placement** - click or tap the little card diagram (or "Place on 3D view" and click the
   3D card). Presets: top/middle/bottom left/centre/right. The hole is cut as a real opening.
5. **Generate STL** downloads e.g. `A_ant.stl`. **Export all (ZIP)** packs many cards into one ZIP.
6. **Generate A-Z** adds the missing letters (A-Z with default words) using the current card's
   settings. It never overwrites cards you already have. Give each card its own picture.

Projects: **Save / Load** (kept in this browser, plus an automatic backup of your last session),
**Export project / Import project** (a `.flashcards.json` file you can move between computers).

## Units and coordinates

STL units are **millimetres**. Origin = centre of the card; +X right, +Y up the card, +Z out of the
front. The back face is at Z = 0, so the card lies flat on the print bed with the letters, picture and
word facing up. Defaults: 80 x 100 x 3 mm, corner radius 8 mm, 5 mm hole 7 mm from the top-left
corner. The model is one watertight surface (the raised details are part of the same shell, not
separate overlapping meshes). A standard STL cannot carry colours; print in a single colour.

## How it works

One geometry pipeline (`lib/geometry/model.ts`) produces the triangles that the 3D preview shows, the
STL contains and the ZIP packs, so they cannot disagree.

* **Text** - real glyph outlines from bundled OFL fonts (Poppins Bold, Lilita One, Comic Neue Bold)
  via opentype.js. Glyph holes (A, B, D, O, P, R, a, e ...) are preserved. Over-wide text is scaled to
  fit, with a notice. Characters missing from the font are skipped and reported.
* **SVG** - paths, shapes, transforms, fill rules, strokes (converted to outlines), CSS classes.
  White/near-white shapes cut holes in what was drawn before (typical outline art). `<text>`,
  embedded `<image>` and `<foreignObject>` are rejected with an explanation; clip-paths, masks,
  filters, dashes and gradients are ignored with a warning.
* **PNG/JPG** - threshold (automatic or manual) + contrast + smoothing -> sub-pixel contour tracing ->
  simplification -> relief. Photos and gradients cannot become clean relief; the app warns.
* **Solid** - polygon booleans with Clipper, constrained triangulation (keeps every vertex, so no
  T-junction cracks), exact side walls. The hole is subtracted in 2D and extruded, so it is an exact
  through-opening.
* **Checks** - closed/manifold surface, degenerate triangles, pieces, bounding box vs. configured
  size. Exported bytes are re-read and re-checked.

## Tests

```bash
npm test               # type-check + 30 unit tests (geometry, state, project files)
npm run build && npm start     # then, in another terminal (needs Microsoft Edge or Chrome installed):
BASE_URL=http://localhost:3000 npm run test:e2e
```

The end-to-end suite drives the real UI in a browser, downloads real STL/ZIP/JSON files and checks
them with independent code (three.js `STLLoader`, a separate topology checker, JSZip, screenshot
pixel analysis). `tests/blender/inspect_stl.py` opens exported STLs in Blender (if installed) for a
third, fully independent check: `blender --background --python tests/blender/inspect_stl.py -- out.json renders/ a.stl b.stl`.

## Deploy to Netlify

The app is a Next.js project exported as static files (`output: 'export'`), so it needs no server
functions and no environment variables. `netlify.toml` is already configured:

* Build command `npm run build`, publish directory `out`, Node 20.
* `NETLIFY_NEXT_PLUGIN_SKIP=true` so Netlify does not add the Next.js server runtime.
* No SPA catch-all redirect (single page); long-cache headers for hashed assets and fonts.

Push the repository to GitHub/GitLab and import it in Netlify (settings are read from
`netlify.toml`), or run `npm run build` and drag the `out` folder onto <https://app.netlify.com/drop>.

## Limitations (please read)

* **Printability is not guaranteed.** The checks prove a closed, consistent surface and correct size.
  They do not detect self-intersections or analyse wall thickness; confirm in your slicer.
* **Pictures:** SVG and clean black-on-white drawings convert well. Photos, gradients and busy
  backgrounds do not. Fine detail thinner than your nozzle will not print.
* **Single colour** only (STL limitation). Edge bevel/rounding is not implemented.
* Geometry is built on the main thread in short steps (about 0.1-1 s per card); there is no Web Worker.
* Projects live in browser storage, which is limited. The app reports a full disk instead of failing
  silently; use *Export project* for backups.
* `npm audit` reports advisories for Next.js 14 (server features such as the image optimizer and
  server actions). They do not affect the deployed static site, which has no Next.js server; upgrading
  to a newer major version is a separate decision.

## Third-party

Fonts: Poppins, Lilita One, Comic Neue - SIL Open Font License 1.1 (licence files in `public/fonts`).
Libraries: Next.js, React, Three.js, opentype.js, clipper-lib, cdt2d, JSZip, idb, lucide-react.
