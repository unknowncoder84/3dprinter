/**
 * Builds the printable solid from 2D regions.
 *
 * The card is a height-field: the base footprint has height `thickness`; every raised detail
 * adds a prism on top of it. Instead of stacking separate meshes (which leaves coplanar,
 * overlapping shells), the base's top face has the detail footprints cut out and each detail
 * contributes its own side walls and top face. The result is one closed, consistently
 * oriented surface. Triangles are tagged by part (base / alphabet / word / image) so the
 * preview can colour them differently while the STL contains all of them.
 *
 * Only exact vertex positions produced by Clipper are used, so shared edges coincide exactly.
 */
import cdt2d from 'cdt2d';
import { difference, unionAll } from './clip';
import { canonicalizeRegion, type Polygon, type Region } from './region';

export type PartRole = 'base' | 'alphabet' | 'word' | 'image';

export interface MeshPart {
  role: PartRole;
  /** Non-indexed triangles, x y z per vertex, 9 floats per triangle. */
  positions: Float32Array;
}

export interface RaisedFeature {
  role: Exclude<PartRole, 'base'>;
  region: Region;
  /** height above the card's front surface, mm */
  height: number;
}

class TriangleSink {
  readonly data: number[] = [];

  push(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    cx: number,
    cy: number,
    cz: number,
  ): void {
    this.data.push(ax, ay, az, bx, by, bz, cx, cy, cz);
  }

  toFloat32(): Float32Array {
    return Float32Array.from(this.data);
  }
}

/**
 * Triangulate a polygon (outer ring + holes) and emit it as a flat face at height z.
 *
 * A constrained Delaunay triangulation is used because it keeps EVERY input vertex. Ear
 * clipping drops vertices that lie on a straight line, which leaves T-junctions against the
 * side walls (those walls do use the vertex) and makes the mesh non-watertight.
 */
function addFace(sink: TriangleSink, poly: Polygon, z: number, facingUp: boolean): void {
  const pts: number[][] = [];
  const index = new Map<string, number>();
  const edges: number[][] = [];
  const idOf = (x: number, y: number): number => {
    const key = x + ',' + y;
    let i = index.get(key);
    if (i === undefined) {
      i = pts.length;
      pts.push([x, y]);
      index.set(key, i);
    }
    return i;
  };
  for (const ring of poly) {
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      const a = idOf(ring[i][0], ring[i][1]);
      const b = idOf(ring[(i + 1) % n][0], ring[(i + 1) % n][1]);
      if (a !== b) edges.push([a, b]);
    }
  }
  // delaunay:false skips the (slow) edge-flipping pass; the quality of the triangles does
  // not matter for a flat face, only that every vertex and constraint edge is kept.
  const tris = cdt2d(pts, edges, { delaunay: false, exterior: false });
  for (const t of tris) {
    let a = t[0];
    let b = t[1];
    let c = t[2];
    const cross = (pts[b][0] - pts[a][0]) * (pts[c][1] - pts[a][1]) - (pts[b][1] - pts[a][1]) * (pts[c][0] - pts[a][0]);
    if (cross === 0) continue; // zero-area sliver
    // cross > 0 means counter-clockwise seen from +Z, i.e. normal +Z.
    const flip = facingUp ? cross < 0 : cross > 0;
    if (flip) {
      const tmp = b;
      b = c;
      c = tmp;
    }
    sink.push(pts[a][0], pts[a][1], z, pts[b][0], pts[b][1], z, pts[c][0], pts[c][1], z);
  }
}

/**
 * Vertical side walls along every ring of a polygon, spanning z0..z1.
 * Rings are oriented outer CCW / holes CW, so the right-hand normal of each edge points
 * away from the material in every case.
 */
function addWalls(sink: TriangleSink, poly: Polygon, z0: number, z1: number): void {
  for (const ring of poly) {
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      const [px, py] = ring[i];
      const [qx, qy] = ring[(i + 1) % n];
      sink.push(px, py, z0, qx, qy, z0, qx, qy, z1);
      sink.push(px, py, z0, qx, qy, z1, px, py, z1);
    }
  }
}

export function buildSolid(baseIn: Region, thickness: number, featuresIn: RaisedFeature[]): MeshPart[] {
  // Canonical rings (no duplicate or collinear vertices) so that every seam between a wall
  // and a face is made of identical vertices.
  const base = canonicalizeRegion(baseIn);
  const live = featuresIn
    .map((f) => ({ ...f, region: canonicalizeRegion(f.region) }))
    .filter((f) => f.region.length > 0 && f.height > 0);
  const footprint = live.length ? unionAll(live.map((f) => f.region)) : [];
  const top = footprint.length ? canonicalizeRegion(difference(base, footprint)) : base;

  const parts: MeshPart[] = [];

  const baseSink = new TriangleSink();
  for (const poly of base) addFace(baseSink, poly, 0, false);
  for (const poly of base) addWalls(baseSink, poly, 0, thickness);
  for (const poly of top) addFace(baseSink, poly, thickness, true);
  parts.push({ role: 'base', positions: baseSink.toFloat32() });

  for (const f of live) {
    const sink = new TriangleSink();
    for (const poly of f.region) {
      addWalls(sink, poly, thickness, thickness + f.height);
      addFace(sink, poly, thickness + f.height, true);
    }
    parts.push({ role: f.role, positions: sink.toFloat32() });
  }
  return parts;
}
