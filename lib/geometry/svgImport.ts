/**
 * SVG -> 2D region.
 *
 * Supported: path (M L H V C S Q T A Z, absolute and relative), rect (incl. rounded), circle,
 * ellipse, line, polygon, polyline, g, use, nested svg (as a group), transforms, fill and
 * stroke (strokes are converted to real outlines), fill-rule, CSS in <style> for simple
 * class/id/tag selectors, inline style="...".
 *
 * Paint order is respected. Shapes filled with a very light colour (white/near white) are
 * treated as "background paint" and carve their area out of what was drawn before, which is
 * how typical black-outline / white-fill cartoon art is built.
 *
 * Not supported and rejected with an explanation: <image>, <text>, <foreignObject>.
 * Ignored with a visible warning: clip-path, mask, filters, dashes, gradients/patterns
 * (treated as solid).
 */
import {
  difference,
  ringsToRegion,
  strokeToRegion,
  union,
  unionAll,
  type CapKind,
  type JoinKind,
  type StrokePath,
} from './clip';
import { regionArea, regionBounds, simplifyRegion, type Pt, type Region, type Ring } from './region';
import { parseXml, type XmlNode } from './xmlLite';

export class SvgImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SvgImportError';
  }
}

export interface SvgImportResult {
  /** Region in a normalised working space (largest side = 100 units), +Y up. */
  region: Region;
  warnings: string[];
  shapeCount: number;
}

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function mul(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}
const applyM = (m: Matrix, p: Pt): Pt => [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];

function parseTransform(src: string | undefined): Matrix {
  if (!src) return IDENTITY;
  let m: Matrix = IDENTITY;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let t: RegExpExecArray | null;
  while ((t = re.exec(src))) {
    const a = t[2]
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    if (a.some((v) => !Number.isFinite(v))) continue;
    let n: Matrix = IDENTITY;
    switch (t[1]) {
      case 'matrix':
        if (a.length >= 6) n = [a[0], a[1], a[2], a[3], a[4], a[5]];
        break;
      case 'translate':
        n = [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0];
        break;
      case 'scale':
        n = [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0];
        break;
      case 'rotate': {
        const r = ((a[0] ?? 0) * Math.PI) / 180;
        const c = Math.cos(r);
        const s = Math.sin(r);
        n = [c, s, -s, c, 0, 0];
        if (a.length >= 3) n = mul(mul([1, 0, 0, 1, a[1], a[2]], n), [1, 0, 0, 1, -a[1], -a[2]]);
        break;
      }
      case 'skewX':
        n = [1, 0, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 1, 0, 0];
        break;
      case 'skewY':
        n = [1, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0];
        break;
    }
    m = mul(m, n);
  }
  return m;
}

// ---------------------------------------------------------------------------
// Path data
// ---------------------------------------------------------------------------

interface Seg {
  line: boolean;
  c1: Pt;
  c2: Pt;
  p: Pt;
}
interface Sub {
  start: Pt;
  segs: Seg[];
  closed: boolean;
}

const KAPPA = 0.5522847498307936;

function lineSeg(from: Pt, to: Pt): Seg {
  return { line: true, c1: from, c2: to, p: to };
}

function quadToCubic(p0: Pt, q: Pt, p: Pt): Seg {
  return {
    line: false,
    c1: [p0[0] + (2 / 3) * (q[0] - p0[0]), p0[1] + (2 / 3) * (q[1] - p0[1])],
    c2: [p[0] + (2 / 3) * (q[0] - p[0]), p[1] + (2 / 3) * (q[1] - p[1])],
    p,
  };
}

