/**
 * The single geometry pipeline. The editor preview, the STL export and the batch/ZIP export
 * all call buildFlashcardModel() and consume the same triangles, so they cannot disagree.
 *
 * Coordinates (millimetres): origin at the card centre, +X right, +Y up the card face,
 * +Z out of the front face. Back face at Z = 0, front surface at Z = thickness.
 */
import type { CardImage, FlashcardConfig, ImageSettings, ReliefMode } from '../../types/flashcard';
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
import { buildSolid, type FeatureMode, type MeshPart, type PartRole, type RaisedFeature } from './solid';
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
  layers: { card: Region; alphabet: Region; word: Region; wordOutline: Region; image: Region; border: Region };
  placements: { alphabet: Bounds2 | null; word: Bounds2 | null; wordOutline: Bounds2 | null; image: Bounds2 | null; border: Bounds2 | null };
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
  const maxEngraveDepth = Math.max(0.1, T - 0.2);
  const safeDepth = (label: string, height: number, mode: ReliefMode): number => {
    if (mode !== 'engraved') return height;
    if (height >= maxEngraveDepth) {
      error('engrave-depth', `${label} engraving is deeper than the card allows. It was limited to ${maxEngraveDepth.toFixed(2)} mm; increase card thickness before exporting.`);
      return maxEngraveDepth;
    }
    return height;
  };
  const alphabetHeight = safeDepth('Alphabet', ts.alphabetHeight, ts.alphabetRelief);
  const wordHeight = safeDepth('Word', ts.wordHeight, ts.wordRelief);
  const imageHeight = safeDepth('Illustration', is.reliefHeight, is.reliefMode);
  const borderHeight = safeDepth('Border', cfg.appearance.borderHeight, cfg.appearance.borderStyle === 'engraved' ? 'engraved' : 'raised');
  const featureEntries = (
    role: Exclude<PartRole, 'base' | 'pattern-outline'>,
    region: Region,
    height: number,
    mode: ReliefMode,
  ): RaisedFeature[] => {
    if (!region.length) return [];
    if (mode !== 'engraved-filled') {
      return [{ role, region, height, mode: (mode === 'engraved' ? 'engraved' : 'raised') as FeatureMode }];
    }
    if (role === 'word-outline' && mode === 'engraved-filled') {
      // The word's own engraved trench already supplies the inner outline; keep the optional
      // user outline as a raised ring outside that trench to avoid overlapping shells.
      return [{ role, region, height, mode: 'raised' }];
    }
    const fill = region;
    // Keep the source boundary verbatim. Re-unioning a glyph with counters can slightly
    // move its seam vertices, which would leave a tiny open edge between the raised fill and
    // its engraved trench in the final solid.
    const outlineSource = role === 'border' ? region : region.map((poly) => [poly[0]]);
    const trench = difference(offsetRegion(outlineSource, 0.35, 'round'), outlineSource);
    if (height >= maxEngraveDepth) warn('engrave-depth', `${role} engraving outline was limited to ${maxEngraveDepth.toFixed(2)} mm by the card thickness.`);
    return [
      { role, region: fill.length ? fill : region, height, mode: 'raised' as FeatureMode },
      { role: 'pattern-outline', region: trench, height: Math.min(height, maxEngraveDepth), mode: 'engraved' as FeatureMode },
    ];
  };
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
  let wordTextOutline: TextOutline | null = null;
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
    if (wordText) wordTextOutline = cachedText(ts.fontId, loaded, wordText, ts.wordSize, ts.letterSpacing);
    for (const [label, o] of [
      ['alphabet', alphaOutline],
      ['word', wordTextOutline],
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
  if (wordTextOutline && wordTextOutline.bounds) {
    const f = fitWidth(wordTextOutline, availW, ts.autoFit);
    if (f.scale < 1) warn('text-fit', `The word was scaled to ${Math.round(f.scale * 100)}% to fit the card width.`);
    const b = f.bounds!;
    const em = wordTextOutline.em * f.scale;
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

  // A border is part of the shared solid, not a viewer-only decoration. Build it as a
  // rounded rectangular ring inside the usable card area, then keep text and artwork away
  // from it so the exported mesh has no overlapping raised shells.
  let borderRaw: Region = [];
  if (cfg.appearance.borderStyle !== 'none') {
    const outerWidth = W - 2 * gs.edgeClearance;
    const outerHeight = H - 2 * gs.edgeClearance;
    const outerRadius = Math.max(0, R - gs.edgeClearance);
    const innerWidth = outerWidth - 2 * cfg.appearance.borderWidth;
    const innerHeight = outerHeight - 2 * cfg.appearance.borderWidth;
    const innerRadius = Math.max(0, outerRadius - cfg.appearance.borderWidth);
    if (innerWidth > 4 && innerHeight > 4) {
      const outer = roundedRectRegion(0, 0, outerWidth, outerHeight, outerRadius, q.cornerSegments);
      const inner = roundedRectRegion(0, 0, innerWidth, innerHeight, innerRadius, q.cornerSegments);
      borderRaw = difference(outer, inner);
    } else {
      warn('border-size', 'The selected border is too wide for this card and was disabled for this model.');
    }
  }
  let border = borderRaw.length ? cleanRegion(intersection(borderRaw, featureArea)) : [];
  const borderGuard = border.length ? offsetRegion(border, 0.4) : [];
  const contentArea = borderGuard.length ? difference(featureArea, borderGuard) : featureArea;

  const trim = (label: string, raw: Region, allowed: Region = contentArea): Region => {
    if (!raw.length) return raw;
    const beyond = regionArea(difference(raw, usable));
    const nearHole = holeZone.length ? overlapArea(raw, holeZone) : 0;
    if (beyond > 0.05) warn('edge-trim', `The ${label} extends beyond the usable card area (it must stay ${gs.edgeClearance} mm from the edge) and was trimmed.`);
    if (nearHole > 0.05) warn('hole-collision', `The hole is too close to, or overlaps, the ${label}. The ${label} was trimmed around the hole.`);
    return cleanRegion(intersection(raw, allowed));
  };
  if (borderRaw.length && border.length === 0) warn('border-trimmed', 'The border was fully trimmed by the hole or card clearances.');
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
  let wordOutline: Region = [];
  if (word.length && cfg.appearance.wordOutlineWidth > 0) {
    const outlineGap = ts.wordRelief === 'engraved-filled' ? 0.4 : 0;
    const inner = outlineGap > 0 ? offsetRegion(word, outlineGap, 'round') : word;
    const expanded = offsetRegion(word, cfg.appearance.wordOutlineWidth + outlineGap, 'round');
    wordOutline = trim('word outline', difference(expanded, inner));
    if (alpha.length) wordOutline = cleanRegion(difference(wordOutline, offsetRegion(alpha, 0.4)));
    if (wordOutline.length === 0) warn('word-outline-trimmed', 'The word outline was fully trimmed by the card or another feature.');
  }

  if (image.length && (alpha.length || word.length || wordOutline.length)) {
    const guard = offsetRegion(unionAll([alpha, word, wordOutline]), 0.4);
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
  if (wordText && wordRegion.length === 0 && wordTextOutline?.bounds) warn('empty', 'The word is not visible on the card (it was trimmed away entirely).');

  mark('clip');
  if (cancelled()) throw new ModelError('cancelled');
  await yieldToUi();

  // ---- solid ---------------------------------------------------------------------------
  if (issues.some((i) => i.code === 'hole-edge' || i.code === 'engrave-depth')) blocking = true;
  const parts = buildSolid(base, T, [
    ...featureEntries('alphabet', alpha, alphabetHeight, ts.alphabetRelief),
    ...featureEntries('word', word, wordHeight, ts.wordRelief),
    ...featureEntries('word-outline', wordOutline, wordHeight, ts.wordRelief),
    ...featureEntries('image', image, imageHeight, is.reliefMode),
    ...featureEntries('border', border, borderHeight, cfg.appearance.borderStyle === 'engraved' ? 'engraved' : cfg.appearance.borderStyle === 'engraved-filled' ? 'engraved-filled' : 'raised'),
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
    alpha.length && ts.alphabetRelief !== 'engraved' ? alphabetHeight : 0,
    word.length && ts.wordRelief !== 'engraved' ? wordHeight : 0,
    wordOutline.length && ts.wordRelief !== 'engraved' ? wordHeight : 0,
    image.length && is.reliefMode !== 'engraved' ? imageHeight : 0,
    border.length && cfg.appearance.borderStyle !== 'engraved' && cfg.appearance.borderStyle !== 'none' ? borderHeight : 0,
  );
  const t1 = now();

  return {
    parts,
    bounds: { min: validation.boundsMin, max: validation.boundsMax },
    expected: { width: W, height: H, thickness: T, maxZ: T + maxRaise },
    layers: { card, alphabet: alpha, word, wordOutline, image, border },
    placements: { alphabet: regionBounds(alpha), word: regionBounds(word), wordOutline: regionBounds(wordOutline), image: regionBounds(image), border: regionBounds(border) },
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

