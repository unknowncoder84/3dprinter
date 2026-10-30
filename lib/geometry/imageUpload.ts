/** Browser-side validation and loading of an uploaded illustration. */
import { newId, type CardImage } from '../../types/flashcard';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_STORED_SIDE = 2000;
const MAX_PIXELS_SIDE = 12000;

export class ImageUploadError extends Error {}

type Kind = 'png' | 'jpeg' | 'svg';

async function sniff(file: File): Promise<Kind | null> {
  const head = new Uint8Array(await file.slice(0, 512).arrayBuffer());
  if (head.length >= 8 && head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return 'png';
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'jpeg';
  const text = new TextDecoder('utf-8', { fatal: false }).decode(head).replace(/^\uFEFF/, '').trimStart().toLowerCase();
  if (text.startsWith('<svg') || text.startsWith('<?xml') || text.startsWith('<!--') || text.startsWith('<!doctype svg')) return 'svg';
  return null;
}

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new ImageUploadError('The file could not be read.'));
    r.readAsDataURL(blob);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new ImageUploadError('The image could not be decoded. The file may be damaged.'));
    img.src = src;
  });
}

function svgSize(text: string): { width: number; height: number } {
  const vb = /viewBox\s*=\s*["']\s*[-\d.eE]+[\s,]+[-\d.eE]+[\s,]+([\d.eE]+)[\s,]+([\d.eE]+)/i.exec(text);
  if (vb) return { width: parseFloat(vb[1]) || 0, height: parseFloat(vb[2]) || 0 };
  const w = /<svg[^>]*\swidth\s*=\s*["']([\d.]+)/i.exec(text);
  const h = /<svg[^>]*\sheight\s*=\s*["']([\d.]+)/i.exec(text);
  return { width: w ? parseFloat(w[1]) : 0, height: h ? parseFloat(h[1]) : 0 };
}

export async function loadIllustration(file: File): Promise<CardImage> {
  if (file.size === 0) throw new ImageUploadError(`"${file.name}" is empty.`);
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new ImageUploadError(`"${file.name}" is ${(file.size / 1048576).toFixed(1)} MB. The limit is ${MAX_UPLOAD_BYTES / 1048576} MB; use a smaller or simpler image.`);
  }
  const kind = await sniff(file);
  if (!kind) {
    throw new ImageUploadError(`"${file.name}" is not a supported image. Upload a PNG, JPG or SVG file (this one is ${file.type || 'an unknown type'}).`);
  }

  if (kind === 'svg') {
    const text = await file.text();
    if (!/<svg[\s>]/i.test(text)) throw new ImageUploadError(`"${file.name}" is not a valid SVG (no <svg> element).`);
    const bytes = new TextEncoder().encode(text);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const { width, height } = svgSize(text);
    return {
      id: newId(),
      dataUrl: `data:image/svg+xml;base64,${btoa(bin)}`,
      fileName: file.name,
      mimeType: 'image/svg+xml',
      width,
      height,
      byteSize: file.size,
    };
  }

  const mime = kind === 'png' ? 'image/png' : 'image/jpeg';
  let dataUrl = await readAsDataUrl(new Blob([await file.arrayBuffer()], { type: mime }));
  const img = await loadImage(dataUrl);
  let w = img.naturalWidth;
  let h = img.naturalHeight;
  if (!w || !h) throw new ImageUploadError(`"${file.name}" has no readable size.`);
  if (w < 8 || h < 8) throw new ImageUploadError(`"${file.name}" is only ${w}×${h} px, which is too small to convert.`);
  if (Math.max(w, h) > MAX_PIXELS_SIDE) throw new ImageUploadError(`"${file.name}" is ${w}×${h} px. Images larger than ${MAX_PIXELS_SIDE}px per side are not supported.`);

  let byteSize = file.size;
  const longest = Math.max(w, h);
  if (longest > MAX_STORED_SIDE) {
    // keep stored projects small: the conversion only needs ~640px anyway
    const s = MAX_STORED_SIDE / longest;
    const cw = Math.round(w * s);
    const ch = Math.round(h * s);
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new ImageUploadError('Canvas is not available, so this large image cannot be prepared.');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, cw, ch);
    dataUrl = canvas.toDataURL(mime, 0.92);
    w = cw;
    h = ch;
    byteSize = Math.round(dataUrl.length * 0.75);
  }
  return { id: newId(), dataUrl, fileName: file.name, mimeType: mime, width: w, height: h, byteSize };
}

export async function loadSampleIllustration(url: string, fileName: string): Promise<CardImage> {
  const res = await fetch(url);
  if (!res.ok) throw new ImageUploadError(`The sample could not be loaded (HTTP ${res.status}).`);
  const blob = await res.blob();
  return loadIllustration(new File([blob], fileName, { type: 'image/svg+xml' }));
}
