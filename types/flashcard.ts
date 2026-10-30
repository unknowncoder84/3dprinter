/**
 * Flashcard data model (schema version 2).
 *
 * This file is the single source of truth for a card's configuration. The editor UI,
 * the 3D preview, the STL exporter, persistence and the project file format all use
 * these types. All lengths are millimetres.
 *
 * Card coordinate convention used everywhere in the geometry code:
 *   - origin at the centre of the card's front face footprint
 *   - +X to the right, +Y up (towards the top of the card), +Z out of the front face
 *   - the card's back face is at Z = 0, the front surface at Z = thickness
 * The exported STL uses exactly these coordinates, so the card lies flat on a print bed
 * (back face down) with the raised details facing up.
 */

export const PROJECT_FORMAT = 'flashcard-studio-project';
export const PROJECT_VERSION = 2;

// ---------------------------------------------------------------------------
// Fonts (files live in /public/fonts, all licensed under the SIL Open Font License)
// ---------------------------------------------------------------------------

export interface FontOption {
  id: string;
  label: string;
  url: string;
}

export const FONT_OPTIONS: FontOption[] = [
  { id: 'poppins-bold', label: 'Poppins Bold', url: '/fonts/Poppins-Bold.ttf' },
  { id: 'lilita-one', label: 'Lilita One', url: '/fonts/LilitaOne-Regular.ttf' },
  { id: 'comic-neue-bold', label: 'Comic Neue Bold', url: '/fonts/ComicNeue-Bold.ttf' },
];
export const DEFAULT_FONT_ID = 'poppins-bold';

// ---------------------------------------------------------------------------
// Card configuration
// ---------------------------------------------------------------------------

export type HolePreset =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'middle-left'
  | 'middle-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right'
  | 'custom';

export const HOLE_PRESETS: { id: HolePreset; label: string }[] = [
  { id: 'top-left', label: 'Top Left' },
  { id: 'top-center', label: 'Top Centre' },
  { id: 'top-right', label: 'Top Right' },
  { id: 'middle-left', label: 'Middle Left' },
  { id: 'middle-right', label: 'Middle Right' },
  { id: 'bottom-left', label: 'Bottom Left' },
  { id: 'bottom-center', label: 'Bottom Centre' },
  { id: 'bottom-right', label: 'Bottom Right' },
  { id: 'custom', label: 'Custom Position' },
];

export type TextAlign = 'left' | 'center' | 'right';
export type ImageMode = 'dark' | 'light' | 'silhouette';
export type CurveQuality = 'low' | 'medium' | 'high';
export type BorderStyle = 'none' | 'raised' | 'engraved' | 'engraved-filled';
export type ReliefMode = 'raised' | 'engraved' | 'engraved-filled';

export interface AppearanceSettings {
  /** Preview colours. Standard STL does not preserve these colours. */
  cardColor: string;
  alphabetColor: string;
  wordColor: string;
  imageColor: string;
  borderColor: string;
  wordOutlineColor: string;
  borderStyle: BorderStyle;
  /** Width of the printed outline, in millimetres. */
  borderWidth: number;
  /** Height/depth of the printed outline, in millimetres. */
  borderHeight: number;
  /** 0 disables the printable outline around the word. */
  wordOutlineWidth: number;
}

export interface CardImage {
  /** Changes every time the image is replaced; used as a cache key. */
  id: string;
  dataUrl: string;
  fileName: string;
  mimeType: 'image/png' | 'image/jpeg' | 'image/svg+xml';
  /** Natural size in pixels (rasters) or viewBox/width/height (SVG). 0 if unknown. */
  width: number;
  height: number;
  byteSize: number;
}

export interface CardDimensions {
  width: number;
  height: number;
  thickness: number;
  cornerRadius: number;
}

