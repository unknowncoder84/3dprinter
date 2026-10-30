/**
 * 2D region helpers. A Region is a list of polygons; each polygon is a list of rings where
 * ring 0 is the outer boundary (counter-clockwise) and the rest are holes (clockwise).
 * Coordinates are millimetres, +Y up. Nothing here touches the DOM.
 */

export type Pt = [number, number];
export type Ring = Pt[];
export type Polygon = Ring[];
export type Region = Polygon[];

export interface Bounds2 {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function ringArea(ring: Ring): number {
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % n];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

export function polygonArea(poly: Polygon): number {
  if (poly.length === 0) return 0;
  let a = Math.abs(ringArea(poly[0]));
  for (let i = 1; i < poly.length; i++) a -= Math.abs(ringArea(poly[i]));
  return a;
}

export function regionArea(region: Region): number {
  let a = 0;
  for (const p of region) a += polygonArea(p);
  return a;
}

export function isRegionEmpty(region: Region): boolean {
  return region.length === 0;
}

export function regionBounds(region: Region): Bounds2 | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const poly of region) {
    // Holes lie inside the outer ring, so the outer ring alone defines the bounds.
    const outer = poly[0];
    if (!outer) continue;
    for (const [x, y] of outer) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return minX === Infinity ? null : { minX, minY, maxX, maxY };
}

export function mapRegion(region: Region, fn: (x: number, y: number) => Pt): Region {
  return region.map((poly) => poly.map((ring) => ring.map(([x, y]) => fn(x, y))));
}

export function translateRegion(region: Region, dx: number, dy: number): Region {
  return mapRegion(region, (x, y) => [x + dx, y + dy]);
}

/** Uniform scale about the origin. */
export function scaleRegion(region: Region, s: number): Region {
  return mapRegion(region, (x, y) => [x * s, y * s]);
}

export function regionVertexCount(region: Region): number {
  let n = 0;
  for (const p of region) for (const r of p) n += r.length;
  return n;
}

/** Even-odd point-in-ring test. */
export function pointInRing(x: number, y: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function dpOpen(points: Pt[], tol: number): Pt[] {
  const n = points.length;
  if (n < 3) return points.slice();
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: Array<[number, number]> = [[0, n - 1]];
  const tol2 = tol * tol;
  while (stack.length) {
    const [s, e] = stack.pop()!;
    const [ax, ay] = points[s];
    const [bx, by] = points[e];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let maxD = 0;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const [px, py] = points[i];
      let d2: number;
      if (len2 === 0) {
        d2 = (px - ax) ** 2 + (py - ay) ** 2;
      } else {
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
        d2 = (px - (ax + t * dx)) ** 2 + (py - (ay + t * dy)) ** 2;
      }
      if (d2 > maxD) {
        maxD = d2;
        idx = i;
      }
    }
    if (idx >= 0 && maxD > tol2) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(points[i]);
  return out;
}

/** Douglas-Peucker simplification of a closed ring. */
export function simplifyRing(ring: Ring, tol: number): Ring {
  if (tol <= 0 || ring.length <= 4) return ring;
  let k = 0;
  let best = -1;
  const [x0, y0] = ring[0];
  for (let i = 1; i < ring.length; i++) {
    const d = (ring[i][0] - x0) ** 2 + (ring[i][1] - y0) ** 2;
    if (d > best) {
      best = d;
      k = i;
    }
  }
  const a = ring.slice(0, k + 1);
  const b = ring.slice(k).concat([ring[0]]);
  const sa = dpOpen(a, tol);
  const sb = dpOpen(b, tol);
  const out = sa.concat(sb.slice(1, -1));
  return out.length >= 3 ? out : ring;
}

/** Simplify every ring and drop rings/polygons smaller than minArea (mm^2). */
export function simplifyRegion(region: Region, tol: number, minArea = 0): Region {
  const out: Region = [];
  for (const poly of region) {
    const outer = simplifyRing(poly[0], tol);
    if (outer.length < 3 || Math.abs(ringArea(outer)) < minArea) continue;
    const rings: Polygon = [outer];
    for (let i = 1; i < poly.length; i++) {
      const hole = simplifyRing(poly[i], tol);
      if (hole.length >= 3 && Math.abs(ringArea(hole)) >= minArea) rings.push(hole);
    }
    out.push(rings);
  }
  return out;
}

const GRID = 1000; // all geometry is snapped to 0.001 mm

function cleanRingInt(input: Array<[number, number]>): Array<[number, number]> {
  let p = input;
  let changed = true;
  while (changed && p.length >= 3) {
    changed = false;
    const out: Array<[number, number]> = [];
    const n = p.length;
    for (let i = 0; i < n; i++) {
      const prev = out.length ? out[out.length - 1] : p[n - 1];
      const cur = p[i];
      const next = p[(i + 1) % n];
      const dup = cur[0] === prev[0] && cur[1] === prev[1];
      const cross = (cur[0] - prev[0]) * (next[1] - cur[1]) - (cur[1] - prev[1]) * (next[0] - cur[0]);
      if (dup || cross === 0) {
        changed = true; // duplicate, collinear or zero-width spike vertex
        continue;
      }
      out.push(cur);
    }
    p = out;
  }
  return p;
}

/**
 * Snap to the 0.001 mm grid and remove duplicate / exactly collinear vertices.
 * Every ring is reduced to its corner vertices, which makes the vertex set of a boundary
 * unique. That is what lets walls and faces built from different Clipper results share
 * identical edges (the triangulator also drops collinear vertices, so rings must not
 * contain any).
 */
export function canonicalizeRegion(region: Region): Region {
  const out: Region = [];
  const clean = (ring: Ring): Ring | null => {
    const snapped: Array<[number, number]> = ring.map(([x, y]) => [Math.round(x * GRID), Math.round(y * GRID)]);
    const c = cleanRingInt(snapped);
    return c.length >= 3 ? c.map(([x, y]) => [x / GRID, y / GRID] as Pt) : null;
  };
  for (const poly of region) {
    const outer = clean(poly[0]);
    if (!outer) continue; // the whole polygon collapsed
    const rings: Polygon = [outer];
    for (let i = 1; i < poly.length; i++) {
      const hole = clean(poly[i]);
      if (hole) rings.push(hole);
    }
    out.push(rings);
  }
  return normalizeOrientation(out);
}

/** Make outer rings counter-clockwise and holes clockwise. */
export function normalizeOrientation(region: Region): Region {
  return region.map((poly) =>
    poly.map((ring, i) => {
      const a = ringArea(ring);
      const wantPositive = i === 0;
      return (a > 0) === wantPositive ? ring : ring.slice().reverse();
    }),
  );
}
