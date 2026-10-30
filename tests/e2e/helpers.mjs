import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { outDir } from './lib.mjs';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- independent STL checks
/** Parses with three.js's own STLLoader (an independent implementation) and returns facts. */
export function loadWithThree(buffer) {
  const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const geo = new STLLoader().parse(ab);
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const pos = geo.getAttribute('position');
  return {
    triangles: pos.count / 3,
    min: [bb.min.x, bb.min.y, bb.min.z],
    max: [bb.max.x, bb.max.y, bb.max.z],
    size: [bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z],
    positions: pos.array,
  };
}

/** Separate (re-implemented) topology check: welded edges, orientation, volume, components. */
export function checkTopology(positions) {
  const q = (v) => Math.round(v * 1000);
  const ids = new Map();
  const id = (x, y, z) => {
    const k = `${q(x)},${q(y)},${q(z)}`;
    if (!ids.has(k)) ids.set(k, ids.size);
    return ids.get(k);
  };
  const tris = positions.length / 9;
  const edge = new Map();
  let volume = 0;
  const parent = [];
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  const t = [];
  for (let i = 0; i < tris; i++) {
    const o = i * 9;
    const v = [0, 1, 2].map((k) => id(positions[o + k * 3], positions[o + k * 3 + 1], positions[o + k * 3 + 2]));
    t.push(v);
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = positions.slice(o, o + 9);
    volume += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  for (let i = 0; i < ids.size; i++) parent[i] = i;
  for (const [a, b, c] of t) {
    for (const [u, w] of [[a, b], [b, c], [c, a]]) {
      const key = u < w ? `${u}_${w}` : `${w}_${u}`;
      const e = edge.get(key) || { f: 0, r: 0 };
      if (u < w) e.f++; else e.r++;
      edge.set(key, e);
    }
    parent[find(a)] = find(b);
    parent[find(b)] = find(c);
  }
  let open = 0, nonManifold = 0, badOrientation = 0;
  for (const e of edge.values()) {
    const n = e.f + e.r;
    if (n === 1) open++;
    else if (n > 2) nonManifold++;
    else if (e.f !== 1) badOrientation++;
  }
  const comps = new Set([...Array(ids.size).keys()].map(find)).size;
  return { open, nonManifold, badOrientation, volume, components: comps, watertight: open === 0 && nonManifold === 0 && badOrientation === 0 };
}

/** Number of triangles lying on a vertical cylinder wall of radius r around (cx, cy). */
export function wallTriangles(positions, cx, cy, r = 2.5, tol = 0.01) {
  let n = 0;
  const tris = positions.length / 9;
  for (let i = 0; i < tris; i++) {
    let ok = true;
    for (let k = 0; k < 3; k++) {
      const d = Math.hypot(positions[i * 9 + k * 3] - cx, positions[i * 9 + k * 3 + 1] - cy);
      if (Math.abs(d - r) > tol) { ok = false; break; }
    }
    if (ok) n++;
  }
  return n;
}

// ---------------------------------------------------------------- screenshot analysis
export function readPng(file) {
  return PNG.sync.read(fs.readFileSync(file));
}
const luma = (png, x, y) => {
  const i = (png.width * y + x) * 4;
  return 0.299 * png.data[i] + 0.587 * png.data[i + 1] + 0.114 * png.data[i + 2];
};
/** fraction of "dark" pixels inside a rectangle given in page pixels */
export function darkFraction(png, rect, threshold = 90) {
  let dark = 0, total = 0;
  for (let y = Math.max(0, Math.floor(rect.y)); y < Math.min(png.height, Math.ceil(rect.y + rect.h)); y++) {
    for (let x = Math.max(0, Math.floor(rect.x)); x < Math.min(png.width, Math.ceil(rect.x + rect.w)); x++) {
      total++;
      if (luma(png, x, y) < threshold) dark++;
    }
  }
  return total ? dark / total : 0;
}
export function lightFraction(png, rect, threshold = 215) {
  let light = 0, total = 0;
  for (let y = Math.floor(rect.y); y < Math.ceil(rect.y + rect.h); y++) {
    for (let x = Math.floor(rect.x); x < Math.ceil(rect.x + rect.w); x++) {
      total++;
      if (luma(png, x, y) >= threshold) light++;
    }
  }
  return total ? light / total : 0;
}
/** binary dark mask of a rectangle, for comparing two screenshots */
export function darkMask(png, rect, threshold = 90) {
  const w = Math.floor(rect.w), h = Math.floor(rect.h);
  const m = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m[y * w + x] = luma(png, Math.floor(rect.x) + x, Math.floor(rect.y) + y) < threshold ? 1 : 0;
  return m;
}
/** How many triangles a vertical ray at (x, y) crosses (0 = through-hole, 2 = plain solid). */
export function zIntersections(positions, x, y) {
  let n = 0;
  const tris = positions.length / 9;
  for (let i = 0; i < tris; i++) {
    const o = i * 9;
    const ax = positions[o], ay = positions[o + 1], bx = positions[o + 3], by = positions[o + 4], cx = positions[o + 6], cy = positions[o + 7];
    const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(d) < 1e-9) continue; // vertical wall
    const l1 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / d;
    const l2 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / d;
    const l3 = 1 - l1 - l2;
    if (l1 > 1e-7 && l2 > 1e-7 && l3 > 1e-7) n++;
  }
  return n;
}

