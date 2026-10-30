import fs from 'node:fs';
import path from 'node:path';
import { setFontLoader, getFont } from '../../lib/geometry/fonts';
import { convertImage, type RasterDecoder } from '../../lib/geometry/imageConvert';
import type { ModelDeps } from '../../lib/geometry/model';
import { createDefaultCard, newId, type CardImage, type FlashcardConfig } from '../../types/flashcard';

const root = path.resolve(__dirname, '..', '..');

export function useDiskFonts(): void {
  setFontLoader(async (url) => {
    const file = path.join(root, 'public', url);
    const b = fs.readFileSync(file);
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  });
}

export function nodeDeps(decoder?: RasterDecoder): ModelDeps {
  useDiskFonts();
  return {
    getFont,
    convertImage: (image, settings) =>
      convertImage(
        image,
        settings,
        decoder ??
          (async () => {
            throw new Error('No raster decoder in this test');
          }),
      ),
  };
}

export function readAsset(rel: string): string {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

export function svgImage(svg: string, fileName = 'test.svg'): CardImage {
  const b64 = Buffer.from(svg, 'utf8').toString('base64');
  return {
    id: newId(),
    dataUrl: `data:image/svg+xml;base64,${b64}`,
    fileName,
    mimeType: 'image/svg+xml',
    width: 0,
    height: 0,
    byteSize: svg.length,
  };
}

export function rasterImage(fileName = 'test.png'): CardImage {
  return {
    id: newId(),
    dataUrl: 'data:image/png;base64,AAAA',
    fileName,
    mimeType: 'image/png',
    width: 0,
    height: 0,
    byteSize: 3,
  };
}

/** Build an RGBA raster from a per-pixel gray function (0 = black, 255 = white). */
export function makeRaster(w: number, h: number, gray: (x: number, y: number) => number): { data: Uint8ClampedArray; width: number; height: number } {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const g = gray(x, y);
      const i = (y * w + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = g;
      data[i + 3] = 255;
    }
  }
  return { data, width: w, height: h };
}

export function testCard(patch: Partial<FlashcardConfig> = {}): FlashcardConfig {
  return { ...createDefaultCard('Aa', 'ant'), ...patch };
}
