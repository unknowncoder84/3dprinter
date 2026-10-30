/**
 * Binary STL writer/reader.
 *
 * Units: millimetres. Coordinates are exactly the model coordinates used by the preview
 * (origin at the card centre, back face at Z = 0, front face towards +Z).
 */
import { validatePositions, type MeshValidation } from '../geometry/validate';

const HEADER = 'Flashcard Studio STL - units: millimetres';

export function positionsToStl(positions: Float32Array): ArrayBuffer {
  const tris = positions.length / 9;
  const buf = new ArrayBuffer(84 + tris * 50);
  const view = new DataView(buf);
  for (let i = 0; i < HEADER.length && i < 80; i++) view.setUint8(i, HEADER.charCodeAt(i));
  view.setUint32(80, tris, true);
  let off = 84;
  for (let t = 0; t < tris; t++) {
    const o = t * 9;
    const ux = positions[o + 3] - positions[o];
    const uy = positions[o + 4] - positions[o + 1];
    const uz = positions[o + 5] - positions[o + 2];
    const vx = positions[o + 6] - positions[o];
    const vy = positions[o + 7] - positions[o + 1];
    const vz = positions[o + 8] - positions[o + 2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    view.setFloat32(off, nx, true);
    view.setFloat32(off + 4, ny, true);
    view.setFloat32(off + 8, nz, true);
    for (let k = 0; k < 9; k++) view.setFloat32(off + 12 + k * 4, positions[o + k], true);
    view.setUint16(off + 48, 0, true);
    off += 50;
  }
  return buf;
}

export class StlParseError extends Error {}

/** Parse a binary STL back into a triangle soup. ASCII STL is detected and rejected clearly. */
export function stlToPositions(buf: ArrayBuffer): Float32Array {
  if (buf.byteLength < 84) throw new StlParseError('File is too small to be an STL.');
  const view = new DataView(buf);
  const tris = view.getUint32(80, true);
  if (84 + tris * 50 !== buf.byteLength) {
    const head = new TextDecoder().decode(new Uint8Array(buf, 0, Math.min(5, buf.byteLength)));
    if (head.toLowerCase() === 'solid') throw new StlParseError('ASCII STL files are not supported by this checker.');
    throw new StlParseError(`Binary STL size mismatch: header says ${tris} triangles but the file is ${buf.byteLength} bytes.`);
  }
  const out = new Float32Array(tris * 9);
  let off = 84;
  for (let t = 0; t < tris; t++) {
    for (let k = 0; k < 9; k++) out[t * 9 + k] = view.getFloat32(off + 12 + k * 4, true);
    off += 50;
  }
  return out;
}

export interface StlReport {
  fileBytes: number;
  validation: MeshValidation;
}

/** Re-reads the exported bytes and validates them, so the report describes the real file. */
export function analyzeStl(buf: ArrayBuffer): StlReport {
  const positions = stlToPositions(buf);
  return { fileBytes: buf.byteLength, validation: validatePositions(positions) };
}

export function mergeParts(parts: Array<{ positions: Float32Array }>): Float32Array {
  let n = 0;
  for (const p of parts) n += p.positions.length;
  const out = new Float32Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p.positions, o);
    o += p.positions.length;
  }
  return out;
}

/** "A_ant.stl": first letter of the alphabet field + slug of the word. */
export function stlFileName(alphabet: string, word: string): string {
  const letter = (Array.from(alphabet.trim()).find((c) => /[\p{L}\p{N}]/u.test(c)) ?? 'card').toUpperCase();
  const slug = word
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug ? `${letter}_${slug}.stl` : `${letter}.stl`;
}