function arcToCubics(x0: number, y0: number, rxIn: number, ryIn: number, phiDeg: number, fa: number, fs: number, x: number, y: number): Seg[] {
  if (x0 === x && y0 === y) return [];
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (rx === 0 || ry === 0) return [lineSeg([x0, y0], [x, y])];
  const phi = (phiDeg * Math.PI) / 180;
  const cosP = Math.cos(phi);
  const sinP = Math.sin(phi);
  const dx = (x0 - x) / 2;
  const dy = (y0 - y) / 2;
  const x1p = cosP * dx + sinP * dy;
  const y1p = -sinP * dx + cosP * dy;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }
  const rx2 = rx * rx;
  const ry2 = ry * ry;
  let num = rx2 * ry2 - rx2 * y1p * y1p - ry2 * x1p * x1p;
  if (num < 0) num = 0;
  const den = rx2 * y1p * y1p + ry2 * x1p * x1p;
  const coef = (fa === fs ? -1 : 1) * Math.sqrt(den === 0 ? 0 : num / den);
  const cxp = (coef * rx * y1p) / ry;
  const cyp = (-coef * ry * x1p) / rx;
  const cx = cosP * cxp - sinP * cyp + (x0 + x) / 2;
  const cy = sinP * cxp + cosP * cyp + (y0 + y) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const theta1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dTheta = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!fs && dTheta > 0) dTheta -= 2 * Math.PI;
  else if (fs && dTheta < 0) dTheta += 2 * Math.PI;

  const n = Math.max(1, Math.ceil(Math.abs(dTheta) / (Math.PI / 2) - 1e-9));
  const step = dTheta / n;
  const t = (4 / 3) * Math.tan(step / 4);
  const segs: Seg[] = [];
  let a1 = theta1;
  for (let i = 0; i < n; i++) {
    const a2 = a1 + step;
    const cos1 = Math.cos(a1);
    const sin1 = Math.sin(a1);
    const cos2 = Math.cos(a2);
    const sin2 = Math.sin(a2);
    const e1: Pt = [-rx * sin1, ry * cos1];
    const e2: Pt = [-rx * sin2, ry * cos2];
    const toXY = (ex: number, ey: number): Pt => [cosP * ex - sinP * ey, sinP * ex + cosP * ey];
    const p1 = toXY(rx * cos1 + t * e1[0], ry * sin1 + t * e1[1]);
    const p2 = toXY(rx * cos2 - t * e2[0], ry * sin2 - t * e2[1]);
    const pe = i === n - 1 ? ([x, y] as Pt) : toXY(rx * cos2, ry * sin2);
    const end: Pt = i === n - 1 ? pe : [pe[0] + cx, pe[1] + cy];
    segs.push({ line: false, c1: [p1[0] + cx, p1[1] + cy], c2: [p2[0] + cx, p2[1] + cy], p: end });
    a1 = a2;
  }
  return segs;
}

