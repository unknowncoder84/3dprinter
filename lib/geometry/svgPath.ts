import type { Region } from './region';

/**
 * Region in card coordinates (centred, +Y up) -> SVG path data in card-corner coordinates
 * (origin top-left, +Y down, millimetres). Used by the 2D hole-placement and illustration
 * previews, which therefore show exactly the geometry that is extruded.
 */
export function regionToSvgPath(region: Region, width: number, height: number): string {
  const f = (v: number) => (Math.round(v * 100) / 100).toString();
  const parts: string[] = [];
  for (const poly of region) {
    for (const ring of poly) {
      ring.forEach(([x, y], i) => {
        parts.push(`${i === 0 ? 'M' : 'L'}${f(x + width / 2)} ${f(height / 2 - y)}`);
      });
      parts.push('Z');
    }
  }
  return parts.join('');
}

/** Same, but fitted into a viewBox of its own bounds (for the small illustration preview). */
export function regionToFittedPath(region: Region): { d: string; viewBox: string } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const poly of region) {
    for (const [x, y] of poly[0] ?? []) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (!Number.isFinite(minX)) return null;
  const f = (v: number) => (Math.round(v * 100) / 100).toString();
  const parts: string[] = [];
  for (const poly of region) {
    for (const ring of poly) {
      ring.forEach(([x, y], i) => parts.push(`${i === 0 ? 'M' : 'L'}${f(x - minX)} ${f(maxY - y)}`));
      parts.push('Z');
    }
  }
  const pad = 1;
  return { d: parts.join(''), viewBox: `${-pad} ${-pad} ${maxX - minX + 2 * pad} ${maxY - minY + 2 * pad}` };
}
