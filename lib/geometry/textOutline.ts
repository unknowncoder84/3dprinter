/**
 * Text -> 2D region, using the actual glyph outlines of the font (opentype.js).
 *
 * Contours are flattened to polylines and handed to Clipper with the non-zero fill rule, the
 * rule used by TrueType/OpenType. Clipper's PolyTree then gives each glyph its correct
 * counters (the holes in A, B, D, O, P, Q, R, a, e, g ...) and merges overlapping contours.
 */
import type opentype from 'opentype.js';
import { ringsToRegion } from './clip';
import { regionBounds, type Bounds2, type Pt, type Region, type Ring } from './region';

export interface TextOutline {
  /** Baseline at y = 0, text starting at x = 0 (before bearing). Millimetres, +Y up. */
  region: Region;
  bounds: Bounds2 | null;
  /** Font size (em) in mm that produced the requested cap height. */
  em: number;
  /** Characters the font does not contain; they are skipped, never replaced by a fake shape. */
  missing: string[];
}

function capHeightRatio(font: opentype.Font): number {
  const os2 = (font.tables as { os2?: { sCapHeight?: number } }).os2;
  const fromTable = os2?.sCapHeight ?? 0;
  const upm = font.unitsPerEm || 1000;
  if (fromTable > 0) return fromTable / upm;
  const h = font.charToGlyph('H').getBoundingBox();
  return h.y2 > 0 ? h.y2 / upm : 0.7;
}

function sampleCubic(p0: Pt, p1: Pt, p2: Pt, p3: Pt, out: Ring): void {
  const len =
    Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) +
    Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) +
    Math.hypot(p3[0] - p2[0], p3[1] - p2[1]);
  const n = Math.max(3, Math.min(28, Math.ceil(len / 0.6)));
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    const a = u * u * u;
    const b = 3 * u * u * t;
    const c = 3 * u * t * t;
    const d = t * t * t;
    out.push([a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]]);
  }
}

function sampleQuad(p0: Pt, p1: Pt, p2: Pt, out: Ring): void {
  const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) + Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
  const n = Math.max(3, Math.min(24, Math.ceil(len / 0.6)));
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push([u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]]);
  }
}

function pathToRings(commands: opentype.PathCommand[]): Ring[] {
  const rings: Ring[] = [];
  let cur: Ring | null = null;
  let last: Pt = [0, 0];
  const finish = () => {
    if (cur && cur.length >= 3) {
      const a = cur[0];
      const b = cur[cur.length - 1];
      if (a[0] === b[0] && a[1] === b[1]) cur.pop();
      if (cur.length >= 3) rings.push(cur);
    }
    cur = null;
  };
  for (const cmd of commands) {
    switch (cmd.type) {
      case 'M':
        finish();
        last = [cmd.x, -cmd.y]; // opentype paths are y-down
        cur = [last];
        break;
      case 'L':
        if (cur) {
          last = [cmd.x, -cmd.y];
          cur.push(last);
        }
        break;
      case 'Q':
        if (cur) {
          const p2: Pt = [cmd.x, -cmd.y];
          sampleQuad(last, [cmd.x1, -cmd.y1], p2, cur);
          last = p2;
        }
        break;
      case 'C':
        if (cur) {
          const p3: Pt = [cmd.x, -cmd.y];
          sampleCubic(last, [cmd.x1, -cmd.y1], [cmd.x2, -cmd.y2], p3, cur);
          last = p3;
        }
        break;
      case 'Z':
        finish();
        break;
    }
  }
  finish();
  return rings;
}

export function textToRegion(font: opentype.Font, text: string, capHeightMm: number, letterSpacing = 0): TextOutline {
  const ratio = capHeightRatio(font);
  const em = capHeightMm / ratio;

  const missing: string[] = [];
  const kept: string[] = [];
  for (const ch of Array.from(text)) {
    if (/\s/.test(ch)) {
      kept.push(' ');
    } else if ((font.charToGlyphIndex(ch) ?? 0) > 0) {
      // NB: font.hasChar() is unreliable for TrueType cmaps: missing characters map to
      // glyph 0 (.notdef, a box) rather than null.
      kept.push(ch);
    } else if (!missing.includes(ch)) {
      missing.push(ch);
    }
  }
  const clean = kept.join('').replace(/ +/g, ' ').trim();
  if (!clean) return { region: [], bounds: null, em, missing };

  const path = font.getPath(clean, 0, 0, em, { kerning: true, letterSpacing });
  const region = ringsToRegion(pathToRings(path.commands), 'nonzero');
  return { region, bounds: regionBounds(region), em, missing };
}