export interface TextSettings {
  fontId: string;
  /** Cap height (height of capital letters) in mm. */
  alphabetSize: number;
  /** Extrusion height above the card surface in mm. */
  alphabetHeight: number;
  alphabetRelief: ReliefMode;
  alphabetAlign: TextAlign;
  alphabetOffsetX: number;
  alphabetOffsetY: number;
  wordSize: number;
  wordHeight: number;
  wordRelief: ReliefMode;
  wordAlign: TextAlign;
  wordOffsetX: number;
  wordOffsetY: number;
  /** Extra tracking as a fraction of the font size. */
  letterSpacing: number;
  /** Shrink text that is wider than the card instead of letting it be trimmed. */
  autoFit: boolean;
}

export interface ImageSettings {
  /** The illustration is scaled (keeping its proportions) to fit inside this box. */
  maxWidth: number;
  maxHeight: number;
  reliefHeight: number;
  offsetX: number;
  offsetY: number;
  /** Raster conversion settings (ignored for SVG artwork). */
  reliefMode: ReliefMode;
  mode: ImageMode;
  autoThreshold: boolean;
  threshold: number;
  contrast: number;
  smoothing: number;
  simplify: number;
  minFeature: number;
  bgTolerance: number;
}

export interface HoleSettings {
  enabled: boolean;
  diameter: number;
  /** Hole centre, millimetres from the card's LEFT edge. */
  x: number;
  /** Hole centre, millimetres from the card's TOP edge. */
  y: number;
  preset: HolePreset;
}

export interface GeometrySettings {
  quality: CurveQuality;
  /** Minimum gap between raised details and the card edge. */
  edgeClearance: number;
  /** Minimum gap between raised details and the hanging hole. */
  holeClearance: number;
}

export interface FlashcardConfig {
  id: string;
  alphabet: string;
  word: string;
  image: CardImage | null;
  dimensions: CardDimensions;
  textSettings: TextSettings;
  imageSettings: ImageSettings;
  holeSettings: HoleSettings;
  geometrySettings: GeometrySettings;
  appearance: AppearanceSettings;
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object | null ? DeepPartial<NonNullable<T[K]>> | (null extends T[K] ? null : never) : T[K];
};

// ---------------------------------------------------------------------------
// Validation limits (shared by the UI inputs and the project loader)
// ---------------------------------------------------------------------------

export const LIMITS = {
  width: { min: 30, max: 300 },
  height: { min: 30, max: 300 },
  thickness: { min: 0.8, max: 20 },
  cornerRadius: { min: 0, max: 60 },
  alphabetSize: { min: 4, max: 150 },
  wordSize: { min: 3, max: 100 },
  extrusion: { min: 0.2, max: 10 },
  offset: { min: -150, max: 150 },
  letterSpacing: { min: -0.1, max: 0.6 },
  imageBox: { min: 5, max: 280 },
  holeDiameter: { min: 2, max: 40 },
  holePos: { min: 0, max: 300 },
  threshold: { min: 0, max: 255 },
  contrast: { min: -50, max: 150 },
  smoothing: { min: 0, max: 3 },
  simplify: { min: 0, max: 4 },
  minFeature: { min: 0, max: 400 },
  bgTolerance: { min: 2, max: 120 },
  clearance: { min: 0, max: 10 },
  borderWidth: { min: 0.5, max: 15 },
  borderHeight: { min: 0.2, max: 10 },
  wordOutlineWidth: { min: 0, max: 5 },
} as const;

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_ALPHABET_DATA: Array<{ letter: string; word: string }> = [
  { letter: 'A', word: 'ant' },
  { letter: 'B', word: 'ball' },
  { letter: 'C', word: 'cat' },
  { letter: 'D', word: 'dog' },
  { letter: 'E', word: 'elephant' },
  { letter: 'F', word: 'fish' },
  { letter: 'G', word: 'goat' },
  { letter: 'H', word: 'house' },
  { letter: 'I', word: 'ice cream' },
  { letter: 'J', word: 'jug' },
  { letter: 'K', word: 'kite' },
  { letter: 'L', word: 'lion' },
  { letter: 'M', word: 'mango' },
  { letter: 'N', word: 'nest' },
  { letter: 'O', word: 'orange' },
  { letter: 'P', word: 'parrot' },
  { letter: 'Q', word: 'queen' },
  { letter: 'R', word: 'rabbit' },
  { letter: 'S', word: 'sun' },
  { letter: 'T', word: 'tiger' },
  { letter: 'U', word: 'umbrella' },
  { letter: 'V', word: 'van' },
  { letter: 'W', word: 'watch' },
  { letter: 'X', word: 'xylophone' },
  { letter: 'Y', word: 'yak' },
  { letter: 'Z', word: 'zebra' },
];

