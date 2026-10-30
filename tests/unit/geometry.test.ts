import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFlashcardModel, ModelError } from '../../lib/geometry/model';
import { getFont } from '../../lib/geometry/fonts';
import { textToRegion } from '../../lib/geometry/textOutline';
import { svgToRegion, SvgImportError } from '../../lib/geometry/svgImport';
import { traceRaster } from '../../lib/geometry/rasterTrace';
import { regionArea, regionBounds, type Region } from '../../lib/geometry/region';
import { analyzeStl, positionsToStl, mergeParts, stlFileName, stlToPositions } from '../../lib/export/stl';
import { validatePositions } from '../../lib/geometry/validate';
import { makeRaster, nodeDeps, rasterImage, readAsset, svgImage, testCard, useDiskFonts } from './helpers';

const antSvg = () => readAsset('public/samples/ant.svg');
const holesIn = (r: Region) => r.reduce((n, p) => n + p.length - 1, 0);
const near = (a: number, b: number, tol: number, msg?: string) =>
  assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} expected ${b} ± ${tol}, got ${a}`);

test('card base with a real through-hole is a closed manifold with exact dimensions', async () => {
  const m = await buildFlashcardModel(testCard({ alphabet: '', word: '' }), nodeDeps());
  assert.equal(m.blocking, false, JSON.stringify(m.issues));
  assert.ok(m.validation.closedManifold, m.validation.messages.join('; '));
  assert.equal(m.validation.components, 1);
  near(m.validation.size[0], 80, 0.01);
  near(m.validation.size[1], 100, 0.01);
  near(m.validation.size[2], 3, 0.001);
  // volume = (rounded-rect area - hole area) * thickness
  const cardArea = 80 * 100 - (4 - Math.PI) * 64;
  const holeArea = 0.5 * 56 * 6.25 * Math.sin((2 * Math.PI) / 56);
  near(m.validation.volume, (cardArea - holeArea) * 3, 25, 'volume');
  // the hole wall is real geometry: 56 segments * 2 triangles
  const pos = mergeParts(m.parts);
  const hx = 7 - 0 - 40 + 33; // hole x from left = 7 -> centred -33
  void hx;
  let wall = 0;
  for (let t = 0; t < pos.length / 9; t++) {
    let ok = true;
    for (let v = 0; v < 3; v++) {
      const d = Math.hypot(pos[t * 9 + v * 3] - -33, pos[t * 9 + v * 3 + 1] - 43);
      if (Math.abs(d - 2.5) > 0.003) ok = false;
    }
    if (ok) wall++;
  }
  assert.equal(wall, 112, 'cylindrical wall triangles around the hole');
});

test('disabling the hole removes the opening from the geometry', async () => {
  const c = testCard({ alphabet: '', word: '' });
  c.holeSettings.enabled = false;
  const m = await buildFlashcardModel(c, nodeDeps());
  assert.ok(m.validation.closedManifold);
  const cardArea = 80 * 100 - (4 - Math.PI) * 64;
  near(m.validation.volume, cardArea * 3, 25);
  const pos = mergeParts(m.parts);
  for (let t = 0; t < pos.length / 9; t++) {
    for (let v = 0; v < 3; v++) {
      const d = Math.hypot(pos[t * 9 + v * 3] + 33, pos[t * 9 + v * 3 + 1] - 43);
      assert.ok(d > 2.4 || pos[t * 9 + v * 3 + 2] >= 0, 'no vertices on a hole wall');
    }
  }
});

test('glyph counters (holes) are preserved for A B D O P R a e', async () => {
  useDiskFonts();
  const { font } = await getFont('poppins-bold');
  const expected: Record<string, number> = { A: 1, B: 2, D: 1, O: 1, P: 1, R: 1, a: 1, e: 1, n: 0, t: 0, H: 0 };
  for (const [ch, holes] of Object.entries(expected)) {
    const o = textToRegion(font, ch, 20);
    assert.equal(o.region.length, 1, `${ch}: one outline`);
    assert.equal(holesIn(o.region), holes, `${ch}: expected ${holes} hole(s)`);
  }
  const ant = textToRegion(font, 'ant', 10);
  assert.equal(ant.region.length, 3, 'a, n, t are three separate shapes');
  assert.equal(holesIn(ant.region), 1);
  // cap height is honoured: 'A' is 26 mm tall
  const A = textToRegion(font, 'A', 26);
  near(A.bounds!.maxY - A.bounds!.minY, 26, 0.3);
});

test('text, illustration and word build one closed manifold solid', async () => {
  const c = testCard({ image: svgImage(antSvg(), 'ant.svg') });
  const m = await buildFlashcardModel(c, nodeDeps());
  assert.equal(m.blocking, false, JSON.stringify(m.issues));
  assert.ok(m.validation.closedManifold, m.validation.messages.join('; '));
  assert.equal(m.validation.components, 1, 'single connected solid');
  const roles = m.parts.map((p) => p.role).sort();
  assert.deepEqual(roles, ['alphabet', 'base', 'image', 'word']);
  for (const p of m.parts) assert.ok(p.positions.length > 0, `${p.role} has triangles`);
  near(m.validation.size[0], 80, 0.01);
  near(m.validation.size[1], 100, 0.01);
  near(m.validation.size[2], 3 + 1.6, 0.001, 'max height = base + tallest detail');
  // raised details really are above the surface
  for (const p of m.parts.filter((x) => x.role !== 'base')) {
    let zmax = -Infinity;
    for (let i = 2; i < p.positions.length; i += 3) zmax = Math.max(zmax, p.positions[i]);
    assert.ok(zmax > 3, `${p.role} sits above the card surface`);
  }
});

test('layout: alphabet above illustration above word, all inside the card', async () => {
  const c = testCard({ image: svgImage(antSvg()) });
  const m = await buildFlashcardModel(c, nodeDeps());
  const { alphabet: a, image: i, word: w } = m.placements;
  assert.ok(a && i && w);
  assert.ok(a.minY > i.maxY, 'alphabet is above the illustration');
  assert.ok(i.minY > w.maxY, 'illustration is above the word');
  for (const b of [a, i, w]) {
    assert.ok(b.minX > -40 && b.maxX < 40 && b.minY > -50 && b.maxY < 50, 'inside card');
  }
  // horizontally centred by real geometry bounds
  near((a.minX + a.maxX) / 2, 0, 0.05);
  near((w.minX + w.maxX) / 2, 0, 0.05);
  near((i.minX + i.maxX) / 2, 0, 0.05);
});

test('changing card dimensions changes the geometry', async () => {
  const c = testCard({ image: svgImage(antSvg()) });
  c.dimensions = { width: 100, height: 120, thickness: 4, cornerRadius: 10 };
  c.holeSettings.x = 8;
  c.holeSettings.y = 8;
  const m = await buildFlashcardModel(c, nodeDeps());
  assert.ok(m.validation.closedManifold);
  near(m.validation.size[0], 100, 0.01);
  near(m.validation.size[1], 120, 0.01);
  near(m.validation.size[2], 4 + 1.6, 0.001);
});

test('SVG import: ant produces solid islands, nested holes and keeps proportions', () => {
  const r = svgToRegion(antSvg());
  assert.ok(r.region.length >= 3, 'multiple shapes (body, stripes, antennae tips, pupil)');
  assert.ok(holesIn(r.region) >= 3, 'eye white, smile, stripes carved out of the body');
  const b = regionBounds(r.region)!;
  const ratio = (b.maxX - b.minX) / (b.maxY - b.minY);
  assert.ok(ratio > 1.4 && ratio < 1.7, `aspect ratio kept (got ${ratio.toFixed(2)})`);
  assert.ok(regionArea(r.region) > 500);
});

test('SVG import rejects unsupported content with a useful message', () => {
  assert.throws(() => svgToRegion('<svg xmlns="http://www.w3.org/2000/svg"><text x="0" y="10">Hi</text></svg>'), (e: unknown) => e instanceof SvgImportError && /live text/.test((e as Error).message));
  assert.throws(() => svgToRegion('<svg xmlns="http://www.w3.org/2000/svg"><image href="data:image/png;base64,AAAA" width="10" height="10"/></svg>'), (e: unknown) => /embedded bitmap/.test((e as Error).message));
  assert.throws(() => svgToRegion('<html><body/></html>'), /does not look like an SVG/);
  assert.throws(() => svgToRegion('<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10" fill="#fff"/></svg>'), /no printable shapes/);
});

test('SVG import handles fill-rule, transforms, arcs, relative paths and CSS classes', () => {
  const evenOdd = svgToRegion('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path fill-rule="evenodd" d="M0 0H100V100H0Z M30 30H70V70H30Z"/></svg>');
  assert.equal(evenOdd.region.length, 1);
  assert.equal(holesIn(evenOdd.region), 1);
  const css = svgToRegion('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><style>.a{fill:#222}.b{fill:#fff}</style><g transform="translate(10 10) scale(2)"><circle class="a" cx="20" cy="20" r="20"/><circle class="b" cx="20" cy="20" r="8"/></g></svg>');
  assert.equal(css.region.length, 1);
  assert.equal(holesIn(css.region), 1, 'white circle carves a hole');
  const arc = svgToRegion('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="m10 50 a40 40 0 1 1 80 0 a40 40 0 1 1 -80 0z"/></svg>');
  // two 180-degree arcs make a circle of radius 40, normalised so its 80-unit width becomes 100
  near(regionArea(arc.region), Math.PI * 50 * 50, 15, 'arc circle area');
});

test('SVG strokes become real outlines', () => {
  const r = svgToRegion('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M10 50 H90" stroke="#000" stroke-width="10" stroke-linecap="round" fill="none"/></svg>');
  assert.equal(r.region.length, 1);
  const b = regionBounds(r.region)!;
  // length 80 + two 5-radius caps = 90 wide, 10 tall
  near((b.maxX - b.minX) / (b.maxY - b.minY), 9, 0.2);
});

test('raster tracing: ring with a hole plus a separate dot', () => {
  const ras = makeRaster(200, 200, (x, y) => {
    const d = Math.hypot(x - 100, y - 100);
    if (d > 40 && d < 70) return 0;
    if (Math.hypot(x - 30, y - 30) < 10) return 0;
    return 255;
  });
  const r = traceRaster(ras.data, 200, 200, {
    mode: 'dark', autoThreshold: true, threshold: 128, contrast: 0, smoothing: 1, simplify: 0.5, minFeature: 12, bgTolerance: 28,
  });
  assert.equal(r.region.length, 2, 'ring + dot');
  assert.equal(holesIn(r.region), 1, 'ring has one hole');
  near(regionArea(r.region), Math.PI * (70 * 70 - 40 * 40) + Math.PI * 100, 700, 'area');
  assert.equal(r.warnings.length, 0, r.warnings.join());
});

test('raster tracing removes specks and warns when nothing is found', () => {
  const noise = makeRaster(120, 120, (x, y) => ((x * 7 + y * 13) % 97 === 0 ? 0 : 255));
  const r = traceRaster(noise.data, 120, 120, {
    mode: 'dark', autoThreshold: false, threshold: 128, contrast: 0, smoothing: 0, simplify: 0.5, minFeature: 12, bgTolerance: 28,
  });
  assert.equal(r.region.length, 0);
  assert.ok(r.warnings.length > 0);
});

test('PNG/JPG illustration flows through the same pipeline as SVG', async () => {
  const ras = makeRaster(260, 160, (x, y) => {
    const inEllipse = ((x - 130) / 100) ** 2 + ((y - 80) / 55) ** 2 < 1;
    const inEye = Math.hypot(x - 95, y - 65) < 14;
    return inEllipse && !inEye ? 20 : 250;
  });
  const m = await buildFlashcardModel(testCard({ image: rasterImage() }), nodeDeps(async () => ras));
  assert.equal(m.blocking, false, JSON.stringify(m.issues));
  assert.ok(m.validation.closedManifold, m.validation.messages.join('; '));
  assert.ok(m.parts.some((p) => p.role === 'image' && p.positions.length > 0));
  assert.ok(m.imageInfo && /Raster 260x160/.test(m.imageInfo));
});

test('a failing illustration is reported, blocks export and is never replaced by a fake shape', async () => {
  const bad = svgImage('<svg xmlns="http://www.w3.org/2000/svg"><text>hi</text></svg>');
  const m = await buildFlashcardModel(testCard({ image: bad }), nodeDeps());
  assert.equal(m.blocking, true);
  const issue = m.issues.find((i) => i.code === 'image-failed');
  assert.ok(issue && /live text/.test(issue.message));
  assert.ok(!m.parts.some((p) => p.role === 'image'), 'no substitute geometry');
});

test('invalid dimensions are rejected with a clear message', async () => {
  const c = testCard();
  c.dimensions.width = -5;
  await assert.rejects(() => buildFlashcardModel(c, nodeDeps()), (e: unknown) => e instanceof ModelError && /Width/.test((e as Error).message));
  const c2 = testCard();
  c2.dimensions.thickness = 0;
  await assert.rejects(() => buildFlashcardModel(c2, nodeDeps()), /Thickness/);
});

test('hole too close to the edge is a blocking error; overlap with text is a warning', async () => {
  const edge = testCard();
  edge.holeSettings.x = 1;
  edge.holeSettings.y = 1;
  const m1 = await buildFlashcardModel(edge, nodeDeps());
  assert.equal(m1.blocking, true);
  assert.ok(m1.issues.some((i) => i.code === 'hole-edge'));

  const overlap = testCard();
  overlap.holeSettings.x = 40;
  overlap.holeSettings.y = 24; // in the middle of "Aa"
  overlap.holeSettings.diameter = 6;
  const m2 = await buildFlashcardModel(overlap, nodeDeps());
  assert.equal(m2.blocking, false);
  assert.ok(m2.issues.some((i) => i.code === 'hole-collision'), JSON.stringify(m2.issues));
  assert.ok(m2.validation.closedManifold, 'trimmed around the hole, still closed');
});

test('over-wide text is scaled to fit and reported; missing glyphs are skipped and reported', async () => {
  const c = testCard({ alphabet: 'WWWWWW', word: 'ant\u2605' });
  const m = await buildFlashcardModel(c, nodeDeps());
  assert.ok(m.issues.some((i) => i.code === 'text-fit'));
  assert.ok(m.issues.some((i) => i.code === 'missing-glyph'));
  const a = m.placements.alphabet!;
  assert.ok(a.minX >= -40 && a.maxX <= 40);
  assert.ok(m.validation.closedManifold);
});

test('every font in the registry loads and produces closed solids', async () => {
  for (const fontId of ['poppins-bold', 'lilita-one', 'comic-neue-bold']) {
    const c = testCard();
    c.textSettings.fontId = fontId;
    const m = await buildFlashcardModel(c, nodeDeps());
    assert.ok(m.validation.closedManifold, `${fontId}: ${m.validation.messages.join('; ')}`);
    assert.ok(m.placements.alphabet && m.placements.word, `${fontId} placed text`);
  }
});

test('STL round trip: exported bytes describe exactly the previewed geometry', async () => {
  const c = testCard({ image: svgImage(antSvg()) });
  const m = await buildFlashcardModel(c, nodeDeps());
  const positions = mergeParts(m.parts);
  const buf = positionsToStl(positions);
  assert.equal(buf.byteLength, 84 + 50 * (positions.length / 9));
  const header = new TextDecoder().decode(new Uint8Array(buf, 0, 5));
  assert.notEqual(header.toLowerCase(), 'solid', 'binary STL must not start with "solid"');
  const report = analyzeStl(buf);
  assert.ok(report.validation.closedManifold);
  assert.equal(report.validation.triangles, m.validation.triangles);
  for (let k = 0; k < 3; k++) near(report.validation.size[k], m.validation.size[k], 1e-4);
  const back = stlToPositions(buf);
  assert.equal(back.length, positions.length);
  for (let i = 0; i < back.length; i += 997) assert.equal(back[i], positions[i]);
});

test('validator detects open meshes and inverted meshes', () => {
  const open = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const v = validatePositions(open);
  assert.equal(v.status, 'error');
  assert.equal(v.boundaryEdges, 3);
  // tetrahedron, correct orientation
  const a = [0, 0, 0], b = [1, 0, 0], c = [0, 1, 0], d = [0, 0, 1];
  const tet = (tris: number[][][]) => new Float32Array(tris.flat(2));
  const good = tet([[a, c, b], [a, b, d], [b, c, d], [c, a, d]]);
  assert.equal(validatePositions(good).closedManifold, true);
  assert.ok(validatePositions(good).volume > 0);
  const inverted = tet([[a, b, c], [a, d, b], [b, d, c], [c, d, a]]);
  assert.equal(validatePositions(inverted).status, 'error');
});

test('file names follow Letter_word.stl', () => {
  assert.equal(stlFileName('Aa', 'ant'), 'A_ant.stl');
  assert.equal(stlFileName('Bb', 'Ball'), 'B_ball.stl');
  assert.equal(stlFileName('Ii', 'Ice cream'), 'I_ice-cream.stl');
  assert.equal(stlFileName('', ''), 'CARD.stl');
});
