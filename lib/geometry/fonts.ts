/**
 * Font loading. Fonts are real TrueType files shipped in /public/fonts (SIL Open Font License).
 * There is no silent "placeholder shape" fallback: if a font cannot be loaded we try the other
 * bundled fonts and tell the user which one was used, or fail with a clear error.
 */
import opentype from 'opentype.js';
import { DEFAULT_FONT_ID, FONT_OPTIONS } from '../../types/flashcard';

export type FontBinaryLoader = (url: string) => Promise<ArrayBuffer>;

const browserLoader: FontBinaryLoader = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} while loading ${url}`);
  return res.arrayBuffer();
};

let loader: FontBinaryLoader = browserLoader;
const cache = new Map<string, Promise<opentype.Font>>();

/** Replace the file loader (used by the Node test-suite, which reads from disk). */
export function setFontLoader(fn: FontBinaryLoader | null): void {
  loader = fn ?? browserLoader;
  cache.clear();
}

function loadOne(fontId: string): Promise<opentype.Font> {
  const hit = cache.get(fontId);
  if (hit) return hit;
  const option = FONT_OPTIONS.find((f) => f.id === fontId);
  if (!option) return Promise.reject(new Error(`Unknown font "${fontId}"`));
  const p = loader(option.url).then((buf) => {
    const font = opentype.parse(buf);
    if (!font || !font.glyphs || font.glyphs.length === 0) throw new Error(`Font file ${option.url} contains no glyphs`);
    return font;
  });
  cache.set(fontId, p);
  p.catch(() => cache.delete(fontId)); // allow a retry after a transient failure
  return p;
}

export interface LoadedFont {
  font: opentype.Font;
  fontId: string;
  /** Set when the requested font could not be loaded and another one was used. */
  note?: string;
}

export async function getFont(fontId: string): Promise<LoadedFont> {
  const order = [fontId, ...FONT_OPTIONS.map((f) => f.id).filter((id) => id !== fontId)];
  const errors: string[] = [];
  for (const id of order) {
    try {
      const font = await loadOne(id);
      if (id === fontId) return { font, fontId: id };
      const label = FONT_OPTIONS.find((f) => f.id === id)?.label ?? id;
      const wanted = FONT_OPTIONS.find((f) => f.id === fontId)?.label ?? fontId;
      return { font, fontId: id, note: `Font "${wanted}" could not be loaded (${errors[0]}). Using "${label}" instead.` };
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  throw new Error(`No font could be loaded (${errors.join('; ')}). Check that the files in /fonts are deployed.`);
}

export function defaultFontId(): string {
  return DEFAULT_FONT_ID;
}
