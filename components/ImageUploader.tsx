'use client';

import { useRef, useState, type DragEvent } from 'react';
import { AlertTriangle, ImagePlus, Replace, Trash2, Wand2 } from 'lucide-react';
import type { CardImage, FlashcardConfig } from '@/types/flashcard';
import type { FlashcardModel } from '@/lib/geometry/model';
import { ImageUploadError, loadIllustration, loadSampleIllustration } from '@/lib/geometry/imageUpload';
import { regionToFittedPath } from '@/lib/geometry/svgPath';

interface Props {
  card: FlashcardConfig;
  model: FlashcardModel | null;
  building: boolean;
  onSetImage: (image: CardImage | null) => void;
  onError: (message: string) => void;
}

export function ImageUploader({ card, model, building, onSetImage, onError }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const image = card.image;

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      onSetImage(await loadIllustration(file));
    } catch (e) {
      const msg = e instanceof ImageUploadError ? e.message : `The image could not be loaded: ${e instanceof Error ? e.message : String(e)}`;
      setError(msg);
      onError(msg);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 1) {
      setError('Please drop one image at a time. The first file was used.');
    }
    void handleFile(files[0]);
  };

  const useSample = async () => {
    setBusy(true);
    setError(null);
    try {
      onSetImage(await loadSampleIllustration('/samples/ant.svg', 'sample-ant.svg'));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      onError(msg);
    } finally {
      setBusy(false);
    }
  };

  const imageIssues = (model?.issues ?? []).filter((i) => i.code.startsWith('image'));
  const fitted = model && image ? regionToFittedPath(model.layers.image) : null;

  return (
    <div data-testid="image-uploader">
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/svg+xml,.png,.jpg,.jpeg,.svg"
        className="sr-only"
        data-testid="image-input"
        aria-label="Upload illustration (PNG, JPG or SVG)"
        onChange={(e) => void handleFile(e.target.files?.[0])}
      />

      {!image ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={onDrop}
          className={`rounded-xl border-2 border-dashed p-4 text-center transition-colors ${drag ? 'border-green-500 bg-green-50' : 'border-slate-300 bg-slate-50'}`}
          data-testid="dropzone"
        >
          <ImagePlus className="mx-auto h-8 w-8 text-slate-400" aria-hidden />
          <button type="button" onClick={() => inputRef.current?.click()} disabled={busy} className="mt-1 text-sm font-medium text-green-700 underline-offset-2 hover:underline" data-testid="choose-image">
            {busy ? 'Reading image…' : 'Choose an image'}
          </button>
          <span className="text-sm text-slate-600"> or drag it here</span>
          <p className="mt-1 text-xs text-slate-500">PNG, JPG or SVG · up to 10 MB · clean, high-contrast artwork works best</p>
          <p className="mt-2 text-xs text-amber-700" data-testid="needs-image">This card needs an illustration before final generation.</p>
          <button type="button" onClick={useSample} disabled={busy} className="mt-2 inline-flex items-center gap-1 text-xs text-slate-500 underline-offset-2 hover:text-slate-800 hover:underline" data-testid="use-sample">
            <Wand2 className="h-3 w-3" aria-hidden /> or try the sample ant drawing (SVG)
          </button>
        </div>
      ) : (
        <div
          className={`rounded-xl border p-2 ${drag ? 'border-green-500 bg-green-50' : 'border-slate-200 bg-white'}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={onDrop}
        >
          <div className="grid grid-cols-2 gap-2">
            <figure className="min-w-0">
              <div className="flex h-28 items-center justify-center overflow-hidden rounded-lg bg-[conic-gradient(#f1f5f9_25%,#e2e8f0_0_50%,#f1f5f9_0_75%,#e2e8f0_0)] bg-[length:14px_14px]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image.dataUrl} alt={`Uploaded illustration ${image.fileName}`} className="max-h-full max-w-full object-contain" data-testid="image-preview" />
              </div>
              <figcaption className="mt-1 truncate text-center text-[11px] text-slate-500" title={image.fileName}>
                Your image
              </figcaption>
            </figure>
            <figure className="min-w-0">
              <div className="flex h-28 items-center justify-center overflow-hidden rounded-lg bg-white ring-1 ring-slate-200" data-testid="raised-preview">
                {fitted ? (
                  <svg viewBox={fitted.viewBox} className="max-h-full max-w-full p-1" role="img" aria-label="Shapes that will be raised on the card">
                    <path d={fitted.d} fill="#17171a" fillRule="evenodd" />
                  </svg>
                ) : (
                  <span className="px-2 text-center text-[11px] text-slate-400">{building ? 'Converting…' : 'Nothing to raise'}</span>
                )}
              </div>
              <figcaption className="mt-1 text-center text-[11px] text-slate-500">Raised on the card</figcaption>
            </figure>
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-xs text-slate-600" title={image.fileName} data-testid="image-name">
              {image.fileName}
            </span>
            <span className="flex shrink-0 gap-1">
              <button type="button" onClick={() => inputRef.current?.click()} disabled={busy} className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50" data-testid="replace-image">
                <Replace className="h-3 w-3" aria-hidden /> Replace
              </button>
              <button type="button" onClick={() => { setError(null); onSetImage(null); }} className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50" data-testid="remove-image">
                <Trash2 className="h-3 w-3" aria-hidden /> Remove
              </button>
            </span>
          </div>
          {model?.imageInfo && <p className="mt-1 text-xs text-slate-500" data-testid="image-info">{model.imageInfo}</p>}
        </div>
      )}

      {error && (
        <p className="mt-2 flex gap-1.5 rounded-lg bg-red-50 px-2.5 py-1.5 text-xs text-red-800" role="alert" data-testid="image-error">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> {error}
        </p>
      )}
      {imageIssues.map((i, k) => (
        <p key={k} className={`mt-2 flex gap-1.5 rounded-lg px-2.5 py-1.5 text-xs ${i.severity === 'error' ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-800'}`} role={i.severity === 'error' ? 'alert' : 'status'} data-testid="image-issue">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> {i.message}
        </p>
      ))}
    </div>
  );
}
