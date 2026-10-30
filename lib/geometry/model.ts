/**
 * The single geometry pipeline. The editor preview, the STL export and the batch/ZIP export
 * all call buildFlashcardModel() and consume the same triangles, so they cannot disagree.
 *
 * Coordinates (millimetres): origin at the card centre, +X right, +Y up the card face,
 * +Z out of the front face. Back face at Z = 0, front surface at Z = thickness.
 */
import type { CardImage, FlashcardConfig, ImageSettings } from '../../types/flashcard';
import { difference, intersection, offsetRegion, overlapArea, unionAll } from './clip';
import type { LoadedFont } from './fonts';
import type { ImageConversion } from './imageConvert';
import { circleRegion, qualityProfile, roundedRectRegion, roundedRectSdf } from './primitives';
import {
  regionArea,
  regionBounds,
  scaleRegion,
  simplifyRegion,
  translateRegion,
  type Bounds2,
  type Region,
} from './region';
import { buildSolid, type MeshPart, type PartRole } from './solid';
import { textToRegion, type TextOutline } from './textOutline';
import { validatePositions, type MeshValidation } from './validate';
import { mergeParts } from '../export/stl';

export type { MeshPart, PartRole } from './solid';

export interface ModelDeps {
  getFont(fontId: string): Promise<LoadedFont>;
  convertImage(image: CardImage, settings: ImageSettings): Promise<ImageConversion>;
}

export type IssueSeverity = 'error' | 'warning' | 'info';
export interface ModelIssue {
  severity: IssueSeverity;
  code: string;
  message: string;
}

export interface FlashcardModel {
  parts: MeshPart[];
  bounds: { min: [number, number, number]; max: [number, number, number] };
  expected: { width: number; height: number; thickness: number; maxZ: number };
  /** 2D footprints (card coordinates) used for the hole-placement view. */
  layers: { card: Region; alphabet: Region; word: Region; image: Region };
  placements: { alphabet: Bounds2 | null; word: Bounds2 | null; image: Bounds2 | null };
  issues: ModelIssue[];
  /** true when the model must not be exported (e.g. illustration conversion failed). */
  blocking: boolean;
  validation: MeshValidation;
  imageInfo: string | null;
  buildMs: number;
  /** Milliseconds spent per stage (diagnostics). */
  timings: Record<string, number>;
}

export class ModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelError';
  }
}

export interface BuildOptions {
  isCancelled?: () => boolean;
}

const yieldToUi = () => new Promise<void>((r) => setTimeout(r, 0));

// --- small result caches (text outlines are the same until text/font/size change) ---------
const textCache = new Map<string, TextOutline>();
function cachedText(fontId: string, font: LoadedFont, text: string, cap: number, spacing: number): TextOutline {
  const key = [fontId, font.fontId, text, cap, spacing].join('\u0001');
  const hit = textCache.get(key);
  if (hit) return hit;
  const out = textToRegion(font.font, text, cap, spacing);
  textCache.set(key, out);
  if (textCache.size > 48) textCache.delete(textCache.keys().next().value as string);
  return out;
}

function finite(name: string, v: number, min: number, max: number): void {
  if (!Number.isFinite(v) || v < min || v > max) {
    throw new ModelError(`${name} must be between ${min} and ${max} (currently ${String(v)}).`);
  }
}

function cleanRegion(region: Region, minArea = 0.02): Region {
  if (!region.length) return region;
  const simple = simplifyRegion(region, 0.015, minArea);
  return simple.length ? unionAll([simple]) : [];
}

interface Fitted {
  region: Region;
  bounds: Bounds2 | null;
  scale: number;
}

function fitWidth(outline: TextOutline, availW: number, autoFit: boolean): Fitted {
  if (!outline.bounds) return { region: [], bounds: null, scale: 1 };
  const w = outline.bounds.maxX - outline.bounds.minX;
  let scale = 1;
  if (autoFit && w > availW && w > 0) scale = availW / w;
  const region = scale === 1 ? outline.region : scaleRegion(outline.region, scale);
  return { region, bounds: regionBounds(region), scale };
}

