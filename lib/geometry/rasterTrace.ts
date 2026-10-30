/**
 * Raster image -> 2D region (vector outlines with holes).
 *
 * Pipeline: composite on white -> grayscale -> contrast -> threshold (Otsu or manual) ->
 * optional smoothing -> marching squares with linear interpolation (sub-pixel, smooth
 * contours) -> speckle removal -> Douglas-Peucker simplification -> Clipper even-odd union.
 *
 * This works well for clean, high-contrast cartoon art. It cannot recover detail that is not
 * separable by brightness (photos, gradients, busy backgrounds) - the caller shows coverage
 * statistics and warnings so the user can adjust the settings or use simpler artwork.
 */
import { ringsToRegion } from './clip';
import { regionBounds, ringArea, simplifyRing, type Region, type Ring } from './region';
import type { ImageMode } from '../../types/flashcard';

export interface RasterOptions {
  mode: ImageMode;
  autoThreshold: boolean;
  threshold: number;
  contrast: number;
  smoothing: number;
  simplify: number;
  minFeature: number;
  bgTolerance: number;
}

export interface RasterTraceResult {
  /** Pixel units, +Y up, origin at the bottom-left corner of the image. */
  region: Region;
  width: number;
  height: number;
  threshold: number;
  /** Fraction of pixels selected as raised (0..1). */
  coverage: number;
  warnings: string[];
}

export function otsuThreshold(hist: ArrayLike<number>, total: number): number {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = -1;
  let first = 128;
  let last = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best * (1 + 1e-9)) {
      best = between;
      first = t;
      last = t;
    } else if (between >= best * (1 - 1e-9)) {
      last = t; // same score: extend the plateau (e.g. a pure black/white image)
    }
  }
  return Math.round((first + last) / 2);
}

function blur(field: Float32Array, w: number, h: number, passes: number): void {
  if (passes <= 0) return;
  const tmp = new Float32Array(field.length);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        const l = field[row + (x > 0 ? x - 1 : x)];
        const r = field[row + (x < w - 1 ? x + 1 : x)];
        tmp[row + x] = (l + 2 * field[row + x] + r) / 4;
      }
    }
    for (let y = 0; y < h; y++) {
      const up = (y > 0 ? y - 1 : y) * w;
      const dn = (y < h - 1 ? y + 1 : y) * w;
      const row = y * w;
      for (let x = 0; x < w; x++) field[row + x] = (tmp[up + x] + 2 * tmp[row + x] + tmp[dn + x]) / 4;
    }
  }
}