export function newId(): string {
  const c = typeof globalThis !== 'undefined' ? (globalThis as { crypto?: Crypto }).crypto : undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

/** Distance of a corner/edge preset's hole centre from the card edges. */
export function presetInset(diameter: number): number {
  return diameter / 2 + 4.5;
}

/** Unclamped hole centre (mm from left/top) for a preset. */
export function presetPosition(
  preset: Exclude<HolePreset, 'custom'>,
  dims: CardDimensions,
  diameter: number,
): { x: number; y: number } {
  const inset = presetInset(diameter);
  const { width: w, height: h } = dims;
  const xs = { left: inset, center: w / 2, right: w - inset };
  const ys = { top: inset, middle: h / 2, bottom: h - inset };
  switch (preset) {
    case 'top-left':
      return { x: xs.left, y: ys.top };
    case 'top-center':
      return { x: xs.center, y: ys.top };
    case 'top-right':
      return { x: xs.right, y: ys.top };
    case 'middle-left':
      return { x: xs.left, y: ys.middle };
    case 'middle-right':
      return { x: xs.right, y: ys.middle };
    case 'bottom-left':
      return { x: xs.left, y: ys.bottom };
    case 'bottom-center':
      return { x: xs.center, y: ys.bottom };
    case 'bottom-right':
      return { x: xs.right, y: ys.bottom };
  }
}

export function createDefaultCard(alphabet = 'Aa', word = 'ant'): FlashcardConfig {
  const dimensions: CardDimensions = { width: 80, height: 100, thickness: 3, cornerRadius: 8 };
  const diameter = 5;
  const pos = presetPosition('top-left', dimensions, diameter);
  return {
    id: newId(),
    alphabet,
    word,
    image: null,
    dimensions,
    textSettings: {
      fontId: DEFAULT_FONT_ID,
      alphabetSize: 26,
      alphabetHeight: 1.6,
      alphabetRelief: 'raised',
      alphabetAlign: 'center',
      alphabetOffsetX: 0,
      alphabetOffsetY: 0,
      wordSize: 10,
      wordHeight: 1.2,
      wordRelief: 'raised',
      wordAlign: 'center',
      wordOffsetX: 0,
      wordOffsetY: 0,
      letterSpacing: 0,
      autoFit: true,
    },
    imageSettings: {
      maxWidth: 56,
      maxHeight: 32,
      reliefHeight: 1.2,
      reliefMode: 'raised',
      offsetX: 0,
      offsetY: 0,
      mode: 'dark',
      autoThreshold: true,
      threshold: 128,
      contrast: 0,
      smoothing: 1,
      simplify: 0.8,
      minFeature: 12,
      bgTolerance: 28,
    },
    holeSettings: { enabled: true, diameter, x: pos.x, y: pos.y, preset: 'top-left' },
    geometrySettings: { quality: 'medium', edgeClearance: 1.5, holeClearance: 1.5 },
    appearance: {
      cardColor: '#f7f7f2',
      alphabetColor: '#17171a',
      wordColor: '#17171a',
      imageColor: '#17171a',
      borderColor: '#16a34a',
      wordOutlineColor: '#16a34a',
      borderStyle: 'none',
      borderWidth: 1.5,
      borderHeight: 0.8,
      wordOutlineWidth: 0,
    },
  };
}

/** Card for a given letter using the default pair (e.g. 'A' -> "Aa" / "ant"). */
export function createLetterCard(letter: string, template?: FlashcardConfig): FlashcardConfig {
  const upper = letter.toUpperCase();
  const entry = DEFAULT_ALPHABET_DATA.find((e) => e.letter === upper);
  const base = createDefaultCard(upper + upper.toLowerCase(), entry ? entry.word : '');
  if (!template) return base;
  return {
    ...base,
    dimensions: { ...template.dimensions },
    textSettings: { ...template.textSettings },
    imageSettings: { ...template.imageSettings },
    holeSettings: { ...template.holeSettings },
    geometrySettings: { ...template.geometrySettings },
    appearance: { ...template.appearance },
  };
}

// ---------------------------------------------------------------------------
// Sanitising / migration (used when loading saved projects or importing files)
// ---------------------------------------------------------------------------

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

function num(v: unknown, def: number, min: number, max: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
}
function str(v: unknown, def: string, maxLen = 200): string {
  return typeof v === 'string' ? v.slice(0, maxLen) : def;
}
function bool(v: unknown, def: boolean): boolean {
  return typeof v === 'boolean' ? v : def;
}
function oneOf<T extends string>(v: unknown, allowed: readonly T[], def: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : def;
}
function hexColor(v: unknown, def: string): string {
  return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : def;
}

const IMAGE_DATA_URL = /^data:image\/(png|jpeg|jpg|svg\+xml)[;,]/i;

export function sanitizeImage(raw: unknown): CardImage | null {
  if (!isObj(raw)) return null;
  const dataUrl = raw.dataUrl;
  if (typeof dataUrl !== 'string' || !IMAGE_DATA_URL.test(dataUrl)) return null;
  const m = IMAGE_DATA_URL.exec(dataUrl)!;
  const kind = m[1].toLowerCase();
  const mimeType = kind === 'svg+xml' ? 'image/svg+xml' : kind === 'png' ? 'image/png' : 'image/jpeg';
  return {
    id: str(raw.id, '', 80) || newId(),
    dataUrl,
    fileName: str(raw.fileName, 'image', 200),
    mimeType,
    width: num(raw.width, 0, 0, 100000),
    height: num(raw.height, 0, 0, 100000),
    byteSize: num(raw.byteSize, Math.round(dataUrl.length * 0.75), 0, 1e9),
  };
}

/**
 * Turn arbitrary (possibly old or damaged) card data into a complete, valid card.
 * Handles schema v1 cards written by the first prototype of this app.
 */
export function sanitizeCard(raw: unknown): FlashcardConfig {
  const d = createDefaultCard();
  if (!isObj(raw)) return d;

  const dimsRaw = isObj(raw.dimensions) ? raw.dimensions : {};
  const width = num(dimsRaw.width, d.dimensions.width, LIMITS.width.min, LIMITS.width.max);
  const height = num(dimsRaw.height, d.dimensions.height, LIMITS.height.min, LIMITS.height.max);
  const dimensions: CardDimensions = {
    width,
    height,
    thickness: num(dimsRaw.thickness, d.dimensions.thickness, LIMITS.thickness.min, LIMITS.thickness.max),
    cornerRadius: num(
      dimsRaw.cornerRadius,
      d.dimensions.cornerRadius,
      LIMITS.cornerRadius.min,
      Math.min(LIMITS.cornerRadius.max, Math.min(width, height) / 2),
    ),
  };

  const t = isObj(raw.textSettings) ? raw.textSettings : {};
  const ts = d.textSettings;
  const textSettings: TextSettings = {
    fontId: FONT_OPTIONS.some((f) => f.id === t.fontId) ? (t.fontId as string) : ts.fontId,
    alphabetSize: num(t.alphabetSize, ts.alphabetSize, LIMITS.alphabetSize.min, LIMITS.alphabetSize.max),
    alphabetHeight: num(t.alphabetHeight, ts.alphabetHeight, LIMITS.extrusion.min, LIMITS.extrusion.max),
    alphabetRelief: oneOf(t.alphabetRelief, ['raised', 'engraved', 'engraved-filled'] as const, ts.alphabetRelief),
    alphabetAlign: oneOf(t.alphabetAlign, ['left', 'center', 'right'] as const, ts.alphabetAlign),
    alphabetOffsetX: num(t.alphabetOffsetX, 0, LIMITS.offset.min, LIMITS.offset.max),
    alphabetOffsetY: num(t.alphabetOffsetY, 0, LIMITS.offset.min, LIMITS.offset.max),
    wordSize: num(t.wordSize, ts.wordSize, LIMITS.wordSize.min, LIMITS.wordSize.max),
    wordHeight: num(t.wordHeight, ts.wordHeight, LIMITS.extrusion.min, LIMITS.extrusion.max),
    wordRelief: oneOf(t.wordRelief, ['raised', 'engraved', 'engraved-filled'] as const, ts.wordRelief),
    wordAlign: oneOf(t.wordAlign, ['left', 'center', 'right'] as const, ts.wordAlign),
    wordOffsetX: num(t.wordOffsetX, 0, LIMITS.offset.min, LIMITS.offset.max),
    wordOffsetY: num(t.wordOffsetY, 0, LIMITS.offset.min, LIMITS.offset.max),
    letterSpacing: num(t.letterSpacing, 0, LIMITS.letterSpacing.min, LIMITS.letterSpacing.max),
    autoFit: bool(t.autoFit, true),
  };
  // Schema v1 stored a loose "size" that is not comparable with the cap-height used now.
  if (raw.textSettings && isObj(raw.textSettings) && 'alphabetY' in raw.textSettings) {
    textSettings.alphabetSize = ts.alphabetSize;
    textSettings.wordSize = ts.wordSize;
  }

  const i = isObj(raw.imageSettings) ? raw.imageSettings : {};
  const is = d.imageSettings;
  const imageSettings: ImageSettings = {
    maxWidth: num(i.maxWidth ?? i.width, is.maxWidth, LIMITS.imageBox.min, LIMITS.imageBox.max),
    maxHeight: num(i.maxHeight ?? i.height, is.maxHeight, LIMITS.imageBox.min, LIMITS.imageBox.max),
    reliefHeight: num(i.reliefHeight, is.reliefHeight, LIMITS.extrusion.min, LIMITS.extrusion.max),
    reliefMode: oneOf(i.reliefMode, ['raised', 'engraved', 'engraved-filled'] as const, is.reliefMode),
    offsetX: num(i.offsetX, 0, LIMITS.offset.min, LIMITS.offset.max),
    offsetY: num(i.offsetY, 0, LIMITS.offset.min, LIMITS.offset.max),
    mode: oneOf(i.mode, ['dark', 'light', 'silhouette'] as const, is.mode),
    autoThreshold: bool(i.autoThreshold, is.autoThreshold),
    threshold: num(i.threshold, is.threshold, LIMITS.threshold.min, LIMITS.threshold.max),
    contrast: num(i.contrast, is.contrast, LIMITS.contrast.min, LIMITS.contrast.max),
    smoothing: num(i.smoothing, is.smoothing, LIMITS.smoothing.min, LIMITS.smoothing.max),
    simplify: num(i.simplify, is.simplify, LIMITS.simplify.min, LIMITS.simplify.max),
    minFeature: num(i.minFeature, is.minFeature, LIMITS.minFeature.min, LIMITS.minFeature.max),
    bgTolerance: num(i.bgTolerance, is.bgTolerance, LIMITS.bgTolerance.min, LIMITS.bgTolerance.max),
  };

  const h = isObj(raw.holeSettings) ? raw.holeSettings : {};
  const diameter = num(h.diameter, d.holeSettings.diameter, LIMITS.holeDiameter.min, LIMITS.holeDiameter.max);
  const presetIds = HOLE_PRESETS.map((p) => p.id);
  let preset = oneOf(h.preset ?? h.position, presetIds, 'top-left');
  let hx: number;
  let hy: number;
  if (typeof h.x === 'number' && typeof h.y === 'number') {
    hx = h.x;
    hy = h.y;
  } else if (preset === 'custom') {
    hx = num(h.customX, 10, 0, dimensions.width);
    hy = num(h.customY, 10, 0, dimensions.height);
  } else {
    const p = presetPosition(preset, dimensions, diameter);
    hx = p.x;
    hy = p.y;
  }
  if (preset !== 'custom' && !(typeof h.x === 'number' && typeof h.y === 'number')) {
    const p = presetPosition(preset, dimensions, diameter);
    hx = p.x;
    hy = p.y;
  }
  if (!['custom', ...presetIds].includes(preset)) preset = 'custom';
  const holeSettings: HoleSettings = {
    enabled: bool(h.enabled, true),
    diameter,
    x: num(hx, 7, LIMITS.holePos.min, dimensions.width),
    y: num(hy, 7, LIMITS.holePos.min, dimensions.height),
    preset,
  };

  const g = isObj(raw.geometrySettings) ? raw.geometrySettings : {};
  const geometrySettings: GeometrySettings = {
    quality: oneOf(g.quality, ['low', 'medium', 'high'] as const, 'medium'),
    edgeClearance: num(g.edgeClearance, 1.5, LIMITS.clearance.min, LIMITS.clearance.max),
    holeClearance: num(g.holeClearance, 1.5, LIMITS.clearance.min, LIMITS.clearance.max),
  };

  const a = isObj(raw.appearance) ? raw.appearance : {};
  const appearance: AppearanceSettings = {
    cardColor: hexColor(a.cardColor, d.appearance.cardColor),
    alphabetColor: hexColor(a.alphabetColor, hexColor(a.detailColor, d.appearance.alphabetColor)),
    wordColor: hexColor(a.wordColor, hexColor(a.detailColor, d.appearance.wordColor)),
    imageColor: hexColor(a.imageColor, hexColor(a.detailColor, d.appearance.imageColor)),
    borderColor: hexColor(a.borderColor, d.appearance.borderColor),
    wordOutlineColor: hexColor(a.wordOutlineColor, d.appearance.wordOutlineColor),
    borderStyle: oneOf(a.borderStyle, ['none', 'raised', 'engraved', 'engraved-filled'] as const, d.appearance.borderStyle),
    borderWidth: num(a.borderWidth, d.appearance.borderWidth, LIMITS.borderWidth.min, Math.min(LIMITS.borderWidth.max, Math.min(width, height) / 4)),
    borderHeight: num(a.borderHeight, d.appearance.borderHeight, LIMITS.borderHeight.min, LIMITS.borderHeight.max),
    wordOutlineWidth: num(a.wordOutlineWidth, d.appearance.wordOutlineWidth, LIMITS.wordOutlineWidth.min, LIMITS.wordOutlineWidth.max),
  };

  return {
    id: str(raw.id, '', 80) || newId(),
    alphabet: str(raw.alphabet, d.alphabet, 12),
    word: str(raw.word, d.word, 40),
    image: sanitizeImage(raw.image),
    dimensions,
    textSettings,
    imageSettings,
    holeSettings,
    geometrySettings,
    appearance,
  };
}

/** English label used for generated number cards. The number itself remains editable in Alphabet. */
export function numberToWord(value: number): string {
  const ones = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
  const teens = ['ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  if (value < 10) return ones[value];
  if (value < 20) return teens[value - 10];
  if (value < 100) return tens[Math.floor(value / 10)] + (value % 10 ? `-${ones[value % 10]}` : '');
  return value === 100 ? 'one hundred' : String(value);
}

/** Number card template used by the range generator. */
export function createNumberCard(value: number, template?: FlashcardConfig): FlashcardConfig {
  const base = createDefaultCard(String(value), numberToWord(value));
  if (!template) return base;
  return {
    ...base,
    dimensions: { ...template.dimensions },
    textSettings: { ...template.textSettings },
    imageSettings: { ...template.imageSettings },
    holeSettings: { ...template.holeSettings },
    geometrySettings: { ...template.geometrySettings },
    appearance: { ...template.appearance },
  };
}