function parsePathData(d: string): Sub[] {
  const NUM = /[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/y;
  let i = 0;
  const n = d.length;
  const skip = () => {
    while (i < n) {
      const c = d.charCodeAt(i);
      if (c === 32 || c === 44 || c === 9 || c === 10 || c === 13) i++;
      else break;
    }
  };
  const readNum = (): number => {
    skip();
    NUM.lastIndex = i;
    const m = NUM.exec(d);
    if (!m) throw new SvgImportError('The SVG contains malformed path data.');
    i = NUM.lastIndex;
    return parseFloat(m[0]);
  };
  const readFlag = (): number => {
    skip();
    const c = d[i];
    if (c !== '0' && c !== '1') throw new SvgImportError('The SVG contains malformed arc flags in a path.');
    i++;
    return c === '1' ? 1 : 0;
  };

  const subs: Sub[] = [];
  let cur: Sub | null = null;
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let lastCtrl: Pt | null = null; // previous cubic/quad control point for S/T
  let lastKind: 'C' | 'Q' | null = null;
  let cmd = '';

  const ensure = () => {
    if (!cur || cur.closed) {
      cur = { start: [cx, cy], segs: [], closed: false };
      subs.push(cur);
    }
    return cur;
  };

  while (true) {
    skip();
    if (i >= n) break;
    const ch = d[i];
    if (/[A-Za-z]/.test(ch)) {
      cmd = ch;
      i++;
      if (cmd === 'Z' || cmd === 'z') {
        if (cur) {
          (cur as Sub).closed = true;
          cx = sx;
          cy = sy;
        }
        lastKind = null;
        continue;
      }
    } else if (!cmd) {
      throw new SvgImportError('The SVG contains malformed path data.');
    }
    const rel = cmd === cmd.toLowerCase();
    const up = cmd.toUpperCase();
    switch (up) {
      case 'M': {
        const x = readNum() + (rel ? cx : 0);
        const y = readNum() + (rel ? cy : 0);
        cx = sx = x;
        cy = sy = y;
        cur = { start: [x, y], segs: [], closed: false };
        subs.push(cur);
        cmd = rel ? 'l' : 'L';
        lastKind = null;
        break;
      }
      case 'L': {
        const x = readNum() + (rel ? cx : 0);
        const y = readNum() + (rel ? cy : 0);
        ensure().segs.push(lineSeg([cx, cy], [x, y]));
        cx = x;
        cy = y;
        lastKind = null;
        break;
      }
      case 'H': {
        const x = readNum() + (rel ? cx : 0);
        ensure().segs.push(lineSeg([cx, cy], [x, cy]));
        cx = x;
        lastKind = null;
        break;
      }
      case 'V': {
        const y = readNum() + (rel ? cy : 0);
        ensure().segs.push(lineSeg([cx, cy], [cx, y]));
        cy = y;
        lastKind = null;
        break;
      }
      case 'C': {
        const x1 = readNum() + (rel ? cx : 0);
        const y1 = readNum() + (rel ? cy : 0);
        const x2 = readNum() + (rel ? cx : 0);
        const y2 = readNum() + (rel ? cy : 0);
        const x = readNum() + (rel ? cx : 0);
        const y = readNum() + (rel ? cy : 0);
        ensure().segs.push({ line: false, c1: [x1, y1], c2: [x2, y2], p: [x, y] });
        lastCtrl = [x2, y2];
        lastKind = 'C';
        cx = x;
        cy = y;
        break;
      }
      case 'S': {
        const x2 = readNum() + (rel ? cx : 0);
        const y2 = readNum() + (rel ? cy : 0);
        const x = readNum() + (rel ? cx : 0);
        const y = readNum() + (rel ? cy : 0);
        const c1: Pt = lastKind === 'C' && lastCtrl ? [2 * cx - lastCtrl[0], 2 * cy - lastCtrl[1]] : [cx, cy];
        ensure().segs.push({ line: false, c1, c2: [x2, y2], p: [x, y] });
        lastCtrl = [x2, y2];
        lastKind = 'C';
        cx = x;
        cy = y;
        break;
      }
      case 'Q': {
        const x1 = readNum() + (rel ? cx : 0);
        const y1 = readNum() + (rel ? cy : 0);
        const x = readNum() + (rel ? cx : 0);
        const y = readNum() + (rel ? cy : 0);
        ensure().segs.push(quadToCubic([cx, cy], [x1, y1], [x, y]));
        lastCtrl = [x1, y1];
        lastKind = 'Q';
        cx = x;
        cy = y;
        break;
      }
      case 'T': {
        const x = readNum() + (rel ? cx : 0);
        const y = readNum() + (rel ? cy : 0);
        const q: Pt = lastKind === 'Q' && lastCtrl ? [2 * cx - lastCtrl[0], 2 * cy - lastCtrl[1]] : [cx, cy];
        ensure().segs.push(quadToCubic([cx, cy], q, [x, y]));
        lastCtrl = q;
        lastKind = 'Q';
        cx = x;
        cy = y;
        break;
      }
      case 'A': {
        const rx = readNum();
        const ry = readNum();
        const rot = readNum();
        const fa = readFlag();
        const fs = readFlag();
        const x = readNum() + (rel ? cx : 0);
        const y = readNum() + (rel ? cy : 0);
        const s = ensure();
        for (const seg of arcToCubics(cx, cy, rx, ry, rot, fa, fs, x, y)) s.segs.push(seg);
        cx = x;
        cy = y;
        lastKind = null;
        break;
      }
      default:
        throw new SvgImportError(`The SVG path uses an unknown command "${cmd}".`);
    }
  }
  return subs.filter((s) => s.segs.length > 0);
}

function ellipseSubs(cx: number, cy: number, rx: number, ry: number): Sub[] {
  const kx = rx * KAPPA;
  const ky = ry * KAPPA;
  const segs: Seg[] = [
    { line: false, c1: [cx + rx, cy + ky], c2: [cx + kx, cy + ry], p: [cx, cy + ry] },
    { line: false, c1: [cx - kx, cy + ry], c2: [cx - rx, cy + ky], p: [cx - rx, cy] },
    { line: false, c1: [cx - rx, cy - ky], c2: [cx - kx, cy - ry], p: [cx, cy - ry] },
    { line: false, c1: [cx + kx, cy - ry], c2: [cx + rx, cy - ky], p: [cx + rx, cy] },
  ];
  return [{ start: [cx + rx, cy], segs, closed: true }];
}

function rectSubs(x: number, y: number, w: number, h: number, rxIn: number, ryIn: number): Sub[] {
  let rx = Math.min(Math.abs(rxIn), w / 2);
  let ry = Math.min(Math.abs(ryIn), h / 2);
  if (rx === 0 || ry === 0) {
    rx = 0;
    ry = 0;
  }
  if (rx === 0) {
    const p: Pt[] = [
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
    ];
    return [{ start: p[0], segs: [lineSeg(p[0], p[1]), lineSeg(p[1], p[2]), lineSeg(p[2], p[3]), lineSeg(p[3], p[0])], closed: true }];
  }
  const kx = rx * KAPPA;
  const ky = ry * KAPPA;
  const segs: Seg[] = [
    lineSeg([x + rx, y], [x + w - rx, y]),
    { line: false, c1: [x + w - rx + kx, y], c2: [x + w, y + ry - ky], p: [x + w, y + ry] },
    lineSeg([x + w, y + ry], [x + w, y + h - ry]),
    { line: false, c1: [x + w, y + h - ry + ky], c2: [x + w - rx + kx, y + h], p: [x + w - rx, y + h] },
    lineSeg([x + w - rx, y + h], [x + rx, y + h]),
    { line: false, c1: [x + rx - kx, y + h], c2: [x, y + h - ry + ky], p: [x, y + h - ry] },
    lineSeg([x, y + h - ry], [x, y + ry]),
    { line: false, c1: [x, y + ry - ky], c2: [x + rx - kx, y], p: [x + rx, y] },
  ];
  return [{ start: [x + rx, y], segs, closed: true }];
}

function pointsSubs(src: string, closed: boolean): Sub[] {
  const nums = src
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number)
    .filter((v) => Number.isFinite(v));
  const pts: Pt[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]);
  if (pts.length < 2) return [];
  const segs: Seg[] = [];
  for (let i = 1; i < pts.length; i++) segs.push(lineSeg(pts[i - 1], pts[i]));
  return [{ start: pts[0], segs, closed }];
}

