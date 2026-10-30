/**
 * Turns an uploaded illustration (SVG, PNG or JPG) into a 2D region, with caching so that
 * moving a slider elsewhere does not re-decode or re-trace the picture.
 */
import type { CardImage, ImageSettings } from '../../types/flashcard';
import { svgToRegion } from './svgImport';
import { traceRaster } from './rasterTrace';
import { regionVertexCount, type Region } from './region';

export interface DecodedRaster {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}
export type RasterDecoder = (dataUrl: string) => Promise<DecodedRaster>;

export interface ImageConversion {
  /** Region in an arbitrary working scale; the layout step fits it to the card. */
  region: Region;
  warnings: string[];
  kind: 'svg' | 'raster';
  info: string;
  vertices: number;
}

const MAX_SIDE = 640;
const MIN_SIDE = 256;

/** Browser-only decoder. Never called during server rendering. */
export const browserRasterDecoder: RasterDecoder = async (dataUrl) => {
  const img = new Image();
  img.decoding = 'async';
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('The image could not be decoded. The file may be damaged or in an unsupported format.'));
    img.src = dataUrl;
  });
  const sw = img.naturalWidth;
  const sh = img.naturalHeight;
  if (!sw || !sh) throw new Error('The image has no readable size.');
  const longest = Math.max(sw, sh);
  const target = Math.max(MIN_SIDE, Math.min(MAX_SIDE, longest));
  const scale = target / longest;
  const w = Math.max(2, Math.round(sw * scale));
  const h = Math.max(2, Math.round(sh * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas is not available in this browser, so raster images cannot be converted.');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  return { data: ctx.getImageData(0, 0, w, h).data, width: w, height: h };
};

export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) throw new Error('Invalid image data.');
  const meta = dataUrl.slice(0, comma);
  const payload = dataUrl.slice(comma + 1);
  if (/;base64/i.test(meta)) {
    const bin = atob(payload);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new TextEncoder().encode(decodeURIComponent(payload));
}

export function dataUrlToText(dataUrl: string): string {
  return new TextDecoder('utf-8').decode(dataUrlToBytes(dataUrl));
}

const svgCache = new Map<string, ImageConversion>();
const rasterCache = new Map<string, Promise<DecodedRaster>>();
const traceCache = new Map<string, ImageConversion>();

function remember<T>(map: Map<string, T>, key: string, value: T, limit = 16): void {
  map.set(key, value);
  if (map.size > limit) map.delete(map.keys().next().value as string);
}

export async function convertImage(
  image: CardImage,
  s: ImageSettings,
  decoder: RasterDecoder = browserRasterDecoder,
): Promise<ImageConversion> {
  if (image.mimeType === 'image/svg+xml') {
    const hit = svgCache.get(image.id);
    if (hit) return hit;
    const result = svgToRegion(dataUrlToText(image.dataUrl));
    const conv: ImageConversion = {
      region: result.region,
      warnings: result.warnings,
      kind: 'svg',
      info: `SVG vector artwork, ${result.shapeCount} shape${result.shapeCount === 1 ? '' : 's'}`,
      vertices: regionVertexCount(result.region),
    };
    remember(svgCache, image.id, conv);
    return conv;
  }

  const key = [image.id, s.mode, s.autoThreshold, s.threshold, s.contrast, s.smoothing, s.simplify, s.minFeature, s.bgTolerance].join('|');
  const hit = traceCache.get(key);
  if (hit) return hit;

  let decodedP = rasterCache.get(image.id);
  if (!decodedP) {
    decodedP = decoder(image.dataUrl);
    remember(rasterCache, image.id, decodedP, 6);
    decodedP.catch(() => rasterCache.delete(image.id));
  }
  const decoded = await decodedP;
  const traced = traceRaster(decoded.data, decoded.width, decoded.height, s);
  const conv: ImageConversion = {
    region: traced.region,
    warnings: traced.warnings,
    kind: 'raster',
    info: `Raster ${decoded.width}x${decoded.height}px, threshold ${Math.round(traced.threshold)}, ${Math.round(traced.coverage * 100)}% raised`,
    vertices: regionVertexCount(traced.region),
  };
  remember(traceCache, key, conv, 24);
  return conv;
}