export function iou(a, b) {
  let inter = 0, uni = 0;
  for (let i = 0; i < a.length; i++) { if (a[i] && b[i]) inter++; if (a[i] || b[i]) uni++; }
  return uni ? inter / uni : 1;
}

// ---------------------------------------------------------------- page helpers
export function makeHelpers(page) {
  const h = {};
  h.camera = async () => {
    const s = await page.getAttribute('[data-testid="viewer"] > div', 'data-camera');
    return s ? s.split(',').map(Number) : null;
  };
  h.target = async () => {
    const s = await page.getAttribute('[data-testid="viewer"] > div', 'data-target');
    return s ? s.split(',').map(Number) : null;
  };
  h.gpu = async () => {
    const s = await page.getAttribute('[data-testid="viewer"] > div', 'data-gpu');
    return s ? s.split(',').map(Number) : null;
  };
  h.corners = async () => {
    const s = await page.getAttribute('[data-testid="viewer"] > div', 'data-corners');
    return s ? s.split(';').map((p) => p.split(',').map(Number)) : null;
  };
  h.canvasBox = () => page.locator('[data-testid="viewer-canvas"]').boundingBox();
  h.waitCamera = async (pred, timeout = 8000) => {
    const t0 = Date.now();
    let last = null;
    while (Date.now() - t0 < timeout) {
      last = await h.camera();
      if (last && pred(last)) { await sleep(120); return last; }
      await sleep(80);
    }
    throw new Error(`camera never reached the expected position (last ${JSON.stringify(last)})`);
  };
  /** Wait until the camera stops moving (three identical readings) and return it. */
  h.settledCamera = async (timeout = 8000) => {
    const t0 = Date.now();
    let prev = null, same = 0;
    while (Date.now() - t0 < timeout) {
      const c = await h.camera();
      if (prev && c && c.every((v, i) => Math.abs(v - prev[i]) < 0.011)) same++; else same = 0;
      if (same >= 3) return c;
      prev = c;
      await sleep(120);
    }
    throw new Error('camera never settled');
  };
  h.waitReady = async (timeout = 60000) => {
    await sleep(450); // debounce (140ms) + effect scheduling
    await page.waitForSelector('[data-testid="geometry-status"] [data-state="ready"]', { timeout });
    await sleep(150);
  };
  h.toast = async (re, timeout = 8000) => {
    await page.waitForFunction(
      (src) => [...document.querySelectorAll('[data-testid="toasts"] > div')].some((e) => new RegExp(src, 'i').test(e.textContent || '')),
      re.source,
      { timeout },
    );
  };
  h.lastToast = () => page.evaluate(() => { const t = [...document.querySelectorAll('[data-testid="toasts"] > div')]; return t.length ? { text: t[t.length - 1].textContent, kind: t[t.length - 1].getAttribute('data-kind') } : null; });
  h.exportStl = async (name) => {
    const dl = page.waitForEvent('download', { timeout: 60000 });
    await page.click('[data-testid="export-stl"]');
    const confirm = page.locator('[data-testid="confirm-ok"]');
    try { await confirm.waitFor({ state: 'visible', timeout: 700 }); await confirm.click(); } catch { /* no confirmation needed */ }
    const d = await dl;
    const file = path.join(outDir, name || d.suggestedFilename());
    await d.saveAs(file);
    return { file, suggested: d.suggestedFilename(), buffer: fs.readFileSync(file) };
  };
  h.frontView = async () => {
    await page.click('[data-testid="view-front"]');
    return h.waitCamera((c) => Math.abs(c[0]) < 0.5 && Math.abs(c[1]) < 0.5 && c[2] > 50);
  };
  h.cardRectOnScreen = async () => {
    const c = await h.corners();
    const box = await h.canvasBox();
    const xs = c.map((p) => p[0]), ys = c.map((p) => p[1]);
    return { x: box.x + Math.min(...xs), y: box.y + Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  };
  /** page (client) coordinates of a point given in card millimetres (from left / from top) on the hole canvas */
  h.holeCanvasPoint = async (xmm, ymm) => {
    const loc = page.locator('[data-testid="hole-canvas"]');
    await loc.scrollIntoViewIfNeeded();
    return loc.evaluate((svg, [x, y]) => {
      const pt = svg.createSVGPoint();
      pt.x = x; pt.y = y;
      const p = pt.matrixTransform(svg.getScreenCTM());
      return { x: p.x, y: p.y };
    }, [xmm, ymm]);
  };
  h.clickHoleCanvas = async (xmm, ymm) => {
    const p = await h.holeCanvasPoint(xmm, ymm);
    await page.mouse.click(p.x, p.y);
    await sleep(120);
  };
  h.hole = async () => {
    const el = page.locator('[data-testid="hole-marker"]');
    return { x: Number(await el.getAttribute('data-x')), y: Number(await el.getAttribute('data-y')) };
  };
  h.setField = async (testId, value) => {
    const loc = page.locator(`[data-testid="${testId}"]`);
    await loc.scrollIntoViewIfNeeded();
    await loc.fill(String(value));
  };
  h.chips = () => page.locator('[data-testid="card-chip"]');
  /** poll an async predicate until it is true (UI updates after blur / re-render are not instantaneous) */
  h.until = async (fn, timeout = 4000) => {
    const t0 = Date.now();
    let last;
    while (Date.now() - t0 < timeout) { last = await fn(); if (last) return last; await sleep(80); }
    return last;
  };
  return h;
}