function alignDx(b: Bounds2, align: 'left' | 'center' | 'right', W: number, margin: number): number {
  if (align === 'left') return -W / 2 + margin - b.minX;
  if (align === 'right') return W / 2 - margin - b.maxX;
  return -(b.minX + b.maxX) / 2;
}

export async function buildFlashcardModel(
  cfg: FlashcardConfig,
  deps: ModelDeps,
  opts: BuildOptions = {},
): Promise<FlashcardModel> {
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const t0 = now();
  const timings: Record<string, number> = {};
  let tick = t0;
  const mark = (name: string) => {
    const t = now();
    timings[name] = Math.round(t - tick);
    tick = t;
  };
  const cancelled = () => Boolean(opts.isCancelled?.());
  const issues: ModelIssue[] = [];
  const warn = (code: string, message: string) => issues.push({ severity: 'warning', code, message });
  const error = (code: string, message: string) => issues.push({ severity: 'error', code, message });

  const { width: W, height: H, thickness: T, cornerRadius: R } = cfg.dimensions;
  finite('Width', W, 20, 400);
  finite('Height', H, 20, 400);
  finite('Thickness', T, 0.4, 40);
  finite('Corner radius', R, 0, Math.min(W, H) / 2);
  const ts = cfg.textSettings;
  const is = cfg.imageSettings;
  const hs = cfg.holeSettings;
  const gs = cfg.geometrySettings;
  finite('Alphabet height', ts.alphabetHeight, 0.1, 20);
  finite('Word height', ts.wordHeight, 0.1, 20);
  finite('Image relief height', is.reliefHeight, 0.1, 20);

  const q = qualityProfile(gs.quality);
  const card = roundedRectRegion(0, 0, W, H, R, q.cornerSegments);

  // ---- hanging hole --------------------------------------------------------------------
  let base = card;
  let holeDisc: Region = [];
  if (hs.enabled) {
    finite('Hole diameter', hs.diameter, 1, Math.min(W, H));
    const hx = hs.x - W / 2;
    const hy = H / 2 - hs.y;
    const r = hs.diameter / 2;
    const wall = -roundedRectSdf(hx, hy, W, H, R) - r; // material left between hole and card edge
    if (wall < 0.5) {
      error('hole-edge', `The hole touches or crosses the card edge (only ${wall.toFixed(1)} mm of material). Move it inwards or make it smaller.`);
    } else {
      if (wall < gs.edgeClearance) {
        warn('hole-wall', `Only ${wall.toFixed(1)} mm of material remains between the hole and the card edge. That may be fragile when printed.`);
      }
      holeDisc = circleRegion(hx, hy, r, q.circleSegments);
      base = difference(card, holeDisc);
    }
  }

  // ---- text ----------------------------------------------------------------------------
  const alphabetText = cfg.alphabet.trim();
  const wordText = cfg.word.trim();
  let alphaOutline: TextOutline | null = null;
  let wordOutline: TextOutline | null = null;
  if (alphabetText || wordText) {
    finite('Alphabet size', ts.alphabetSize, 2, 300);
    finite('Word size', ts.wordSize, 2, 300);
    let loaded: LoadedFont;
    try {
      loaded = await deps.getFont(ts.fontId);
    } catch (e) {
      throw new ModelError(e instanceof Error ? e.message : 'The font could not be loaded.');
    }
    if (loaded.note) warn('font-fallback', loaded.note);
    if (alphabetText) alphaOutline = cachedText(ts.fontId, loaded, alphabetText, ts.alphabetSize, ts.letterSpacing);
    if (wordText) wordOutline = cachedText(ts.fontId, loaded, wordText, ts.wordSize, ts.letterSpacing);
    for (const [label, o] of [
      ['alphabet', alphaOutline],
      ['word', wordOutline],
    ] as const) {
      if (o && o.missing.length) {
        warn('missing-glyph', `The font has no glyph for ${o.missing.map((c) => `"${c}"`).join(', ')} in the ${label}; ${o.missing.length > 1 ? 'those characters were' : 'that character was'} skipped.`);
      }
    }
  }
  mark('base+text');
  if (cancelled()) throw new ModelError('cancelled');
  await yieldToUi();

  // ---- illustration --------------------------------------------------------------------
  let imageArt: Region = [];
  let imageInfo: string | null = null;
  let blocking = false;
  if (cfg.image) {
    try {
      const conv = await deps.convertImage(cfg.image, is);
      imageArt = conv.region;
      imageInfo = conv.info;
      for (const w of conv.warnings) warn('image', w);
      if (conv.region.length === 0) {
        error('image-empty', 'The illustration produced no raised shapes. Adjust the conversion settings or upload simpler artwork.');
        blocking = true;
      }
    } catch (e) {
      error('image-failed', `The illustration could not be converted: ${e instanceof Error ? e.message : String(e)}`);
      blocking = true;
    }
  }
  mark('image');
  if (cancelled()) throw new ModelError('cancelled');
  await yieldToUi();

  // ---- layout (all positions derive from the card size and the real glyph bounds) ------
  const sideMargin = Math.max(5, 0.08 * W);
  const availW = W - 2 * sideMargin;
  const topMargin = 0.13 * H;
  const bottomMargin = 0.085 * H;
  const gap = 0.05 * H;

  let alphaRegion: Region = [];
  let alphaBottom = H / 2 - topMargin;
  if (alphaOutline && alphaOutline.bounds) {
    const f = fitWidth(alphaOutline, availW, ts.autoFit);
    if (f.scale < 1) warn('text-fit', `The alphabet was scaled to ${Math.round(f.scale * 100)}% to fit the card width.`);
    const b = f.bounds!;
    const dy = H / 2 - topMargin - b.maxY;
    const dx = alignDx(b, ts.alphabetAlign, W, sideMargin);
    alphaRegion = translateRegion(f.region, dx + ts.alphabetOffsetX, dy + ts.alphabetOffsetY);
    alphaBottom = b.minY + dy;
  }

  let wordRegion: Region = [];
  let wordTop = -H / 2 + bottomMargin;
  if (wordOutline && wordOutline.bounds) {
    const f = fitWidth(wordOutline, availW, ts.autoFit);
    if (f.scale < 1) warn('text-fit', `The word was scaled to ${Math.round(f.scale * 100)}% to fit the card width.`);
    const b = f.bounds!;
    const em = wordOutline.em * f.scale;
    const baseline = -H / 2 + bottomMargin + Math.max(0.2 * em, -b.minY);
    const dx = alignDx(b, ts.wordAlign, W, sideMargin);
    wordRegion = translateRegion(f.region, dx + ts.wordOffsetX, baseline + ts.wordOffsetY);
    wordTop = baseline + b.maxY;
  }

  let imageRegion: Region = [];
  if (imageArt.length) {
    const ab = regionBounds(imageArt)!;
    const aw = ab.maxX - ab.minX;
    const ah = ab.maxY - ab.minY;
    const zoneTop = alphaBottom - gap;
    const zoneBottom = wordTop + gap;
    const zoneH = zoneTop - zoneBottom;
    const maxH = Math.max(4, Math.min(is.maxHeight, zoneH));
    const maxW = Math.min(is.maxWidth, availW);
    if (zoneH < Math.min(is.maxHeight, 12)) {
      warn('image-space', 'There is little room for the illustration between the letter and the word. Reduce the text sizes or make the card taller.');
    }
    const s = Math.min(maxW / aw, maxH / ah);
    const cx = (ab.minX + ab.maxX) / 2;
    const cy = (ab.minY + ab.maxY) / 2;
    const zoneC = (zoneTop + zoneBottom) / 2;
    imageRegion = translateRegion(scaleRegion(translateRegion(imageArt, -cx, -cy), s), is.offsetX, zoneC + is.offsetY);
  }
  mark('layout');
  if (cancelled()) throw new ModelError('cancelled');

  // ---- keep raised details inside the usable area -------------------------------------
  const usable = offsetRegion(card, -gs.edgeClearance);
  const holeZone = holeDisc.length ? offsetRegion(holeDisc, gs.holeClearance) : [];
  const featureArea = holeZone.length ? difference(usable, holeZone) : usable;

  const trim = (label: string, raw: Region): Region => {
    if (!raw.length) return raw;
    const beyond = regionArea(difference(raw, usable));
    const nearHole = holeZone.length ? overlapArea(raw, holeZone) : 0;
    if (beyond > 0.05) warn('edge-trim', `The ${label} extends beyond the usable card area (it must stay ${gs.edgeClearance} mm from the edge) and was trimmed.`);
    if (nearHole > 0.05) warn('hole-collision', `The hole is too close to, or overlaps, the ${label}. The ${label} was trimmed around the hole.`);
    return cleanRegion(intersection(raw, featureArea));
  };
  let alpha = trim('alphabet', alphaRegion);
  let word = trim('word', wordRegion);
  let image = trim('illustration', imageRegion);

  if (word.length && alpha.length) {
    const guard = offsetRegion(alpha, 0.4);
    if (overlapArea(word, guard) > 0.1) {
      warn('overlap', 'The word overlaps the alphabet and was trimmed around it.');
      word = cleanRegion(difference(word, guard));
    }
  }
  if (image.length && (alpha.length || word.length)) {
    const guard = offsetRegion(unionAll([alpha, word]), 0.4);
    if (overlapArea(image, guard) > 0.1) {
      warn('overlap', 'The illustration overlaps the alphabet or word and was trimmed around them.');
      image = cleanRegion(difference(image, guard));
    }
  }
  if (cfg.image && imageArt.length && image.length === 0 && !blocking) {
    error('image-trimmed', 'The illustration ended up completely outside the usable card area. Check its size and position.');
    blocking = true;
  }
  if (alphabetText && alpha.length === 0 && alphaOutline?.bounds) warn('empty', 'The alphabet is not visible on the card (it was trimmed away entirely).');
  if (wordText && word.length === 0 && wordOutline?.bounds) warn('empty', 'The word is not visible on the card (it was trimmed away entirely).');

  mark('clip');
  if (cancelled()) throw new ModelError('cancelled');
  await yieldToUi();

  // ---- solid ---------------------------------------------------------------------------
  if (issues.some((i) => i.code === 'hole-edge')) blocking = true;
  const parts = buildSolid(base, T, [
    { role: 'alphabet', region: alpha, height: ts.alphabetHeight },
    { role: 'word', region: word, height: ts.wordHeight },
    { role: 'image', region: image, height: is.reliefHeight },
  ]);
  mark('solid');

  const all = mergeParts(parts);
  const validation = validatePositions(all);
  mark('validate');
  if (validation.status === 'error') {
    for (const m of validation.messages) error('mesh', `Mesh check failed: ${m}`);
    blocking = true;
  } else if (validation.status === 'warning') {
    for (const m of validation.messages) warn('mesh', m);
  }

  const maxRaise = Math.max(
    alpha.length ? ts.alphabetHeight : 0,
    word.length ? ts.wordHeight : 0,
    image.length ? is.reliefHeight : 0,
  );
  const t1 = now();

  return {
    parts,
    bounds: { min: validation.boundsMin, max: validation.boundsMax },
    expected: { width: W, height: H, thickness: T, maxZ: T + maxRaise },
    layers: { card, alphabet: alpha, word, image },
    placements: { alphabet: regionBounds(alpha), word: regionBounds(word), image: regionBounds(image) },
    issues,
    blocking,
    validation,
    imageInfo,
    buildMs: Math.round(t1 - t0),
    timings,
  };
}

export function partsByRole(model: FlashcardModel, role: PartRole): MeshPart | undefined {
  return model.parts.find((p) => p.role === role);
}