// ---------------------------------------------------------------------------
// Colours and styles
// ---------------------------------------------------------------------------

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const NAMED: Record<string, [number, number, number]> = {
  black: [0, 0, 0],
  white: [255, 255, 255],
  gray: [128, 128, 128],
  grey: [128, 128, 128],
  silver: [192, 192, 192],
  red: [255, 0, 0],
  green: [0, 128, 0],
  lime: [0, 255, 0],
  blue: [0, 0, 255],
  yellow: [255, 255, 0],
  orange: [255, 165, 0],
  brown: [165, 42, 42],
  pink: [255, 192, 203],
  purple: [128, 0, 128],
  cyan: [0, 255, 255],
  magenta: [255, 0, 255],
  navy: [0, 0, 128],
  maroon: [128, 0, 0],
  teal: [0, 128, 128],
  gold: [255, 215, 0],
  beige: [245, 245, 220],
  ivory: [255, 255, 240],
  whitesmoke: [245, 245, 245],
  lightgray: [211, 211, 211],
  lightgrey: [211, 211, 211],
  darkgray: [169, 169, 169],
  darkgrey: [169, 169, 169],
  dimgray: [105, 105, 105],
  dimgrey: [105, 105, 105],
};

/** Returns null for "none"/"transparent"; throws nothing for unknown values (mid-tone). */
function parseColor(value: string, current: string): { color: Rgba | null; paintServer: boolean } {
  let v = value.trim().toLowerCase();
  if (v === 'none' || v === 'transparent' || v === '') return { color: null, paintServer: false };
  if (v === 'currentcolor') v = current.trim().toLowerCase();
  if (v.startsWith('url(')) return { color: { r: 90, g: 90, b: 90, a: 1 }, paintServer: true };
  let m = /^#([0-9a-f]{3,8})$/.exec(v);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
    if (h.length === 6 || h.length === 8) {
      return {
        color: {
          r: parseInt(h.slice(0, 2), 16),
          g: parseInt(h.slice(2, 4), 16),
          b: parseInt(h.slice(4, 6), 16),
          a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
        },
        paintServer: false,
      };
    }
  }
  m = /^rgba?\(([^)]*)\)/.exec(v);
  if (m) {
    const p = m[1].split(/[\s,/]+/).filter(Boolean);
    const ch = (s: string) => (s.endsWith('%') ? (parseFloat(s) / 100) * 255 : parseFloat(s));
    if (p.length >= 3) {
      return {
        color: { r: ch(p[0]), g: ch(p[1]), b: ch(p[2]), a: p[3] !== undefined ? (p[3].endsWith('%') ? parseFloat(p[3]) / 100 : parseFloat(p[3])) : 1 },
        paintServer: false,
      };
    }
  }
  const named = NAMED[v];
  if (named) return { color: { r: named[0], g: named[1], b: named[2], a: 1 }, paintServer: false };
  return { color: { r: 100, g: 100, b: 100, a: 1 }, paintServer: false };
}

