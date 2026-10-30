/**
 * Hole placement helpers shared by the editor UI, the reducer and the geometry builder.
 * Positions are "millimetres from the card's left edge / top edge" (the way users think
 * about them); conversions to centred model coordinates happen here.
 */
import {
  HOLE_PRESETS,
  presetPosition,
  type CardDimensions,
  type HolePreset,
} from '../../types/flashcard';
import { clampIntoRoundedRect, roundedRectSdf } from './primitives';

export function clampHoleCenter(
  x: number,
  y: number,
  dims: CardDimensions,
  diameter: number,
  edgeClearance: number,
): { x: number; y: number } {
  const [cx, cy] = clampIntoRoundedRect(
    x - dims.width / 2,
    dims.height / 2 - y,
    dims.width,
    dims.height,
    dims.cornerRadius,
    diameter / 2 + edgeClearance,
  );
  return { x: cx + dims.width / 2, y: dims.height / 2 - cy };
}

/** Millimetres of material between the hole's edge and the nearest card edge. */
export function holeWall(x: number, y: number, dims: CardDimensions, diameter: number): number {
  return -roundedRectSdf(x - dims.width / 2, dims.height / 2 - y, dims.width, dims.height, dims.cornerRadius) - diameter / 2;
}

/** The preset whose position equals (x, y), or 'custom'. */
export function matchPreset(x: number, y: number, dims: CardDimensions, diameter: number, tolerance = 0.06): HolePreset {
  for (const p of HOLE_PRESETS) {
    if (p.id === 'custom') continue;
    const pos = presetPosition(p.id, dims, diameter);
    if (Math.abs(pos.x - x) <= tolerance && Math.abs(pos.y - y) <= tolerance) return p.id;
  }
  return 'custom';
}

export const round2 = (v: number): number => Math.round(v * 100) / 100;

export interface HolePlacement {
  x: number;
  y: number;
  preset: HolePreset;
  /** the requested spot was invalid and was moved to the nearest valid one */
  adjusted: boolean;
}

/**
 * Turns a requested hole centre (mm from left/top) into a valid one: clamps it so that
 * `edgeClearance` of material always remains around the hole, and reports whether the
 * result equals one of the presets.
 */
export function computeHolePlacement(
  x: number,
  y: number,
  dims: CardDimensions,
  diameter: number,
  edgeClearance: number,
): HolePlacement {
  const c = clampHoleCenter(x, y, dims, diameter, edgeClearance);
  return {
    x: round2(c.x),
    y: round2(c.y),
    preset: matchPreset(c.x, c.y, dims, diameter),
    adjusted: Math.hypot(c.x - x, c.y - y) > 0.05,
  };
}