function floodBackground(data: ArrayLike<number>, w: number, h: number, tol: number): Uint8Array {
  // background colour = median of the border pixels
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  const addBorder = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    rs.push(data[i]);
    gs.push(data[i + 1]);
    bs.push(data[i + 2]);
  };
  for (let x = 0; x < w; x++) {
    addBorder(x, 0);
    addBorder(x, h - 1);
  }
  for (let y = 1; y < h - 1; y++) {
    addBorder(0, y);
    addBorder(w - 1, y);
  }
  const med = (a: number[]) => a.sort((p, q) => p - q)[a.length >> 1];
  const br = med(rs);
  const bg = med(gs);
  const bb = med(bs);
  const isBg = (i: number) =>
    Math.max(Math.abs(data[i * 4] - br), Math.abs(data[i * 4 + 1] - bg), Math.abs(data[i * 4 + 2] - bb)) <= tol;

  const bgMask = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let head = 0;
  let tail = 0;
  const push = (i: number) => {
    if (!bgMask[i] && isBg(i)) {
      bgMask[i] = 1;
      queue[tail++] = i;
    }
  };
  for (let x = 0; x < w; x++) {
    push(x);
    push((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    push(y * w);
    push(y * w + w - 1);
  }
  while (head < tail) {
    const i = queue[head++];
    const x = i % w;
    const y = (i / w) | 0;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (y > 0) push(i - w);
    if (y < h - 1) push(i + w);
  }
  return bgMask;
}

/** Iso-contour (value 0) of a scalar field, as closed rings in padded-sample coordinates. */
function marchingSquares(v: Float32Array, W: number, H: number): Ring[] {
  const segA: number[] = [];
  const segB: number[] = [];
  const pos = new Map<number, [number, number]>();
  const adj = new Map<number, number[]>();

  const edgePos = (id: number, x: number, y: number) => {
    if (!pos.has(id)) pos.set(id, [x, y]);
    return id;
  };
  const addSeg = (e1: number, e2: number) => {
    const s = segA.length;
    segA.push(e1);
    segB.push(e2);
    let l1 = adj.get(e1);
    if (!l1) adj.set(e1, (l1 = []));
    l1.push(s);
    let l2 = adj.get(e2);
    if (!l2) adj.set(e2, (l2 = []));
    l2.push(s);
  };

  for (let cy = 0; cy < H - 1; cy++) {
    for (let cx = 0; cx < W - 1; cx++) {
      const a = v[cy * W + cx];
      const b = v[cy * W + cx + 1];
      const c = v[(cy + 1) * W + cx + 1];
      const d = v[(cy + 1) * W + cx];
      const idx = (a > 0 ? 8 : 0) | (b > 0 ? 4 : 0) | (c > 0 ? 2 : 0) | (d > 0 ? 1 : 0);
      if (idx === 0 || idx === 15) continue;

      const T = () => edgePos(2 * (cy * W + cx), cx + a / (a - b), cy);
      const B = () => edgePos(2 * ((cy + 1) * W + cx), cx + d / (d - c), cy + 1);
      const L = () => edgePos(2 * (cy * W + cx) + 1, cx, cy + a / (a - d));
      const R = () => edgePos(2 * (cy * W + cx + 1) + 1, cx + 1, cy + b / (b - c));

      switch (idx) {
        case 1:
        case 14:
          addSeg(L(), B());
          break;
        case 2:
        case 13:
          addSeg(B(), R());
          break;
        case 3:
        case 12:
          addSeg(L(), R());
          break;
        case 4:
        case 11:
          addSeg(T(), R());
          break;
        case 6:
        case 9:
          addSeg(T(), B());
          break;
        case 7:
        case 8:
          addSeg(T(), L());
          break;
        case 5: {
          const centre = (a + b + c + d) / 4 > 0;
          if (centre) {
            addSeg(T(), L());
            addSeg(B(), R());
          } else {
            addSeg(T(), R());
            addSeg(L(), B());
          }
          break;
        }
        case 10: {
          const centre = (a + b + c + d) / 4 > 0;
          if (centre) {
            addSeg(T(), R());
            addSeg(L(), B());
          } else {
            addSeg(T(), L());
            addSeg(B(), R());
          }
          break;
        }
      }
    }
  }

  const used = new Uint8Array(segA.length);
  const rings: Ring[] = [];
  for (let s = 0; s < segA.length; s++) {
    if (used[s]) continue;
    used[s] = 1;
    const startEdge = segA[s];
    const ring: Ring = [pos.get(startEdge)!];
    let edge = segB[s];
    let seg = s;
    let closed = true;
    while (edge !== startEdge) {
      ring.push(pos.get(edge)!);
      const list = adj.get(edge)!;
      const next = list[0] === seg ? list[1] : list[0];
      if (next === undefined || used[next]) {
        closed = false;
        break;
      }
      used[next] = 1;
      edge = segA[next] === edge ? segB[next] : segA[next];
      seg = next;
    }
    if (closed && ring.length >= 3) rings.push(ring);
  }
  return rings;
}

export function traceRaster(data: ArrayLike<number>, w: number, h: number, o: RasterOptions): RasterTraceResult {
  const n = w * h;
  const warnings: string[] = [];
  if (w < 2 || h < 2) throw new Error('The image is too small to convert.');

  const gray = new Float32Array(n);
  const alpha = new Uint8Array(n);
  let transparent = 0;
  for (let i = 0; i < n; i++) {
    const a = data[i * 4 + 3];
    alpha[i] = a;
    if (a < 250) transparent++;
    const af = a / 255;
    const r = data[i * 4] * af + 255 * (1 - af);
    const g = data[i * 4 + 1] * af + 255 * (1 - af);
    const b = data[i * 4 + 2] * af + 255 * (1 - af);
    gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }
  const hasAlpha = transparent / n > 0.005;

  if (o.contrast !== 0) {
    const f = (100 + o.contrast) / 100;
    for (let i = 0; i < n; i++) gray[i] = Math.max(0, Math.min(255, (gray[i] - 128) * f + 128));
  }

  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) hist[Math.max(0, Math.min(255, Math.round(gray[i])))]++;
  const threshold = o.autoThreshold ? otsuThreshold(hist, n) : o.threshold;

  // Clean line art is almost entirely near-black or near-white (only anti-aliased edges are
  // grey). A large share of mid-tones means a photograph or smooth shading, which a single
  // brightness threshold cannot turn into a faithful relief.
  let mid = 0;
  for (let v = 40; v <= 215; v++) mid += hist[v];
  const midtoneFraction = mid / n;
  if (midtoneFraction > 0.4 && o.mode !== 'silhouette') {
    warnings.push(`This looks like a photo or coloured artwork (${Math.round(midtoneFraction * 100)}% mid-tones), so only a rough shape can be extracted. For a clean result use flat, high-contrast artwork (black outline on white) or an SVG. For a coloured cartoon on a plain background, try the "Silhouette" mode.`);
  }

  const field = new Float32Array(n);
  if (o.mode === 'silhouette') {
    if (hasAlpha) {
      for (let i = 0; i < n; i++) field[i] = alpha[i] >= 128 ? 64 : -64;
    } else {
      const bgMask = floodBackground(data, w, h, o.bgTolerance);
      let bgCount = 0;
      for (let i = 0; i < n; i++) {
        field[i] = bgMask[i] ? -64 : 64;
        if (bgMask[i]) bgCount++;
      }
      if (bgCount / n < 0.05) warnings.push('No plain background was found around the picture, so almost everything is raised. Increase the background tolerance or use artwork on a plain or transparent background.');
    }
  } else if (o.mode === 'dark') {
    for (let i = 0; i < n; i++) field[i] = threshold - gray[i];
  } else {
    for (let i = 0; i < n; i++) field[i] = gray[i] - threshold;
  }

  blur(field, w, h, Math.round(o.smoothing));

  let selected = 0;
  for (let i = 0; i < n; i++) if (field[i] > 0) selected++;
  const coverage = selected / n;

  const W = w + 2;
  const H = h + 2;
  const padded = new Float32Array(W * H).fill(-64);
  for (let y = 0; y < h; y++) padded.set(field.subarray(y * w, y * w + w), (y + 1) * W + 1);

  const loops = marchingSquares(padded, W, H);
  const rings: Ring[] = [];
  for (const loop of loops) {
    const ring: Ring = loop.map(([x, y]) => [x - 0.5, h - (y - 0.5)]);
    if (Math.abs(ringArea(ring)) < o.minFeature) continue;
    const s = simplifyRing(ring, o.simplify);
    if (s.length >= 3) rings.push(s);
  }
  const region = ringsToRegion(rings, 'evenodd');

  if (region.length === 0) {
    warnings.push('No shapes were detected. Try another threshold, switch between Dark/Light/Silhouette, or upload artwork with stronger contrast.');
  } else if (coverage > 0.6) {
    warnings.push(`${Math.round(coverage * 100)}% of the image is selected, so the result is mostly one solid block. Try "Light ink", raise the contrast, or use artwork on a plain background.`);
  } else if (coverage < 0.004) {
    warnings.push('Almost nothing was detected. Lower the threshold or use "Light ink" / "Silhouette".');
  }
  const b = regionBounds(region);
  if (b && region.length > 400) {
    warnings.push(`The conversion found ${region.length} separate pieces (likely noise). Raise "Ignore specks smaller than" or smoothing.`);
  }

  return { region, width: w, height: h, threshold, coverage, warnings };
}