const isLight = (c: Rgba) => (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255 >= 0.88;

interface Style {
  fill: string;
  stroke: string;
  strokeWidth: number;
  fillRule: 'nonzero' | 'evenodd';
  linecap: CapKind;
  linejoin: JoinKind;
  miter: number;
  fillOpacity: number;
  strokeOpacity: number;
  visibility: string;
  color: string;
}

const DEFAULT_STYLE: Style = {
  fill: 'black',
  stroke: 'none',
  strokeWidth: 1,
  fillRule: 'nonzero',
  linecap: 'butt',
  linejoin: 'miter',
  miter: 4,
  fillOpacity: 1,
  strokeOpacity: 1,
  visibility: 'visible',
  color: 'black',
};

const PRESENTATION = [
  'fill',
  'stroke',
  'stroke-width',
  'fill-rule',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'fill-opacity',
  'stroke-opacity',
  'opacity',
  'display',
  'visibility',
  'color',
  'clip-path',
  'mask',
  'filter',
  'stroke-dasharray',
];

interface CssRule {
  selector: string;
  decls: Record<string, string>;
}

function parseDecls(src: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of src.split(';')) {
    const i = part.indexOf(':');
    if (i > 0) out[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).replace(/!important/i, '').trim();
  }
  return out;
}

function parseCss(css: string): CssRule[] {
  const rules: CssRule[] = [];
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean))) {
    const decls = parseDecls(m[2]);
    for (const sel of m[1].split(',')) rules.push({ selector: sel.trim(), decls });
  }
  return rules;
}

function selectorMatches(sel: string, node: XmlNode): boolean {
  if (sel === '*') return true;
  const m = /^([A-Za-z][\w-]*)?(?:#([\w-]+))?((?:\.[\w-]+)*)$/.exec(sel);
  if (!m) return false;
  if (m[1] && m[1] !== node.name) return false;
  if (m[2] && node.attrs.id !== m[2]) return false;
  if (m[3]) {
    const classes = (node.attrs.class ?? '').split(/\s+/);
    for (const c of m[3].split('.').filter(Boolean)) if (!classes.includes(c)) return false;
  }
  return Boolean(m[1] || m[2] || m[3]);
}

const num = (v: string | undefined, def: number): number => {
  if (v === undefined) return def;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : def;
};

// ---------------------------------------------------------------------------
// Scene walk
// ---------------------------------------------------------------------------

interface ShapeRecord {
  subs: Sub[]; // already in document coordinates
  fillColor: Rgba | null;
  fillRule: 'nonzero' | 'evenodd';
  strokeColor: Rgba | null;
  strokeWidth: number; // document units (scaled by the transform)
  linecap: CapKind;
  linejoin: JoinKind;
  miter: number;
}

const SKIP = new Set([
  'defs',
  'symbol',
  'metadata',
  'title',
  'desc',
  'style',
  'script',
  'lineargradient',
  'radialgradient',
  'pattern',
  'clippath',
  'mask',
  'marker',
  'filter',
  'namedview',
  'font',
  'font-face',
  'view',
  'a_',
]);

function transformSubs(subs: Sub[], m: Matrix): Sub[] {
  return subs.map((s) => ({
    start: applyM(m, s.start),
    closed: s.closed,
    segs: s.segs.map((g) => ({ line: g.line, c1: applyM(m, g.c1), c2: applyM(m, g.c2), p: applyM(m, g.p) })),
  }));
}

function flattenSub(sub: Sub, step: number): Ring {
  const pts: Ring = [sub.start];
  let prev = sub.start;
  for (const g of sub.segs) {
    if (g.line) {
      pts.push(g.p);
    } else {
      const len =
        Math.hypot(g.c1[0] - prev[0], g.c1[1] - prev[1]) +
        Math.hypot(g.c2[0] - g.c1[0], g.c2[1] - g.c1[1]) +
        Math.hypot(g.p[0] - g.c2[0], g.p[1] - g.c2[1]);
      const n = Math.max(2, Math.min(60, Math.ceil(len / step)));
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        const u = 1 - t;
        pts.push([
          u * u * u * prev[0] + 3 * u * u * t * g.c1[0] + 3 * u * t * t * g.c2[0] + t * t * t * g.p[0],
          u * u * u * prev[1] + 3 * u * u * t * g.c1[1] + 3 * u * t * t * g.c2[1] + t * t * t * g.p[1],
        ]);
      }
    }
    prev = g.p;
  }
  // drop consecutive duplicates
  const out: Ring = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (!q || Math.abs(q[0] - p[0]) > 1e-9 || Math.abs(q[1] - p[1]) > 1e-9) out.push(p);
  }
  return out;
}

