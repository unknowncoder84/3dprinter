/**
 * End-to-end tests for 3D Flashcard Studio. Drives the real UI in Microsoft Edge (software
 * WebGL), downloads real files, and verifies them with independent code (three.js STLLoader,
 * a separate topology checker, JSZip, pixel analysis of screenshots).
 *
 *   node tests/e2e/run.mjs            run everything
 *   ONLY="hole" node tests/e2e/run.mjs   run tests whose name contains "hole"
 */
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { PNG } from 'pngjs';
import { BASE_URL, launch, openApp, outDir, root, shot } from './lib.mjs';
import { checkTopology, darkFraction, darkMask, iou, loadWithThree, makeHelpers, readPng, sleep, wallTriangles, zIntersections } from './helpers.mjs';

const ANT = path.join(root, 'public', 'samples', 'ant.svg');
const BALL = path.join(root, 'public', 'samples', 'ball.svg');
const assetsDir = path.join(outDir, 'assets');
fs.mkdirSync(assetsDir, { recursive: true });

// ------------------------------------------------------------------ tiny test framework
const ONLY = process.env.ONLY?.toLowerCase();
const results = [];
let problems = [];
async function test(name, fn) {
  if (ONLY && !name.toLowerCase().includes(ONLY)) return;
  const t0 = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - t0 });
    console.log(`PASS  ${name}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  } catch (e) {
    results.push({ name, ok: false, ms: Date.now() - t0, error: e.message });
    console.log(`FAIL  ${name}\n      ${String(e.message).split('\n').join('\n      ')}`);
  }
}
const ok = (cond, msg) => { if (!cond) throw new Error(msg); };
const near = (a, b, tol, msg) => ok(Math.abs(a - b) <= tol, `${msg ?? 'value'}: expected ${b} ± ${tol}, got ${a}`);

// ------------------------------------------------------------------ generated test images
function writePng(name, w, h, fn) {
  const png = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [r, g, b, a = 255] = fn(x, y);
    const i = (w * y + x) * 4;
    png.data[i] = r; png.data[i + 1] = g; png.data[i + 2] = b; png.data[i + 3] = a;
  }
  const file = path.join(assetsDir, name);
  fs.writeFileSync(file, PNG.sync.write(png));
  return file;
}
const W = [255, 255, 255], K = [20, 20, 20];
const ballPng = writePng('ball.png', 320, 320, (x, y) => {
  const d = Math.hypot(x - 160, y - 160);
  if (d > 140) return W;
  if (Math.abs(x - 160) < 8 || Math.abs(y - 160) < 8 || d < 22) return W;
  return K;
});
let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const blobs = Array.from({ length: 90 }, () => ({ x: rnd() * 1600, y: rnd() * 1200, r: 14 + rnd() * 60 }));
const complexPng = writePng('complex.png', 1600, 1200, (x, y) => (blobs.some((b) => (x - b.x) ** 2 + (y - b.y) ** 2 < b.r * b.r) ? K : W));
const gradientPng = writePng('photo-like.png', 400, 300, (x, y) => { const v = Math.round(((x + y) / 700) * 255); return [v, v, v]; });
fs.writeFileSync(path.join(assetsDir, 'note.txt'), 'this is not an image');
fs.writeFileSync(path.join(assetsDir, 'fake.png'), 'definitely not a png, only named like one');
fs.writeFileSync(path.join(assetsDir, 'text.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40"><text x="5" y="30" font-size="30">Hi</text></svg>');
fs.writeFileSync(path.join(assetsDir, 'huge.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><!--' + 'x'.repeat(11 * 1024 * 1024) + '--><circle r="5"/></svg>');

// ------------------------------------------------------------------ session
const { browser, context, page, problems: pageProblems } = await launch();
problems = pageProblems;
const H = makeHelpers(page);

const openSection = async (id) => {
  const sec = page.locator(`[data-testid="${id}"]`);
  const btn = sec.locator('> button');
  if ((await btn.getAttribute('aria-expanded')) !== 'true') await btn.click();
};
const chipCount = () => page.locator('[data-testid="card-chip"]').count();
const alphabetValue = () => page.inputValue('[data-testid="alphabet-input"]');
const wordValue = () => page.inputValue('[data-testid="word-input"]');
const setText = async (id, v) => { await page.fill(`[data-testid="${id}"]`, v); };
const upload = async (file) => { await page.setInputFiles('[data-testid="image-input"]', file); };
const toggleHole = async (on) => {
  const sw = page.locator('[data-testid="hole-enabled"]');
  await sw.scrollIntoViewIfNeeded();
  if (((await sw.getAttribute('aria-checked')) === 'true') !== on) await sw.click();
};
const presetActive = (p) => page.getAttribute(`[data-testid="hole-preset-${p}"]`, 'aria-pressed');
const reloadApp = async () => { await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForSelector('[data-testid="viewer"]', { timeout: 60000 }); await H.waitReady(); };

try {
  await openApp(page);

  // ================================================================ TEST 1
  await test('T01 app opens without runtime errors; default Aa / ant card is generated', async () => {
    ok((await page.title()).includes('3D Flashcard Studio'), 'title');
    ok((await alphabetValue()) === 'Aa', 'default alphabet is Aa');
    ok((await wordValue()) === 'ant', 'default word is ant');
    ok((await chipCount()) === 1, 'one card');
    const tri = Number(await page.getAttribute('[data-testid="geometry-status"] [data-state="ready"]', 'data-triangles'));
    ok(tri > 500, `triangles generated (${tri})`);
    const dimsText = await page.textContent('[data-testid="model-dimensions"]');
    ok(/80 \u00d7 100 \u00d7 4\.6 mm/.test(dimsText), `dimensions readout: ${dimsText}`);
    // text corruption guard: no replacement characters anywhere in the rendered page
    const bodyText = await page.evaluate(() => document.body.innerText);
    ok(!bodyText.includes('\ufffd'), 'no corrupted (replacement) characters in the page text');
    ok(/Geometry ready \u00b7 [\d,]+ triangles/.test(bodyText), 'status chip text is intact');
    ok(problems.length === 0, `no console/page errors so far: ${JSON.stringify(problems)}`);
    await shot(page, 't01-default.png');
  });

  // ================================================================ TEST 2
  await test('T02 Aa + ant illustration + ant are visible in the 3D preview and exist as real geometry', async () => {
    await upload(ANT);
    await page.waitForSelector('[data-testid="image-preview"]');
    await H.waitReady();
    await H.frontView();
    await sleep(500);
    const file = await shot(page, 't02-aa-ant.png');
    const png = readPng(file);
    const r = await H.cardRectOnScreen();
    const band = (a, b) => ({ x: r.x + r.w * 0.1, y: r.y + r.h * a, w: r.w * 0.8, h: r.h * (b - a) });
    const fa = darkFraction(png, band(0.15, 0.38));
    const fi = darkFraction(png, band(0.44, 0.7));
    const fw = darkFraction(png, band(0.8, 0.9));
    const gap = darkFraction(png, band(0.405, 0.425));
    console.log(`      dark ink: alphabet ${fa.toFixed(2)}, illustration ${fi.toFixed(2)}, word ${fw.toFixed(2)}, gap ${gap.toFixed(3)}`);
    ok(fa > 0.18, 'alphabet band shows dark letters');
    ok(fi > 0.12, 'illustration band shows the dark ant');
    ok(fw > 0.12, 'word band shows dark letters');
    ok(gap < 0.06, 'alphabet and illustration do not overlap');
    // card is white and fully inside the canvas (nothing cropped)
    const box = await H.canvasBox();
    ok(r.x > box.x && r.y > box.y && r.x + r.w < box.x + box.width && r.y + r.h < box.y + box.height, 'entire card is inside the viewport');
    ok(r.h > box.height * 0.6, `card is large enough (${Math.round((r.h / box.height) * 100)}% of the viewport height)`);

    // the same content is in the exported geometry
    const exp = await H.exportStl('t02-A_ant.stl');
    ok(exp.suggested === 'A_ant.stl', `file name ${exp.suggested}`);
    const three = loadWithThree(exp.buffer);
    near(three.size[0], 80, 0.02, 'STL width'); near(three.size[1], 100, 0.02, 'STL height'); near(three.size[2], 4.6, 0.02, 'STL max z');
    const topo = checkTopology(three.positions);
    ok(topo.watertight, `independent topology check: open=${topo.open} nonManifold=${topo.nonManifold} orient=${topo.badOrientation}`);
    ok(topo.volume > 0, 'positive volume');
    ok(topo.components === 1, `${topo.components} piece(s)`);
    // distinct raised levels: alphabet 3+1.6, word and illustration 3+1.2
    const zs = new Set(); for (let i = 2; i < three.positions.length; i += 3) zs.add(Math.round(three.positions[i] * 1000) / 1000);
    ok(zs.has(4.6) && zs.has(4.2) && zs.has(3) && zs.has(0), `z levels ${[...zs].join(',')}`);
    ok(three.triangles > 2500, `triangles ${three.triangles}`);
  });

  // ================================================================ TEST 3
  await test('T03 replacing alphabet, word and image removes the old content completely', async () => {
    await setText('alphabet-input', 'Bb');
    await setText('word-input', 'ball');
    await upload(BALL);
    await sleep(500);
    await H.waitReady();
    await H.frontView(); await sleep(500);
    const replaced = readPng(await shot(page, 't03-replaced-Bb-ball.png'));
    const r1 = await H.cardRectOnScreen();

    // reference: a brand-new browser context where Bb/ball/ball.svg were entered from scratch
    const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const p2 = await ctx2.newPage();
    const h2 = makeHelpers(p2);
    await p2.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await p2.waitForSelector('[data-testid="viewer"]');
    await h2.waitReady();
    await p2.fill('[data-testid="alphabet-input"]', 'Bb');
    await p2.fill('[data-testid="word-input"]', 'ball');
    await p2.setInputFiles('[data-testid="image-input"]', BALL);
    await p2.waitForSelector('[data-testid="image-preview"]');
    await sleep(500);
    await h2.waitReady();
    await h2.frontView(); await sleep(500);
    const fresh = readPng(await (async () => { const f = path.join(outDir, 't03-fresh-Bb-ball.png'); await p2.screenshot({ path: f }); return f; })());
    const r2 = await h2.cardRectOnScreen();
    await ctx2.close();

    const m1 = darkMask(replaced, { x: r1.x + 4, y: r1.y + 4, w: r1.w - 8, h: r1.h - 8 });
    const m2 = darkMask(fresh, { x: r2.x + 4, y: r2.y + 4, w: Math.floor(r1.w - 8), h: Math.floor(r1.h - 8) });
    const sim = iou(m1, m2);
    console.log(`      replaced-vs-fresh render similarity (IoU of dark pixels): ${sim.toFixed(3)}`);
    ok(sim > 0.93, `the replaced card is identical to a fresh Bb/ball card (IoU ${sim.toFixed(3)})`);

    // and it is clearly different from the earlier Aa/ant render
    const old = readPng(path.join(outDir, 't02-aa-ant.png'));
    const m0 = darkMask(old, { x: r1.x + 4, y: r1.y + 4, w: r1.w - 8, h: r1.h - 8 });
    ok(iou(m0, m1) < 0.6, `Aa/ant and Bb/ball renders differ (IoU ${iou(m0, m1).toFixed(2)})`);

    const exp = await H.exportStl('t03-B_ball.stl');
    ok(exp.suggested === 'B_ball.stl', exp.suggested);
    const t = loadWithThree(exp.buffer);
    ok(checkTopology(t.positions).watertight, 'B_ball.stl is watertight');
  });

  // ================================================================ TEST 4
  await test('T04 hole placement by clicking: presets, corners, custom position map to real millimetres and real openings', async () => {
    await H.setField('dim-width', 80); await H.setField('dim-height', 100);
    await toggleHole(true);
    await H.waitReady();
    const cases = [
      { name: 'top-left (click)', click: [7, 7], expect: [7, 7], preset: 'top-left' },
      { name: 'top-right (preset)', preset: 'top-right', expect: [73, 7] },
      { name: 'bottom-left (preset)', preset: 'bottom-left', expect: [7, 93] },
      { name: 'bottom-right (click)', click: [73, 93], expect: [73, 93], preset: 'bottom-right' },
      { name: 'custom (click)', click: [66, 90], expect: [66, 90], preset: 'custom' },
    ];
    for (const c of cases) {
      if (c.click) await H.clickHoleCanvas(...c.click);
      else await page.click(`[data-testid="hole-preset-${c.preset}"]`);
      await sleep(150);
      const hole = await H.hole();
      near(hole.x, c.expect[0], 0.05, `${c.name} x`); near(hole.y, c.expect[1], 0.05, `${c.name} y`);
      ok((await presetActive(c.preset)) === 'true', `${c.name}: preset "${c.preset}" is highlighted`);
      await H.waitReady();
      const exp = await H.exportStl(`t04-${c.name.replace(/\W+/g, '-')}.stl`);
      const t = loadWithThree(exp.buffer);
      const cx = c.expect[0] - 40, cy = 50 - c.expect[1];
      ok(zIntersections(t.positions, cx + 0.0137, cy + 0.0071) === 0, `${c.name}: a vertical ray through (${cx}, ${cy}) passes straight through the card`);
      ok(zIntersections(t.positions, cx + 3.4, cy + 0.0071) >= 2 || Math.abs(cx + 3.4) > 40, `${c.name}: solid material 3.4 mm from the centre`);
      near(wallTriangles(t.positions, cx, cy), 112, 0, `${c.name}: cylinder wall triangles`);
      ok(checkTopology(t.positions).watertight, `${c.name}: watertight`);
      console.log(`      ${c.name}: UI ${hole.x},${hole.y} mm -> STL hole at (${cx}, ${cy}) with ${wallTriangles(t.positions, cx, cy)} wall triangles`);
    }
    await shot(page, 't04-hole-custom.png');
  });

  await test('T04b clicks that are too close to the edge are moved to a valid spot and say so', async () => {
    await H.clickHoleCanvas(1, 1);
    const hole = await H.hole();
    const note = await page.textContent('[data-testid="hole-note"]');
    ok(/nearest valid spot/.test(note), `note shown: ${note}`);
    const readout = await page.textContent('[data-testid="hole-readout"]');
    const wall = Number(/([\d.]+) mm to edge/.exec(readout)?.[1]);
    ok(wall >= 1.5 - 0.06, `at least 1.5 mm of material remains (${wall})`);
    ok(hole.x > 3 && hole.y > 3, `hole moved inwards: ${hole.x},${hole.y}`);
    await H.waitReady();
    ok((await page.locator('[data-testid="geometry-status"] [data-state="ready"]').count()) === 1, 'geometry stays valid');
    // typing an impossible value is rejected inline instead of breaking the model
    await H.setField('hole-diameter', 500);
    ok((await page.locator('[data-testid="hole-diameter"]').getAttribute('aria-invalid')) === 'true', 'invalid diameter flagged');
    await page.click('[data-testid="hole-reset"]');
    ok(await H.until(async () => (await presetActive('top-left')) === 'true'), 'reset returns to Top Left');
    const back = await H.hole();
    ok(back.x === 7 && back.y === 7, `reset position is 7,7 (${back.x},${back.y})`);
    ok((await page.inputValue('[data-testid="hole-diameter"]')) === '5', 'the rejected diameter never reached the model');
  });

  await test('T04c "Place on 3D view": clicking the 3D card moves the hole (and dragging only rotates)', async () => {
    await page.click('[data-testid="hole-place-3d"]');
    await page.waitForSelector('[data-testid="place-banner"]');
    await H.frontView(); await sleep(500);
    const c = await H.corners();
    const box = await H.canvasBox();
    const [tl, tr, br] = c;
    const at = (u, v) => ({ x: box.x + tl[0] + (tr[0] - tl[0]) * u + (br[0] - tr[0]) * v, y: box.y + tl[1] + (tr[1] - tl[1]) * u + (br[1] - tr[1]) * v });
    const p = at(60 / 80, 22 / 100); // 60 mm from left, 22 mm from top
    const before = await H.camera();
    await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x + 60, p.y + 20, { steps: 6 }); await page.mouse.up();
    await sleep(300);
    const afterDrag = await H.camera();
    ok(Math.abs(afterDrag[0] - before[0]) > 1, 'a drag rotated the camera');
    let hole = await H.hole();
    ok(!(Math.abs(hole.x - 60) < 2 && Math.abs(hole.y - 22) < 2), 'the drag did not move the hole');
    await H.frontView(); await sleep(500);
    const c2 = await H.corners();
    const [tl2, tr2, br2] = c2;
    const q = { x: box.x + tl2[0] + (tr2[0] - tl2[0]) * 0.75 + (br2[0] - tr2[0]) * 0.22, y: box.y + tl2[1] + (tr2[1] - tl2[1]) * 0.75 + (br2[1] - tr2[1]) * 0.22 };
    await page.mouse.click(q.x, q.y);
    await sleep(300);
    hole = await H.hole();
    near(hole.x, 60, 1.0, '3D click x'); near(hole.y, 22, 1.0, '3D click y');
    await page.click('[data-testid="hole-place-3d"]');
    ok((await page.locator('[data-testid="place-banner"]').count()) === 0, 'placement mode can be switched off');
    // with placement mode off a click does nothing to the hole
    await page.mouse.click(q.x - 40, q.y + 60);
    await sleep(200);
    const still = await H.hole();
    ok(still.x === hole.x && still.y === hole.y, 'ordinary clicks no longer move the hole');
  });

  // ================================================================ TEST 5
  await test('T05 disabling the hole removes the opening from the exported geometry', async () => {
    await page.click('[data-testid="hole-preset-top-left"]');
    await H.waitReady();
    const withHole = loadWithThree((await H.exportStl('t05-with-hole.stl')).buffer);
    ok(zIntersections(withHole.positions, -33 + 0.0137, 43 + 0.0071) === 0, 'opening exists while the hole is on');
    await toggleHole(false);
    await H.waitReady();
    const exp = await H.exportStl('t05-no-hole.stl');
    const t = loadWithThree(exp.buffer);
    ok(zIntersections(t.positions, -33 + 0.0137, 43 + 0.0071) === 2, 'solid material where the hole used to be');
    ok(wallTriangles(t.positions, -33, 43) === 0, 'no cylinder wall left');
    ok(checkTopology(t.positions).watertight, 'watertight without the hole');
    ok(topoVolume(t.positions) > topoVolume(withHole.positions) + 30, 'volume increased by the removed hole');
    ok((await page.locator('[data-testid="hole-canvas"] [data-testid="hole-marker"]').count()) === 0, 'no hole marker in the placement view');
    await toggleHole(true);
    await H.waitReady();
  });

  // ================================================================ TEST 6
  await test('T06 changing width, height and thickness changes the preview and the STL', async () => {
    await H.setField('dim-width', 90); await H.setField('dim-height', 120); await H.setField('dim-thickness', 4);
    await H.waitReady();
    await sleep(600);
    const txt = await page.textContent('[data-testid="model-dimensions"]');
    ok(/90 × 120 × 5\.6 mm/.test(txt), `dimension readout updated: ${txt}`);
    // the camera re-framed automatically: whole card visible
    const r = await H.cardRectOnScreen(); const box = await H.canvasBox();
    ok(r.x > box.x - 1 && r.y > box.y - 1 && r.x + r.w < box.x + box.width + 1 && r.y + r.h < box.y + box.height + 1, 'card still fully visible after resizing');
    near(r.w / r.h, 90 / 120, 0.1, 'on-screen aspect ratio follows the new size');
    const t = loadWithThree((await H.exportStl('t06-resized.stl')).buffer);
    near(t.size[0], 90, 0.02, 'width'); near(t.size[1], 120, 0.02, 'height'); near(t.size[2], 4 + 1.6, 0.02, 'thickness + relief');
    ok(checkTopology(t.positions).watertight, 'watertight');
    // invalid values are rejected without touching the model
    await H.setField('dim-width', 0);
    ok((await page.locator('[data-testid="dim-width"]').getAttribute('aria-invalid')) === 'true', 'zero width is flagged invalid');
    await page.locator('[data-testid="dim-width"]').blur();
    ok((await page.inputValue('[data-testid="dim-width"]')) === '90', 'invalid input reverts to the last valid value');
    await H.setField('dim-width', 80); await H.setField('dim-height', 100); await H.setField('dim-thickness', 3);
    await H.waitReady();
  });

  // ================================================================ TEST 7
  await test('T07 duplicating a card creates an independent copy', async () => {
    await setText('alphabet-input', 'Aa'); await setText('word-input', 'ant');
    await upload(ANT); await H.waitReady();
    const before = await chipCount();
    await page.click('[data-testid="duplicate-card"]');
    ok((await chipCount()) === before + 1, 'card count increased');
    ok((await alphabetValue()) === 'Aa' && (await wordValue()) === 'ant', 'copy has the same text');
    ok((await page.locator('[data-testid="image-preview"]').count()) === 1, 'copy has the illustration');
    await setText('word-input', 'ant copy'); await H.setField('dim-width', 95);
    const chips = page.locator('[data-testid="card-chip"]');
    await chips.nth(0).click(); await sleep(300);
    ok((await wordValue()) === 'ant', `original word unchanged (${await wordValue()})`);
    ok((await page.inputValue('[data-testid="dim-width"]')) === '80', 'original width unchanged');
    await chips.nth(1).click(); await sleep(300);
    ok((await wordValue()) === 'ant copy' && (await page.inputValue('[data-testid="dim-width"]')) === '95', 'duplicate kept its edits');
    // delete needs confirmation
    await page.click('[data-testid="delete-card"]');
    await page.click('[data-testid="confirm-cancel"]');
    ok((await chipCount()) === before + 1, 'cancelling keeps the card');
    await page.click('[data-testid="delete-card"]');
    await page.click('[data-testid="confirm-ok"]');
    ok((await chipCount()) === before, 'confirming deletes the card');
    ok((await alphabetValue()) === 'Aa', 'a neighbour card is selected afterwards');
  });

  // ================================================================ TEST 8
  await test('T08 save, browser reload (autosave) and load restore text, images, size and hole position', async () => {
    await page.click('[data-testid="new-card"]');
    await setText('alphabet-input', 'Bb'); await setText('word-input', 'ball');
    await upload(BALL); await H.waitReady();
    await H.setField('dim-width', 90);
    await H.clickHoleCanvas(70, 90);
    const hole = await H.hole();
    await page.locator('[data-testid="card-chip"]').nth(0).click();
    await H.setField('dim-height', 110);
    await page.click('[data-testid="save-project"]');
    await page.fill('[data-testid="project-name-input"]', 'My Alphabet');
    await page.click('[data-testid="save-confirm"]');
    await H.toast(/saved in this browser/);
    await sleep(1800); // autosave debounce

    await reloadApp();
    ok((await chipCount()) === 2, `autosave restored both cards after reload (${await chipCount()})`);
    await page.click('[data-testid="new-project"]');
    await sleep(500);
    ok((await chipCount()) === 1, 'new project starts with one card');
    await page.click('[data-testid="load-project"]');
    await page.waitForSelector('[data-testid="project-item"]');
    const names = await page.locator('[data-testid="project-item"]').allTextContents();
    ok(names.some((n) => n.includes('My Alphabet')), `saved project is listed (${names.map((n) => n.slice(0, 30)).join(' | ')})`);
    await page.locator('[data-testid="project-item"]', { hasText: 'My Alphabet' }).locator('[data-testid="project-open"]').click();
    await H.toast(/Loaded/);
    await sleep(600);
    ok((await chipCount()) === 2, 'two cards restored');
    const chips = page.locator('[data-testid="card-chip"]');
    ok((await chips.nth(0).textContent()).startsWith('Aa'), 'first card is Aa');
    ok((await page.locator('[data-testid="image-preview"]').count()) === 1, 'first card kept its illustration');
    ok((await page.inputValue('[data-testid="dim-height"]')) === '110', 'first card kept height 110');
    await chips.nth(1).click(); await sleep(400);
    ok((await alphabetValue()) === 'Bb' && (await wordValue()) === 'ball', 'second card text restored');
    ok((await page.inputValue('[data-testid="dim-width"]')) === '90', 'second card width restored');
    const h2 = await H.hole();
    near(h2.x, hole.x, 0.01, 'hole x restored'); near(h2.y, hole.y, 0.01, 'hole y restored');
    ok((await page.locator('[data-testid="image-name"]').textContent()) === 'ball.svg', 'second card illustration restored');
    await H.waitReady();
    ok((await page.locator('[data-testid="image-info"]').count()) === 1, 'restored illustration converts to geometry');
  });

  // ================================================================ TEST 9
  await test('T09 export project to a file, import it again; bad / foreign / newer files are rejected', async () => {
    const dl = page.waitForEvent('download');
    await page.click('[data-testid="export-project"]');
    const d = await dl;
    const file = path.join(outDir, d.suggestedFilename());
    await d.saveAs(file);
    ok(/\.flashcards\.json$/.test(d.suggestedFilename()), `file name ${d.suggestedFilename()}`);
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    ok(json.format === 'flashcard-studio-project' && json.version === 2 && json.units === 'mm', 'documented format fields');
    ok(json.cards.length === 2 && json.cards.every((c) => c.image?.dataUrl?.startsWith('data:image/')), 'cards include their illustrations');
    ok(json.cards[1].holeSettings.x > 60, 'hole coordinates saved');

    // make a change, then import: must ask before replacing unsaved work
    await page.click('[data-testid="delete-card"]'); await page.click('[data-testid="confirm-ok"]');
    ok((await chipCount()) === 1, 'one card left');
    await page.setInputFiles('[data-testid="import-input"]', file);
    await page.waitForSelector('[data-testid="confirm-dialog"]');
    await page.click('[data-testid="confirm-cancel"]');
    ok((await chipCount()) === 1, 'cancel keeps the current work');
    await page.setInputFiles('[data-testid="import-input"]', file);
    await page.waitForSelector('[data-testid="confirm-dialog"]');
    await page.click('[data-testid="confirm-ok"]');
    await H.toast(/Imported/);
    ok((await chipCount()) === 2, 'import restored both cards');
    await page.locator('[data-testid="card-chip"]').nth(0).click(); await sleep(300);
    ok((await page.inputValue('[data-testid="dim-height"]')) === '110', 'settings restored');
    ok((await page.locator('[data-testid="image-preview"]').count()) === 1, 'illustration restored');

    const bad = [
      ['not-json.json', '{this is not json', /not valid JSON/],
      ['foreign.json', JSON.stringify({ format: 'something-else', version: 2, cards: [{}] }), /not a Flashcard Studio project/],
      ['newer.json', JSON.stringify({ format: 'flashcard-studio-project', version: 99, cards: [{}] }), /newer version/],
      ['no-cards.json', JSON.stringify({ format: 'flashcard-studio-project', version: 2, cards: [] }), /no cards/],
    ];
    for (const [name, content, re] of bad) {
      const f = path.join(assetsDir, name);
      fs.writeFileSync(f, content);
      await page.setInputFiles('[data-testid="import-input"]', f);
      await sleep(500);
      const t = await H.lastToast();
      ok(t && t.kind === 'error' && re.test(t.text), `${name}: rejected with "${t?.text}"`);
      ok((await chipCount()) === 2, `${name}: current project untouched`);
    }
  });

  await test('T09b projects from the first prototype (schema v1) still import', async () => {
    const v1 = {
      version: '1.0', createdAt: 1, updatedAt: 1,
      cards: [{ id: '1', alphabet: 'Cc', word: 'cat', image: null,
        dimensions: { width: 80, height: 100, thickness: 3, cornerRadius: 8 },
        textSettings: { alphabetSize: 24, wordSize: 12, alphabetHeight: 2, wordHeight: 1.5, fontFamily: 'Arial', alphabetY: 15, wordY: 15 },
        imageSettings: { width: 40, height: 40, reliefHeight: 1.5, centerY: 50 },
        holeSettings: { enabled: true, diameter: 5, position: 'top-right', customX: 10, customY: 10 },
        geometrySettings: { textDepth: 2, imageDepth: 1.5, quality: 'medium' } }],
    };
    const f = path.join(assetsDir, 'legacy-v1.json');
    fs.writeFileSync(f, JSON.stringify(v1));
    await page.setInputFiles('[data-testid="import-input"]', f);
    const confirmOk = page.locator('[data-testid="confirm-ok"]');
    try { await confirmOk.waitFor({ state: 'visible', timeout: 1200 }); await confirmOk.click(); } catch { /* nothing unsaved, no prompt */ }
    await H.toast(/earlier version/);
    ok((await alphabetValue()) === 'Cc' && (await wordValue()) === 'cat', 'legacy text imported');
    await H.waitReady();
    ok((await presetActive('top-right')) === 'true', 'legacy hole position imported');
  });

  // ================================================================ TEST 11 / 12
  await test('T11 Generate A–Z creates 26 cards once and never overwrites custom cards', async () => {
    await page.click('[data-testid="new-project"]');
    const dirty = page.locator('[data-testid="confirm-ok"]');
    try { await dirty.waitFor({ state: 'visible', timeout: 800 }); await dirty.click(); } catch { /* not dirty */ }
    await sleep(400);
    await upload(ANT); await H.waitReady();
    await H.setField('dim-width', 85); // the template for new cards
    await page.click('[data-testid="generate-az"]');
    await H.toast(/Added 25 cards/);
    ok((await chipCount()) === 26, `26 cards (${await chipCount()})`);
    const labels = (await page.locator('[data-testid="card-chip"]').allTextContents()).map((s) => s.trim().slice(0, 2));
    ok(labels.join(',') === 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((l) => l + l.toLowerCase()).join(','), `A–Z order: ${labels.join(' ')}`);
    ok((await page.textContent('[data-testid="image-count"]')).startsWith('1/26'), 'only the first card has an illustration; the others are marked as needing one');
    // new cards use the selected card's settings but their own letters / words
    await page.locator('[data-testid="card-chip"]').nth(25).click(); await sleep(300);
    ok((await alphabetValue()) === 'Zz' && (await wordValue()) === 'zebra', 'default pair Z - zebra');
    ok((await page.inputValue('[data-testid="dim-width"]')) === '85', 'new cards inherit the template card width');
    ok((await page.locator('[data-testid="needs-image"]').count()) === 1, '"needs an illustration" is shown on a card without one');
    // custom edit survives a second press
    await page.locator('[data-testid="card-chip"]').nth(2).click(); await sleep(200);
    await setText('word-input', 'cow');
    await page.click('[data-testid="generate-az"]');
    await H.toast(/All 26 letters/);
    ok((await chipCount()) === 26, 'no duplicates created');
    await page.locator('[data-testid="card-chip"]').nth(2).click(); await sleep(200);
    ok((await wordValue()) === 'cow', 'custom word kept');
    // delete a card, regenerate: only that one comes back, in place
    await page.locator('[data-testid="card-chip"]').nth(12).click(); await sleep(200);
    await page.click('[data-testid="delete-card"]'); await page.click('[data-testid="confirm-ok"]');
    ok((await chipCount()) === 25, '25 after delete');
    await page.click('[data-testid="generate-az"]');
    await H.toast(/Added 1 card \(M\)/);
    ok((await chipCount()) === 26, 'only the missing M was added');
    ok((await page.locator('[data-testid="card-chip"]').nth(12).textContent()).startsWith('Mm'), 'M is back in alphabetical position');
    ok((await page.locator('[data-testid="card-chip"]').nth(2).textContent()).startsWith('Cc'), 'C untouched');
  });

  await test('T11b "Apply settings to cards" copies chosen settings without touching letters, words or images', async () => {
    await page.locator('[data-testid="card-chip"]').nth(0).click(); await sleep(300);
    await H.setField('dim-height', 105);
    await page.click('[data-testid="apply-settings"]');
    await page.waitForSelector('[data-testid="apply-dialog"]');
    await page.uncheck('[data-testid="apply-group-hole"]');
    await page.click('[data-testid="apply-confirm"]');
    await H.toast(/Settings applied to 25/);
    await page.locator('[data-testid="card-chip"]').nth(7).click(); await sleep(300);
    ok((await page.inputValue('[data-testid="dim-height"]')) === '105', 'dimensions copied');
    ok((await alphabetValue()) === 'Hh' && (await wordValue()) === 'house', 'text untouched');
    await page.locator('[data-testid="card-chip"]').nth(0).click(); await sleep(300);
    ok((await page.locator('[data-testid="image-preview"]').count()) === 1, 'source card keeps its image');
  });

  // ================================================================ TEST 10 / 17 / 18
  await test('T10 ZIP export of all 26 cards contains correctly named, valid STL files; a failing card is reported and skipped', async () => {
    // make card B fail: an SVG that cannot be converted
    await page.locator('[data-testid="card-chip"]').nth(1).click(); await sleep(300);
    await upload(path.join(assetsDir, 'text.svg')); await sleep(600);
    ok((await page.locator('[data-testid="image-issue"]').count()) >= 1, 'conversion problem is shown on the card');
    const issue = await page.locator('[data-testid="image-issue"]').first().textContent();
    ok(/live text/.test(issue), `explains the problem: ${issue}`);
    ok(await page.locator('[data-testid="export-stl"]').isDisabled(), 'single export is blocked for the broken card');
    await page.click('[data-testid="export-zip"]');
    await page.waitForSelector('[data-testid="export-all-dialog"]');
    await page.click('[data-testid="batch-select-all"]');
    const dl = page.waitForEvent('download', { timeout: 240000 });
    await page.click('[data-testid="batch-start"]');
    await page.waitForSelector('[data-testid="batch-progress"]');
    const seenPhases = new Set();
    let maxCompleted = 0;
    const poll = setInterval(async () => {
      try {
        const s = await page.getAttribute('[data-testid="batch-progress"]', 'data-phase');
        if (s) seenPhases.add(s);
        const sum = await page.textContent('[data-testid="batch-summary"]');
        const m = /completed (\d+)/.exec(sum); if (m) maxCompleted = Math.max(maxCompleted, Number(m[1]));
      } catch { /* dialog closed */ }
    }, 250);
    const d = await dl;
    clearInterval(poll);
    const zipFile = path.join(outDir, 't10.zip');
    await d.saveAs(zipFile);
    await page.waitForFunction(() => document.querySelector('[data-testid="batch-progress"]')?.getAttribute('data-phase') === 'finished', null, { timeout: 30000 });
    const summary = await page.textContent('[data-testid="batch-summary"]');
    console.log(`      ${summary}; progress phases seen: ${[...seenPhases].join(', ')}`);
    ok(/completed 25/.test(summary) && /failed 1/.test(summary), `summary: ${summary}`);
    const failedRows = await page.locator('[data-testid="batch-items"] li[data-status="failed"]').allTextContents();
    ok(failedRows.length === 1 && /Bb/.test(failedRows[0]) && /live text/.test(failedRows[0]), `failure reported with its reason: ${failedRows[0]}`);

    const zip = await JSZip.loadAsync(fs.readFileSync(zipFile));
    const names = Object.keys(zip.files).sort();
    const words = ['ant', 'ball', 'cow', 'dog', 'elephant', 'fish', 'goat', 'house', 'ice-cream', 'jug', 'kite', 'lion', 'mango', 'nest', 'orange', 'parrot', 'queen', 'rabbit', 'sun', 'tiger', 'umbrella', 'van', 'watch', 'xylophone', 'yak', 'zebra'];
    const expected = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((l, i) => `${l}_${words[i]}.stl`).filter((n) => n !== 'B_ball.stl').sort();
    ok(names.length === 25, `${names.length} files in the ZIP`);
    ok(JSON.stringify(names) === JSON.stringify(expected), `file names:\n${names.join(' ')}\nexpected:\n${expected.join(' ')}`);
    ok(!names.includes('B_ball.stl'), 'no file for the failed card');
    let bad = 0; let tri = 0;
    for (const n of names) {
      const buf = await zip.files[n].async('nodebuffer');
      ok(buf.length > 1000, `${n} is not empty (${buf.length} bytes)`);
      const t = loadWithThree(buf);
      const topo = checkTopology(t.positions);
      tri += t.triangles;
      near(t.size[0], 85, 0.03, `${n} width`);
      if (!topo.watertight || topo.volume <= 0) bad++;
    }
    ok(bad === 0, `${bad} of ${names.length} STL files are not watertight`);
    // the card with the illustration is the bigger file
    const a = await zip.files['A_ant.stl'].async('nodebuffer');
    const z = await zip.files['Z_zebra.stl'].async('nodebuffer');
    ok(a.length > z.length, 'A_ant.stl (with illustration) is larger than a text-only card');
    ok(seenPhases.has('generating') && maxCompleted >= 1, 'progress was reported while generating');
    await page.click('[data-testid="batch-close"]');
  });

  await test('T18 a card with an unconvertible image never produces a fake STL on its own either', async () => {
    ok(await page.locator('[data-testid="export-stl"]').isDisabled(), 'Generate STL is disabled for the broken card');
    const title = await page.getAttribute('[data-testid="export-stl"]', 'title');
    ok(/errors|status panel/.test(title), `explains why: ${title}`);
    await page.click('[data-testid="remove-image"]');
    await H.waitReady();
    ok(!(await page.locator('[data-testid="export-stl"]').isDisabled()), 'export works again once the image is removed');
  });

  // ================================================================ TEST 3b invalid images
  await test('T03b invalid and unsupported images give clear errors and never change the card', async () => {
    const cases = [
      ['note.txt', /not a supported image/],
      ['fake.png', /not a supported image/],
      ['huge.svg', /limit is 10 MB/],
    ];
    for (const [name, re] of cases) {
      await upload(path.join(assetsDir, name));
      await page.waitForSelector('[data-testid="image-error"]');
      const msg = await page.textContent('[data-testid="image-error"]');
      ok(re.test(msg), `${name}: ${msg}`);
      ok((await page.locator('[data-testid="image-preview"]').count()) === 0, `${name}: no image was attached`);
    }
    // a valid file clears the error
    await upload(BALL); await page.waitForSelector('[data-testid="image-preview"]');
    ok((await page.locator('[data-testid="image-error"]').count()) === 0, 'error cleared by a valid upload');
    // photo-like input: warns instead of pretending it is a clean conversion
    await upload(gradientPng); await H.waitReady();
    await openSection('section-image');
    const info = await page.locator('[data-testid="image-issue"]').allTextContents();
    console.log(`      photo-like PNG warnings: ${info.join(' | ') || '(none)'}`);
    ok(info.length >= 1, 'the user is warned that this image does not convert cleanly');
    await page.click('[data-testid="remove-image"]');
  });

  // ================================================================ raster conversion
  await test('T03c PNG conversion produces real geometry; threshold / mode controls change it', async () => {
    await upload(ballPng); await page.waitForSelector('[data-testid="image-preview"]'); await H.waitReady();
    await openSection('section-image');
    ok((await page.locator('[data-testid="raster-controls"]').count()) === 1, 'raster controls shown for PNG');
    const stl1 = loadWithThree((await H.exportStl('t03c-ball-png.stl')).buffer);
    ok(stl1.triangles > 1500, `triangles ${stl1.triangles}`);
    ok(checkTopology(stl1.positions).watertight, 'watertight');
    const info = await page.textContent('[data-testid="image-info"]');
    ok(/Raster 3\d\dx3\d\dpx/.test(info), info);
    // inverse mode raises the light areas instead
    await page.selectOption('[data-testid="image-mode"]', 'light'); await H.waitReady();
    const stl2 = loadWithThree((await H.exportStl('t03c-ball-png-light.stl')).buffer);
    ok(stl2.triangles !== stl1.triangles, 'light-ink mode produced different geometry');
    await page.selectOption('[data-testid="image-mode"]', 'dark');
    await H.waitReady();
    await page.click('[data-testid="image-auto-threshold"]'); // switch to manual
    await page.locator('[data-testid="image-threshold"]').fill('5'); await H.waitReady();
    const warn = await page.locator('[data-testid="image-issue"]').allTextContents();
    ok(warn.some((w) => /No shapes|Almost nothing/.test(w)), `a too-low threshold is reported: ${warn.join(' | ')}`);
    await page.click('[data-testid="image-auto-threshold"]');
    await H.waitReady();
    await page.click('[data-testid="remove-image"]');
  });

  await test('T19 a moderately complex illustration converts while the page stays responsive', async () => {
    // measure main-thread stalls while converting 1600x1200 with ~90 shapes
    await page.evaluate(() => {
      window.__gaps = [];
      let last = performance.now();
      window.__tick = setInterval(() => { const n = performance.now(); window.__gaps.push(n - last); last = n; }, 50);
    });
    const t0 = Date.now();
    await upload(complexPng);
    await page.waitForSelector('[data-testid="image-preview"]');
    await sleep(500);
    await H.waitReady(90000);
    const secs = (Date.now() - t0) / 1000;
    const gaps = await page.evaluate(() => { clearInterval(window.__tick); return window.__gaps; });
    const maxGap = Math.max(...gaps);
    const buildMs = await page.getAttribute('[data-testid="geometry-status"] [data-state="ready"]', 'data-build-ms');
    console.log(`      complex PNG ready in ${secs.toFixed(1)}s (geometry ${buildMs} ms), longest main-thread stall ${Math.round(maxGap)} ms`);
    ok(secs < 45, `converted in ${secs.toFixed(1)}s`);
    ok(maxGap < 4000, `UI never froze for more than 4 s (worst ${Math.round(maxGap)} ms)`);
    const exp = await H.exportStl('t19-complex.stl');
    const t = loadWithThree(exp.buffer);
    ok(checkTopology(t.positions).watertight, `complex model watertight (${t.triangles} triangles)`);
    await shot(page, 't19-complex.png');
    await page.click('[data-testid="remove-image"]');
  });

  // ================================================================ text behaviour
  await test('T20 over-long words are fitted with a visible notice; unsupported characters are reported', async () => {
    await setText('word-input', 'supercalifragilisticexpialidocious');
    await H.waitReady(); await sleep(300);
    let issues = await page.locator('[data-testid="text-issue"]').allTextContents();
    ok(issues.some((t) => /scaled to \d+% to fit/.test(t)), `fit notice: ${issues.join(' | ')}`);
    await openSection('section-text');
    await page.click('[data-testid="text-autofit"]'); await H.waitReady();
    const panel = await page.locator('[data-testid="issue-list"]').textContent();
    ok(/trimmed/.test(panel), `trim warning without auto-fit: ${panel}`);
    await page.click('[data-testid="text-autofit"]');
    await setText('word-input', 'ant\u2605'); await H.waitReady();
    issues = await page.locator('[data-testid="text-issue"]').allTextContents();
    ok(issues.some((t) => /no glyph/.test(t)), `missing glyph notice: ${issues.join(' | ')}`);
    await setText('word-input', 'ant'); await H.waitReady();
  });

  await test('T21 changing the font changes the geometry', async () => {
    await H.frontView(); await sleep(400);
    const a = readPng(await shot(page, 't21-poppins.png'));
    const r = await H.cardRectOnScreen();
    await page.selectOption('[data-testid="font-select"]', 'lilita-one'); await H.waitReady(); await sleep(500);
    const b = readPng(await shot(page, 't21-lilita.png'));
    const rect = { x: r.x + 4, y: r.y + 4, w: r.w - 8, h: r.h - 8 };
    const sim = iou(darkMask(a, rect), darkMask(b, rect));
    ok(sim < 0.8, `font change visibly alters the lettering (IoU ${sim.toFixed(2)})`);
    await page.selectOption('[data-testid="font-select"]', 'poppins-bold'); await H.waitReady();
  });

  // ================================================================ camera
  await test('T14 camera controls: Front, Back, Side, Reset, Fit to view, zoom, mouse orbit / wheel / pan', async () => {
    await page.click('[data-testid="view-reset"]');
    await H.waitCamera((c) => c[0] > 20 && c[2] > 100);
    const def = await H.settledCamera();
    const tg = await H.target();
    const dist = (c, t) => Math.hypot(c[0] - t[0], c[1] - t[1], c[2] - t[2]);
    const front = await H.frontView();
    ok(front[2] > 100, 'front looks at the card face from +Z');
    await page.click('[data-testid="view-back"]');
    const back = await H.waitCamera((c) => c[2] < -50 && Math.abs(c[0]) < 0.5);
    await shot(page, 't14-back.png');
    await page.click('[data-testid="view-side"]');
    const side = await H.waitCamera((c) => c[0] > 50 && Math.abs(c[2] - 2.3) < 3);
    await page.click('[data-testid="view-reset"]');
    await H.waitCamera((c) => c[0] > 20 && c[2] > 100);
    const reset = await H.settledCamera();
    ok(Math.hypot(reset[0] - def[0], reset[1] - def[1], reset[2] - def[2]) < 0.5, `reset restores exactly the default view (${reset} vs ${def})`);
    // zoom buttons
    const d0 = dist(await H.camera(), tg);
    await page.click('[data-testid="zoom-in"]'); await sleep(250);
    const d1 = dist(await H.camera(), tg);
    ok(d1 < d0 * 0.9, `zoom in moved the camera closer (${d0.toFixed(0)} -> ${d1.toFixed(0)})`);
    await page.click('[data-testid="zoom-out"]'); await page.click('[data-testid="zoom-out"]'); await sleep(250);
    const d2 = dist(await H.camera(), tg);
    ok(d2 > d1 * 1.3, 'zoom out moved the camera away');
    await page.click('[data-testid="view-fit"]');
    await H.waitCamera((c) => Math.abs(dist(c, tg) - d0) < d0 * 0.15);
    // mouse: wheel, left-drag orbit, right-drag pan
    const box = await H.canvasBox();
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    const c0 = await H.camera();
    await page.mouse.move(cx, cy); await page.mouse.wheel(0, -500); await sleep(500);
    const c1 = await H.camera();
    ok(dist(c1, tg) < dist(c0, tg) - 5, 'mouse wheel zooms');
    await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx + 150, cy + 20, { steps: 8 }); await page.mouse.up(); await sleep(600);
    const c2 = await H.camera();
    ok(Math.hypot(c2[0] - c1[0], c2[2] - c1[2]) > 15, 'left-drag orbits');
    const t1 = await H.target();
    await page.mouse.move(cx, cy); await page.mouse.down({ button: 'right' }); await page.mouse.move(cx + 80, cy + 60, { steps: 8 }); await page.mouse.up({ button: 'right' }); await sleep(600);
    const t2 = await H.target();
    ok(Math.hypot(t2[0] - t1[0], t2[1] - t1[1], t2[2] - t1[2]) > 3, 'right-drag pans');
    ok(back[2] < 0 && side[0] > 0, 'back and side positions are on the expected sides');
  });

  await test('T22 selecting another card resets the view and never shows the previous card\'s geometry', async () => {
    await page.locator('[data-testid="card-chip"]').nth(25).click();
    await H.waitReady(); await sleep(600);
    const txt = await page.textContent('[data-testid="model-dimensions"]');
    ok(/85 × 105/.test(txt), `dimensions of the Zz card: ${txt}`);
    await H.frontView(); await sleep(400);
    const png = readPng(await shot(page, 't22-zz.png'));
    const r = await H.cardRectOnScreen();
    const band = (a, b) => ({ x: r.x + r.w * 0.1, y: r.y + r.h * a, w: r.w * 0.8, h: r.h * (b - a) });
    ok(darkFraction(png, band(0.15, 0.38)) > 0.1, 'Zz letters are drawn');
    ok(darkFraction(png, band(0.45, 0.7)) < 0.01, 'no illustration from another card is shown for the card without one');
  });

  // ================================================================ responsive / touch
  await test('T23 mobile: layout fits a phone screen and the hole can be placed by tapping', async () => {
    const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    const mp = await mctx.newPage();
    const mh = makeHelpers(mp);
    const mProblems = [];
    mp.on('pageerror', (e) => mProblems.push(e.message));
    await mp.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await mp.waitForSelector('[data-testid="viewer"]');
    await mh.waitReady();
    await mp.setInputFiles('[data-testid="image-input"]', ANT);
    await mp.waitForSelector('[data-testid="image-preview"]');
    await mh.waitReady();
    await sleep(700);
    const overflow = await mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok(overflow <= 1, `no horizontal page overflow (${overflow}px)`);
    const vb = await mp.locator('[data-testid="viewer"]').boundingBox();
    ok(vb.width >= 380 && vb.height >= 300, `3D preview is usable on a phone (${Math.round(vb.width)}x${Math.round(vb.height)})`);
    await mp.screenshot({ path: path.join(outDir, 't23-mobile-top.png') });
    // tap the hole canvas
    const canvas = mp.locator('[data-testid="hole-canvas"]');
    await canvas.scrollIntoViewIfNeeded();
    const pt = await canvas.evaluate((svg, [x, y]) => { const p = svg.createSVGPoint(); p.x = x; p.y = y; const s = p.matrixTransform(svg.getScreenCTM()); return { x: s.x, y: s.y }; }, [64, 88]);
    await mp.touchscreen.tap(pt.x, pt.y);
    await sleep(250);
    const hole = await mp.locator('[data-testid="hole-marker"]');
    near(Number(await hole.getAttribute('data-x')), 64, 0.1, 'tapped x'); near(Number(await hole.getAttribute('data-y')), 88, 0.1, 'tapped y');
    await mp.screenshot({ path: path.join(outDir, 't23-mobile-hole.png') });
    ok(mProblems.length === 0, `no page errors on mobile: ${mProblems.join(' | ')}`);
    await mctx.close();

    const tctx = await browser.newContext({ viewport: { width: 820, height: 1180 }, hasTouch: true });
    const tp = await tctx.newPage();
    await tp.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await tp.waitForSelector('[data-testid="viewer"]');
    await makeHelpers(tp).waitReady();
    ok((await tp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 1, 'tablet: no horizontal overflow');
    await tp.screenshot({ path: path.join(outDir, 't23-tablet.png') });
    await tctx.close();
  });

  await test('T25 obsolete GPU geometry is released: 40 edits do not leak buffers', async () => {
    await page.locator('[data-testid="card-chip"]').nth(0).click();
    await upload(ANT); await H.waitReady();
    await sleep(500);
    const base = (await H.gpu())[0];
    for (let i = 0; i < 40; i++) {
      await setText('word-input', 'w' + 'abcdefghijklmnopqrstuvwxyz'[i % 26] + i);
      await sleep(260);
    }
    await H.waitReady(); await sleep(600);
    const after = (await H.gpu())[0];
    console.log(`      GPU geometries: before ${base}, after 40 rebuilds ${after}`);
    ok(after <= base + 1, `geometry buffers stay constant (${base} -> ${after})`);
    await setText('word-input', 'ant'); await H.waitReady();
  });

  await test('T26 the latest edit always wins: rapid image / text changes never leave stale results', async () => {
    await setText('alphabet-input', 'Aa'); await setText('word-input', 'ant');
    // fire a slow conversion and immediately replace it
    await upload(complexPng);
    await upload(BALL);
    await sleep(300);
    await setText('word-input', 'x'); await setText('word-input', 'xy'); await setText('word-input', 'ant');
    await H.waitReady(); await sleep(400);
    const raced = loadWithThree((await H.exportStl('t26-raced.stl')).buffer);
    ok((await page.textContent('[data-testid="image-name"]')) === 'ball.svg', 'last uploaded image is attached');
    // a clean run of the same final state gives identical geometry
    await upload(ANT); await H.waitReady(); await upload(BALL); await H.waitReady(); await sleep(400);
    const clean = loadWithThree((await H.exportStl('t26-clean.stl')).buffer);
    ok(raced.triangles === clean.triangles, `racing edits produced the same model as a clean run (${raced.triangles} vs ${clean.triangles} triangles)`);
    await upload(ANT); await H.waitReady();
  });

  await test('T27 font failure: falls back to another bundled font with a notice; total failure shows a clear error', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
    const p = await ctx.newPage();
    const h = makeHelpers(p);
    await p.route('**/fonts/Poppins-Bold.ttf', (r) => r.abort());
    await p.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('[data-testid="viewer"]');
    await h.waitReady();
    const notice = (await p.locator('[data-testid="text-issue"]').allTextContents()).join(' ');
    ok(/could not be loaded/.test(notice) && /Using "/.test(notice), `fallback notice shown: ${notice}`);
    ok((await p.locator('[data-testid="export-stl"]').isEnabled()), 'export still possible with the fallback font');
    // now every font fails
    await p.route('**/fonts/*.ttf', (r) => r.abort());
    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForSelector('[data-testid="geometry-error"]', { timeout: 30000 });
    const err = await p.textContent('[data-testid="geometry-error"]');
    ok(/No font could be loaded/.test(err), `clear error: ${err}`);
    ok(await p.locator('[data-testid="export-stl"]').isDisabled(), 'export is blocked while the geometry cannot be generated');
    await p.unroute('**/fonts/*.ttf');
    await p.unroute('**/fonts/Poppins-Bold.ttf');
    await p.fill('[data-testid="word-input"]', 'cat'); // an edit triggers a retry
    await h.waitReady();
    ok((await p.locator('[data-testid="geometry-error"]').count()) === 0, 'recovers once the fonts are reachable again');
    await ctx.close();
  });

  await test('T28 storage full: saving reports the problem and never claims success', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const p = await ctx.newPage();
    const h = makeHelpers(p);
    await p.addInitScript(() => {
      const orig = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (...args) {
        if (window.__failPuts) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        return orig.apply(this, args);
      };
    });
    await p.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('[data-testid="viewer"]');
    await h.waitReady();
    await p.evaluate(() => { window.__failPuts = true; });
    await p.fill('[data-testid="word-input"]', 'bee');
    await p.click('[data-testid="save-project"]');
    await p.fill('[data-testid="project-name-input"]', 'Will not fit');
    await p.click('[data-testid="save-confirm"]');
    await h.toast(/Not saved/);
    const t = (await p.locator('[data-testid="toasts"] > div').allTextContents()).join(' | ');
    ok(/storage is full/i.test(t), `explains what to do: ${t}`);
    ok(!/saved in this browser/i.test(t), 'no success message');
    ok((await p.locator('[data-testid="save-dialog"]').count()) === 1, 'dialog stays open so the user can react');
    await p.waitForFunction(() => /backup failed/.test(document.querySelector('[data-testid="autosave-status"]')?.textContent || ''), null, { timeout: 8000 });
    // export-to-file still works as the fallback
    await p.click('[data-testid="save-dialog"] >> text=Cancel');
    const dl = p.waitForEvent('download');
    await p.click('[data-testid="export-project"]');
    ok((await dl).suggestedFilename().endsWith('.flashcards.json'), 'Export project still works when browser storage is full');
    await ctx.close();
  });

  await test('T29 no WebGL: clear message, editing and STL export keep working', async () => {
    const b2 = await (await import('playwright-core')).chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true, args: ['--disable-3d-apis', '--disable-webgl', '--disable-gpu'] });
    const ctx = await b2.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 800 } });
    const p = await ctx.newPage();
    await p.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('[data-testid="viewer"]');
    await p.waitForSelector('[data-testid="webgl-error"]', { timeout: 30000 });
    ok(/3D preview is not available/.test(await p.textContent('[data-testid="webgl-error"]')), 'explains the limitation');
    await makeHelpers(p).waitReady();
    const dl = p.waitForEvent('download', { timeout: 30000 });
    await p.click('[data-testid="export-stl"]');
    await p.click('[data-testid="confirm-ok"]'); // this card has no illustration: the app asks first
    const d = await dl;
    const file = path.join(outDir, 't29-no-webgl.stl');
    await d.saveAs(file);
    const t = loadWithThree(fs.readFileSync(file));
    ok(checkTopology(t.positions).watertight && t.size[0] > 79.9, 'STL export works without WebGL');
    await b2.close();
  });

  await test('T24 no console errors, page errors or failed requests during the whole session', async () => {
    // `problems` only collects events of the main page; the deliberate failure scenarios
    // (blocked fonts, full storage, no WebGL) run in their own browser contexts.
    ok(problems.length === 0, `problems: ${JSON.stringify(problems, null, 1)}`);
  });
} catch (e) {
  console.log('SUITE ABORTED', e.stack || e.message);
  await shot(page, 'suite-abort.png').catch(() => {});
} finally {
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} tests passed`);
  fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(results, null, 2));
  await Promise.race([browser.close(), sleep(8000)]);
  process.exit(passed === results.length ? 0 : 1);
}

function topoVolume(positions) { return checkTopology(positions).volume; }
