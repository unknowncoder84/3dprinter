import type { CurveQuality } from '../../types/flashcard';
import type { Region, Ring } from './region';

export interface QualityProfile {
  /** segments in one 90 degree corner arc */
  cornerSegments: number;
  /** segments in a full circle */
  circleSegments: number;
}

export function qualityProfile(q: CurveQuality): QualityProfile {
  switch (q) {
    case 'low':
      return { cornerSegments: 8, circleSegments: 32 };
    case 'high':
      return { cornerSegments: 24, circleSegments: 96 };
    default:
      return { cornerSegments: 14, circleSegments: 56 };
  }
}

/** Counter-clockwise rounded rectangle centred on (cx, cy). */
export function roundedRectRing(
  cx: number,
  cy: number,
  width: number,
  height: number,
  radius: number,
  cornerSegments: number,
): Ring {
  const hw = width / 2;
  const hh = height / 2;
  const r = Math.max(0, Math.min(radius, hw, hh));
  if (r < 1e-6) {
    return [
      [cx - hw, cy - hh],
      [cx + hw, cy - hh],
      [cx + hw, cy + hh],
      [cx - hw, cy + hh],
    ];
  }
  const ring: Ring = [];
  const corners: Array<[number, number, number]> = [
    [cx + hw - r, cy - hh + r, -90], // bottom-right
    [cx + hw - r, cy + hh - r, 0], // top-right
    [cx - hw + r, cy + hh - r, 90], // top-left
    [cx - hw + r, cy - hh + r, 180], // bottom-left
  ];
  for (const [ox, oy, start] of corners) {
    for (let i = 0; i <= cornerSegments; i++) {
      const a = ((start + (90 * i) / cornerSegments) * Math.PI) / 180;
      ring.push([ox + r * Math.cos(a), oy + r * Math.sin(a)]);
    }
  }
  return ring;
}

/** Counter-clockwise regular polygon approximating a circle. */
export function circleRing(cx: number, cy: number, radius: number, segments: number): Ring {
  const ring: Ring = [];
  for (let i = 0; i < segments; i++) {
    const a = (2 * Math.PI * i) / segments;
    ring.push([cx + radius * Math.cos(a), cy + radius * Math.sin(a)]);
  }
  return ring;
}

export function circleRegion(cx: number, cy: number, radius: number, segments: number): Region {
  return [[circleRing(cx, cy, radius, segments)]];
}

export function roundedRectRegion(
  cx: number,
  cy: number,
  width: number,
  height: number,
  radius: number,
  cornerSegments: number,
): Region {
  return [[roundedRectRing(cx, cy, width, height, radius, cornerSegments)]];
}

/**
 * Signed distance from point to a centred rounded rectangle (negative inside).
 * Used to validate and clamp hole positions.
 */
export function roundedRectSdf(px: number, py: number, width: number, height: number, radius: number): number {
  const hw = width / 2;
  const hh = height / 2;
  const r = Math.max(0, Math.min(radius, hw, hh));
  const qx = Math.abs(px) - (hw - r);
  const qy = Math.abs(py) - (hh - r);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  const inside = Math.min(Math.max(qx, qy), 0);
  return outside + inside - r;
}

/**
 * Nearest point to (px, py) inside a centred rounded rectangle shrunk by `margin`.
 * Returns the point unchanged when it is already inside.
 */
export function clampIntoRoundedRect(
  px: number,
  py: number,
  width: number,
  height: number,
  radius: number,
  margin: number,
): [number, number] {
  const hw = Math.max(0, width / 2 - margin);
  const hh = Math.max(0, height / 2 - margin);
  const r = Math.max(0, Math.min(Math.max(0, radius - margin), hw, hh));
  const bx = hw - r;
  const by = hh - r;
  const sx = px < 0 ? -1 : 1;
  const sy = py < 0 ? -1 : 1;
  const ax = Math.abs(px);
  const ay = Math.abs(py);
  const cx = Math.min(ax, bx);
  const cy = Math.min(ay, by);
  const dx = ax - cx;
  const dy = ay - cy;
  const d = Math.hypot(dx, dy);
  if (d <= r + 1e-9) return [px, py];
  const k = r / d;
  return [sx * (cx + dx * k), sy * (cy + dy * k)];
}