export function svgToRegion(svgText: string): SvgImportResult {
  if (!/<svg[\s>]/i.test(svgText)) throw new SvgImportError('This file does not look like an SVG image (no <svg> element found).');
  const doc = parseXml(svgText);
  const svgRoot = doc.children.find((c) => c.name.toLowerCase() === 'svg');
  if (!svgRoot) throw new SvgImportError('The SVG file could not be parsed.');

  const warnings = new Set<string>();
  const warn = (m: string) => warnings.add(m);

  // collect CSS and ids
  const rules: CssRule[] = [];
  const ids = new Map<string, XmlNode>();
  const prepass = (n: XmlNode) => {
    if (n.name.toLowerCase() === 'style') rules.push(...parseCss(n.text));
    if (n.attrs.id) ids.set(n.attrs.id, n);
    n.children.forEach(prepass);
  };
  prepass(svgRoot);

  const records: ShapeRecord[] = [];

  const resolve = (node: XmlNode, parent: Style): { style: Style; props: Record<string, string> } => {
    const props: Record<string, string> = {};
    for (const k of PRESENTATION) if (node.attrs[k] !== undefined) props[k] = node.attrs[k].trim();
    for (const r of rules) if (selectorMatches(r.selector, node)) Object.assign(props, r.decls);
    if (node.attrs.style) Object.assign(props, parseDecls(node.attrs.style));
    const s: Style = { ...parent };
    if (props.fill !== undefined && props.fill !== 'inherit') s.fill = props.fill;
    if (props.stroke !== undefined && props.stroke !== 'inherit') s.stroke = props.stroke;
    if (props['stroke-width'] !== undefined) s.strokeWidth = num(props['stroke-width'], s.strokeWidth);
    if (props['fill-rule'] !== undefined) s.fillRule = props['fill-rule'] === 'evenodd' ? 'evenodd' : 'nonzero';
    if (props['stroke-linecap'] !== undefined) s.linecap = props['stroke-linecap'] === 'round' ? 'round' : props['stroke-linecap'] === 'square' ? 'square' : 'butt';
    if (props['stroke-linejoin'] !== undefined) s.linejoin = props['stroke-linejoin'] === 'round' ? 'round' : props['stroke-linejoin'] === 'bevel' ? 'bevel' : 'miter';
    if (props['stroke-miterlimit'] !== undefined) s.miter = Math.max(1, num(props['stroke-miterlimit'], s.miter));
    if (props['fill-opacity'] !== undefined) s.fillOpacity = num(props['fill-opacity'], s.fillOpacity);
    if (props['stroke-opacity'] !== undefined) s.strokeOpacity = num(props['stroke-opacity'], s.strokeOpacity);
    if (props.visibility !== undefined) s.visibility = props.visibility;
    if (props.color !== undefined) s.color = props.color;
    return { style: s, props };
  };

  const walk = (node: XmlNode, matrix: Matrix, parent: Style, opacity: number, depth: number): void => {
    if (depth > 24) throw new SvgImportError('The SVG is nested too deeply (possible recursive <use>).');
    const lname = node.name.toLowerCase();
    if (SKIP.has(lname)) return;
    if (lname === 'image') throw new SvgImportError('This SVG contains an embedded bitmap (<image>). Export the artwork as paths, or upload it as a PNG/JPG instead.');
    if (lname === 'text' || lname === 'tspan') throw new SvgImportError('This SVG contains live text. Convert the text to outlines/paths in your vector editor (for example Inkscape: Path > Object to Path) and upload it again.');
    if (lname === 'foreignobject') throw new SvgImportError('This SVG contains <foreignObject> content, which cannot be converted to geometry.');

    const { style, props } = resolve(node, parent);
    if (props.display === 'none') return;
    const op = opacity * num(props.opacity, 1);
    if (op < 0.05) return;
    if (props['clip-path'] && props['clip-path'] !== 'none') warn('clip-path is ignored; the full unclipped shapes are used.');
    if (props.mask && props.mask !== 'none') warn('mask is ignored; the full unmasked shapes are used.');
    if (props.filter && props.filter !== 'none') warn('filters (blur, shadows, ...) are ignored.');

    const m = mul(matrix, parseTransform(node.attrs.transform));

    const container = lname === 'svg' || lname === 'g' || lname === 'switch' || lname === 'a';
    if (container) {
      if (lname === 'svg' && node !== svgRoot) warn('Nested <svg> elements are treated as groups.');
      for (const c of node.children) walk(c, m, style, op, depth + 1);
      return;
    }
    if (lname === 'use') {
      const href = (node.attrs.href ?? '').replace(/^#/, '');
      const target = ids.get(href);
      if (!target) {
        warn(`A <use> element refers to "${href}", which was not found.`);
        return;
      }
      const um = mul(m, [1, 0, 0, 1, num(node.attrs.x, 0), num(node.attrs.y, 0)]);
      if (target.name.toLowerCase() === 'symbol') for (const c of target.children) walk(c, um, style, op, depth + 1);
      else walk(target, um, style, op, depth + 1);
      return;
    }

    let subs: Sub[] = [];
    switch (lname) {
      case 'path':
        subs = parsePathData(node.attrs.d ?? '');
        break;
      case 'rect': {
        const w = num(node.attrs.width, 0);
        const h = num(node.attrs.height, 0);
        if (w > 0 && h > 0) {
          const rxA = node.attrs.rx !== undefined ? num(node.attrs.rx, 0) : undefined;
          const ryA = node.attrs.ry !== undefined ? num(node.attrs.ry, 0) : undefined;
          subs = rectSubs(num(node.attrs.x, 0), num(node.attrs.y, 0), w, h, rxA ?? ryA ?? 0, ryA ?? rxA ?? 0);
        }
        break;
      }
      case 'circle': {
        const r = num(node.attrs.r, 0);
        if (r > 0) subs = ellipseSubs(num(node.attrs.cx, 0), num(node.attrs.cy, 0), r, r);
        break;
      }
      case 'ellipse': {
        const rx = num(node.attrs.rx, 0);
        const ry = num(node.attrs.ry, 0);
        if (rx > 0 && ry > 0) subs = ellipseSubs(num(node.attrs.cx, 0), num(node.attrs.cy, 0), rx, ry);
        break;
      }
      case 'line':
        subs = pointsSubs(`${num(node.attrs.x1, 0)} ${num(node.attrs.y1, 0)} ${num(node.attrs.x2, 0)} ${num(node.attrs.y2, 0)}`, false);
        break;
      case 'polygon':
        subs = pointsSubs(node.attrs.points ?? '', true);
        break;
      case 'polyline':
        subs = pointsSubs(node.attrs.points ?? '', false);
        break;
      default:
        return; // unknown or non-graphical element
    }
    if (!subs.length || style.visibility === 'hidden' || style.visibility === 'collapse') return;

    const fill = parseColor(style.fill, style.color);
    const stroke = parseColor(style.stroke, style.color);
    if (fill.paintServer || stroke.paintServer) warn('Gradient or pattern fills are treated as solid colour.');
    if (props['stroke-dasharray'] && props['stroke-dasharray'] !== 'none') warn('Dashed strokes are drawn as solid lines.');

    const fillColor = fill.color && fill.color.a * style.fillOpacity * op >= 0.05 ? fill.color : null;
    const strokeColor = stroke.color && stroke.color.a * style.strokeOpacity * op >= 0.05 && style.strokeWidth > 0 ? stroke.color : null;
    if (!fillColor && !strokeColor) return;

    const det = Math.abs(m[0] * m[3] - m[1] * m[2]);
    records.push({
      subs: transformSubs(subs, m),
      fillColor,
      fillRule: style.fillRule,
      strokeColor,
      strokeWidth: style.strokeWidth * Math.sqrt(det || 1),
      linecap: style.linecap,
      linejoin: style.linejoin,
      miter: style.miter,
    });
    if (records.length > 4000) throw new SvgImportError('This SVG is too complex (more than 4000 shapes). Simplify the artwork and try again.');
  };

  walk(svgRoot, IDENTITY, DEFAULT_STYLE, 1, 0);

  if (records.length === 0) throw new SvgImportError('No visible filled or stroked shapes were found in this SVG.');

  // document extents from all control points
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const grow = (p: Pt, pad: number) => {
    if (p[0] - pad < minX) minX = p[0] - pad;
    if (p[0] + pad > maxX) maxX = p[0] + pad;
    if (p[1] - pad < minY) minY = p[1] - pad;
    if (p[1] + pad > maxY) maxY = p[1] + pad;
  };
  for (const r of records) {
    const pad = r.strokeColor ? r.strokeWidth / 2 : 0;
    for (const s of r.subs) {
      grow(s.start, pad);
      for (const g of s.segs) {
        grow(g.p, pad);
        if (!g.line) {
          grow(g.c1, pad);
          grow(g.c2, pad);
        }
      }
    }
  }
  const extent = Math.max(maxX - minX, maxY - minY);
  if (!Number.isFinite(extent) || extent <= 0) throw new SvgImportError('The SVG has no measurable size.');

  const k = 100 / extent; // normalise to a 100 unit working space
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const step = extent / 110; // curve flattening step, in document units
  const toWork = (p: Pt): Pt => [(p[0] - cx) * k, -(p[1] - cy) * k];

  let acc: Region = [];
  let pending: Region[] = [];
  const flush = () => {
    if (pending.length) {
      acc = unionAll([acc, ...pending]);
      pending = [];
    }
  };
  const paint = (region: Region, carve: boolean) => {
    if (!region.length) return;
    if (carve) {
      flush();
      acc = acc.length ? difference(acc, region) : acc;
    } else {
      pending.push(region);
    }
  };

  for (const r of records) {
    if (r.fillColor) {
      const rings = r.subs
        .map((s) => flattenSub({ ...s, start: s.start }, step).map(toWork))
        .filter((ring) => ring.length >= 3);
      if (rings.length) paint(ringsToRegion(rings, r.fillRule), isLight(r.fillColor));
    }
    if (r.strokeColor) {
      const paths: StrokePath[] = r.subs
        .map((s) => ({ points: flattenSub(s, step).map(toWork), closed: s.closed }))
        .filter((p) => p.points.length >= 2);
      // closed rings must not repeat their first point for the offsetter
      for (const p of paths) {
        if (p.closed && p.points.length > 2) {
          const a = p.points[0];
          const b = p.points[p.points.length - 1];
          if (Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9) p.points.pop();
        }
      }
      const region = strokeToRegion(paths, r.strokeWidth * k, r.linejoin, r.linecap, r.miter, 0.02);
      paint(region, isLight(r.strokeColor));
    }
  }
  flush();

  let region = simplifyRegion(acc, 0.01, 0.0005);
  region = region.length ? union(region, []) : region;
  if (region.length === 0) throw new SvgImportError('The SVG produced no printable shapes (everything was white or fully transparent).');

  const b = regionBounds(region)!;
  const fillRatio = regionArea(region) / Math.max(1e-9, (b.maxX - b.minX) * (b.maxY - b.minY));
  if (fillRatio > 0.92 && region.length === 1 && region[0].length === 1) {
    warn('The artwork is one solid block. If the SVG has a background rectangle, remove it so only the drawing is raised.');
  }

  return { region, warnings: Array.from(warnings), shapeCount: records.length };
}
