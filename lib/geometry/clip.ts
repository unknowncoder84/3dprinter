/**
 * Robust 2D polygon booleans, offsetting and hole nesting, built on Clipper (clipper-lib).
 *
 * Clipper works on integer coordinates, so all coordinates are scaled by SCALE (0.001 units
 * of precision). That also means shared boundaries produced by one operation are bit-identical,
 * which is what lets the solid builder create watertight meshes.
 */
import * as C from 'clipper-lib';
import { normalizeOrientation, ringArea, type Region, type Ring } from './region';

export const SCALE = 1000;

function ringToPath(ring: Ring): C.Path {
  const path: C.Path = new Array(ring.length);
  for (let i = 0; i < ring.length; i++) {
    path[i] = { X: Math.round(ring[i][0] * SCALE), Y: Math.round(ring[i][1] * SCALE) };
  }
  return path;
}

function pathToRing(path: C.Path): Ring {
  const ring: Ring = new Array(path.length);
  for (let i = 0; i < path.length; i++) ring[i] = [path[i].X / SCALE, path[i].Y / SCALE];
  return ring;
}

function regionToPaths(region: Region): C.Paths {
  const paths: C.Paths = [];
  for (const poly of normalizeOrientation(region)) for (const ring of poly) paths.push(ringToPath(ring));
  return paths;
}

function polyTreeToRegion(tree: C.PolyTree): Region {
  const out: Region = [];
  const outers = (nodes: C.PolyNode[]) => {
    for (const outer of nodes) {
      const contour = outer.Contour();
      if (contour.length < 3) continue;
      const poly: Ring[] = [pathToRing(contour)];
      for (const hole of outer.Childs()) {
        const hc = hole.Contour();
        if (hc.length >= 3) poly.push(pathToRing(hc));
        // anything nested inside a hole is a new, separate solid island
        outers(hole.Childs());
      }
      out.push(poly);
    }
  };
  outers(tree.Childs());
  return normalizeOrientation(out);
}

type Fill = 'nonzero' | 'evenodd';
const fillType = (f: Fill) => (f === 'evenodd' ? C.PolyFillType.pftEvenOdd : C.PolyFillType.pftNonZero);

/** Turn an arbitrary bag of closed contours into a clean region (holes nested correctly). */
export function ringsToRegion(rings: Ring[], fill: Fill = 'nonzero'): Region {
  const clipper = new C.Clipper();
  const paths = rings.filter((r) => r.length >= 3).map(ringToPath);
  if (paths.length === 0) return [];
  clipper.AddPaths(paths, C.PolyType.ptSubject, true);
  const tree = new C.PolyTree();
  clipper.Execute(C.ClipType.ctUnion, tree, fillType(fill), fillType(fill));
  return polyTreeToRegion(tree);
}

function execute(type: number, subject: Region, clip: Region): Region {
  if (subject.length === 0) return type === C.ClipType.ctUnion ? clipOnly(clip) : [];
  const clipper = new C.Clipper();
  clipper.AddPaths(regionToPaths(subject), C.PolyType.ptSubject, true);
  if (clip.length) clipper.AddPaths(regionToPaths(clip), C.PolyType.ptClip, true);
  const tree = new C.PolyTree();
  clipper.Execute(type, tree, C.PolyFillType.pftNonZero, C.PolyFillType.pftNonZero);
  return polyTreeToRegion(tree);
}

function clipOnly(clip: Region): Region {
  return clip.length ? execute(C.ClipType.ctUnion, clip, []) : [];
}

export const union = (a: Region, b: Region): Region => execute(C.ClipType.ctUnion, a, b);
export const difference = (a: Region, b: Region): Region => execute(C.ClipType.ctDifference, a, b);
export const intersection = (a: Region, b: Region): Region => execute(C.ClipType.ctIntersection, a, b);

/** Union of many regions in a single pass. */
export function unionAll(regions: Region[]): Region {
  const clipper = new C.Clipper();
  let any = false;
  for (const r of regions) {
    if (!r.length) continue;
    clipper.AddPaths(regionToPaths(r), C.PolyType.ptSubject, true);
    any = true;
  }
  if (!any) return [];
  const tree = new C.PolyTree();
  clipper.Execute(C.ClipType.ctUnion, tree, C.PolyFillType.pftNonZero, C.PolyFillType.pftNonZero);
  return polyTreeToRegion(tree);
}

export type JoinKind = 'round' | 'miter' | 'bevel';
export type CapKind = 'butt' | 'round' | 'square';

function joinType(j: JoinKind): number {
  return j === 'round' ? C.JoinType.jtRound : j === 'miter' ? C.JoinType.jtMiter : C.JoinType.jtSquare;
}

/** Grow (delta > 0) or shrink (delta < 0) a region. */
export function offsetRegion(region: Region, delta: number, join: JoinKind = 'round', arcTolerance = 0.01): Region {
  if (region.length === 0) return [];
  if (delta === 0) return region;
  const co = new C.ClipperOffset(2, Math.max(1, arcTolerance * SCALE));
  co.AddPaths(regionToPaths(region), joinType(join), C.EndType.etClosedPolygon);
  const tree = new C.PolyTree();
  co.Execute(tree, delta * SCALE);
  return polyTreeToRegion(tree);
}

export interface StrokePath {
  points: Ring;
  closed: boolean;
}

/** Convert stroked centre-lines into filled outlines of the given total width. */
export function strokeToRegion(
  paths: StrokePath[],
  width: number,
  join: JoinKind,
  cap: CapKind,
  miterLimit = 4,
  arcTolerance = 0.01,
): Region {
  if (!paths.length || width <= 0) return [];
  const co = new C.ClipperOffset(miterLimit, Math.max(1, arcTolerance * SCALE));
  for (const p of paths) {
    if (p.points.length < 2) continue;
    const endType = p.closed
      ? C.EndType.etClosedLine
      : cap === 'round'
        ? C.EndType.etOpenRound
        : cap === 'square'
          ? C.EndType.etOpenSquare
          : C.EndType.etOpenButt;
    co.AddPath(ringToPath(p.points), joinType(join), endType);
  }
  const tree = new C.PolyTree();
  co.Execute(tree, (width / 2) * SCALE);
  return polyTreeToRegion(tree);
}

/** Area of intersection between two regions (mm^2). */
export function overlapArea(a: Region, b: Region): number {
  if (!a.length || !b.length) return 0;
  const inter = intersection(a, b);
  let area = 0;
  for (const poly of inter) {
    area += Math.abs(ringArea(poly[0]));
    for (let i = 1; i < poly.length; i++) area -= Math.abs(ringArea(poly[i]));
  }
  return area;
}
