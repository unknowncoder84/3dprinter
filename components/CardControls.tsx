'use client';

import { FONT_OPTIONS, LIMITS, type CardImage, type CurveQuality, type DeepPartial, type FlashcardConfig, type ImageMode, type TextAlign } from '@/types/flashcard';
import type { FlashcardModel } from '@/lib/geometry/model';
import { Section, NumberField, SelectField, SliderField, Toggle } from '@/components/ui/fields';
import { ImageUploader } from '@/components/ImageUploader';
import { HolePlacement } from '@/components/HolePlacement';

interface Props {
  card: FlashcardConfig;
  model: FlashcardModel | null;
  building: boolean;
  onPatch: (patch: DeepPartial<FlashcardConfig>) => void;
  onSetImage: (image: CardImage | null) => void;
  onError: (message: string) => void;
  placeOnViewer: boolean;
  onTogglePlaceOnViewer: (v: boolean) => void;
}

const ALIGN: { id: TextAlign; label: string }[] = [
  { id: 'left', label: 'Left' },
  { id: 'center', label: 'Centre' },
  { id: 'right', label: 'Right' },
];
const MODES: { id: ImageMode; label: string }[] = [
  { id: 'dark', label: 'Dark ink on light paper (raise dark areas)' },
  { id: 'light', label: 'Light ink on dark paper (raise light areas)' },
  { id: 'silhouette', label: 'Silhouette (raise everything but the background)' },
];
const QUALITY: { id: CurveQuality; label: string }[] = [
  { id: 'low', label: 'Low (smaller files)' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High (smoothest curves)' },
];

export default function CardControls({ card, model, building, onPatch, onSetImage, onError, placeOnViewer, onTogglePlaceOnViewer }: Props) {
  const t = card.textSettings;
  const im = card.imageSettings;
  const d = card.dimensions;
  const g = card.geometrySettings;
  const isRaster = card.image !== null && card.image.mimeType !== 'image/svg+xml';
  const textIssues = (model?.issues ?? []).filter((i) => i.code === 'text-fit' || i.code === 'missing-glyph' || i.code === 'font-fallback' || i.code === 'empty');

  return (
    <div className="text-slate-800" data-testid="card-controls">
      <Section title="Card content" testId="section-content">
        <div>
          <label htmlFor="alphabet" className="mb-1 block text-xs font-medium text-slate-600">
            Alphabet
          </label>
          <input
            id="alphabet"
            data-testid="alphabet-input"
            value={card.alphabet}
            maxLength={12}
            placeholder="Aa"
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => onPatch({ alphabet: e.target.value })}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-lg font-semibold outline-none focus:ring-2 focus:ring-green-500"
          />
        </div>

        <div>
          <span className="mb-1 block text-xs font-medium text-slate-600">Illustration</span>
          <ImageUploader card={card} model={model} building={building} onSetImage={onSetImage} onError={onError} />
        </div>

        <div>
          <label htmlFor="word" className="mb-1 block text-xs font-medium text-slate-600">
            Word
          </label>
          <input
            id="word"
            data-testid="word-input"
            value={card.word}
            maxLength={40}
            placeholder="ant"
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => onPatch({ word: e.target.value })}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base outline-none focus:ring-2 focus:ring-green-500"
          />
        </div>
        {textIssues.map((i, k) => (
          <p key={k} className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800" role="status" data-testid="text-issue">
            {i.message}
          </p>
        ))}
      </Section>

      <Section title="Card dimensions" testId="section-dimensions">
        <div className="grid grid-cols-2 gap-3">
          <NumberField label="Width" value={d.width} min={LIMITS.width.min} max={LIMITS.width.max} onChange={(v) => onPatch({ dimensions: { width: v } })} testId="dim-width" />
          <NumberField label="Height" value={d.height} min={LIMITS.height.min} max={LIMITS.height.max} onChange={(v) => onPatch({ dimensions: { height: v } })} testId="dim-height" />
          <NumberField label="Base thickness" value={d.thickness} min={LIMITS.thickness.min} max={LIMITS.thickness.max} step={0.2} onChange={(v) => onPatch({ dimensions: { thickness: v } })} testId="dim-thickness" />
          <NumberField label="Corner radius" value={d.cornerRadius} min={LIMITS.cornerRadius.min} max={Math.min(LIMITS.cornerRadius.max, Math.floor(Math.min(d.width, d.height) / 2))} onChange={(v) => onPatch({ dimensions: { cornerRadius: v } })} testId="dim-radius" />
        </div>
      </Section>

      <Section title="Text settings" testId="section-text" defaultOpen={false}>
        <SelectField label="Font" value={t.fontId} options={FONT_OPTIONS.map((f) => ({ id: f.id, label: f.label }))} onChange={(v) => onPatch({ textSettings: { fontId: v } })} testId="font-select" />
        <p className="text-xs font-semibold text-slate-500">Alphabet</p>
        <div className="grid grid-cols-2 gap-3">
          <NumberField label="Letter height" value={t.alphabetSize} min={LIMITS.alphabetSize.min} max={LIMITS.alphabetSize.max} onChange={(v) => onPatch({ textSettings: { alphabetSize: v } })} testId="alphabet-size" hint="Height of capitals" />
          <NumberField label="Raised by" value={t.alphabetHeight} min={LIMITS.extrusion.min} max={LIMITS.extrusion.max} step={0.1} onChange={(v) => onPatch({ textSettings: { alphabetHeight: v } })} testId="alphabet-height" />
          <NumberField label="Move right" value={t.alphabetOffsetX} min={LIMITS.offset.min} max={LIMITS.offset.max} step={0.5} onChange={(v) => onPatch({ textSettings: { alphabetOffsetX: v } })} testId="alphabet-offset-x" />
          <NumberField label="Move up" value={t.alphabetOffsetY} min={LIMITS.offset.min} max={LIMITS.offset.max} step={0.5} onChange={(v) => onPatch({ textSettings: { alphabetOffsetY: v } })} testId="alphabet-offset-y" />
        </div>
        <SelectField label="Alphabet alignment" value={t.alphabetAlign} options={ALIGN} onChange={(v) => onPatch({ textSettings: { alphabetAlign: v } })} testId="alphabet-align" />
        <p className="pt-1 text-xs font-semibold text-slate-500">Word</p>
        <div className="grid grid-cols-2 gap-3">
          <NumberField label="Letter height" value={t.wordSize} min={LIMITS.wordSize.min} max={LIMITS.wordSize.max} onChange={(v) => onPatch({ textSettings: { wordSize: v } })} testId="word-size" hint="Height of capitals" />
          <NumberField label="Raised by" value={t.wordHeight} min={LIMITS.extrusion.min} max={LIMITS.extrusion.max} step={0.1} onChange={(v) => onPatch({ textSettings: { wordHeight: v } })} testId="word-height" />
          <NumberField label="Move right" value={t.wordOffsetX} min={LIMITS.offset.min} max={LIMITS.offset.max} step={0.5} onChange={(v) => onPatch({ textSettings: { wordOffsetX: v } })} testId="word-offset-x" />
          <NumberField label="Move up" value={t.wordOffsetY} min={LIMITS.offset.min} max={LIMITS.offset.max} step={0.5} onChange={(v) => onPatch({ textSettings: { wordOffsetY: v } })} testId="word-offset-y" />
        </div>
        <SelectField label="Word alignment" value={t.wordAlign} options={ALIGN} onChange={(v) => onPatch({ textSettings: { wordAlign: v } })} testId="word-align" />
        <SliderField label="Letter spacing" value={t.letterSpacing} min={LIMITS.letterSpacing.min} max={LIMITS.letterSpacing.max} step={0.01} display={(v) => `${v.toFixed(2)} em`} onChange={(v) => onPatch({ textSettings: { letterSpacing: v } })} testId="letter-spacing" />
        <Toggle label="Shrink text to fit the card" description="Otherwise over-wide text is trimmed at the card edge" checked={t.autoFit} onChange={(v) => onPatch({ textSettings: { autoFit: v } })} testId="text-autofit" />
      </Section>

      <Section title="Image settings" testId="section-image" defaultOpen={false}>
        <p className="text-xs text-slate-500">The illustration is scaled to fit this box, keeping its proportions, and placed between the letter and the word.</p>
        <div className="grid grid-cols-2 gap-3">
          <NumberField label="Max width" value={im.maxWidth} min={LIMITS.imageBox.min} max={LIMITS.imageBox.max} onChange={(v) => onPatch({ imageSettings: { maxWidth: v } })} testId="image-max-width" />
          <NumberField label="Max height" value={im.maxHeight} min={LIMITS.imageBox.min} max={LIMITS.imageBox.max} onChange={(v) => onPatch({ imageSettings: { maxHeight: v } })} testId="image-max-height" />
          <NumberField label="Raised by" value={im.reliefHeight} min={LIMITS.extrusion.min} max={LIMITS.extrusion.max} step={0.1} onChange={(v) => onPatch({ imageSettings: { reliefHeight: v } })} testId="image-relief" />
          <span />
          <NumberField label="Move right" value={im.offsetX} min={LIMITS.offset.min} max={LIMITS.offset.max} step={0.5} onChange={(v) => onPatch({ imageSettings: { offsetX: v } })} testId="image-offset-x" />
          <NumberField label="Move up" value={im.offsetY} min={LIMITS.offset.min} max={LIMITS.offset.max} step={0.5} onChange={(v) => onPatch({ imageSettings: { offsetY: v } })} testId="image-offset-y" />
        </div>

        {card.image && !isRaster && <p className="rounded-lg bg-slate-50 px-2.5 py-2 text-xs text-slate-600">SVG artwork is converted directly from its vector paths, so no threshold settings are needed.</p>}
        {!card.image && <p className="rounded-lg bg-slate-50 px-2.5 py-2 text-xs text-slate-600">Upload a PNG or JPG to see the conversion controls (mode, threshold, contrast, smoothing).</p>}
        {isRaster && (
          <div className="space-y-3 rounded-lg border border-slate-200 p-3" data-testid="raster-controls">
            <p className="text-xs font-semibold text-slate-600">PNG / JPG conversion</p>
            <SelectField label="What should be raised?" value={im.mode} options={MODES} onChange={(v) => onPatch({ imageSettings: { mode: v } })} testId="image-mode" />
            {im.mode !== 'silhouette' && (
              <>
                <Toggle label="Automatic threshold" checked={im.autoThreshold} onChange={(v) => onPatch({ imageSettings: { autoThreshold: v } })} testId="image-auto-threshold" />
                <SliderField label="Threshold" value={im.threshold} min={LIMITS.threshold.min} max={LIMITS.threshold.max} step={1} disabled={im.autoThreshold} onChange={(v) => onPatch({ imageSettings: { threshold: v } })} testId="image-threshold" />
                <SliderField label="Contrast" value={im.contrast} min={LIMITS.contrast.min} max={LIMITS.contrast.max} step={5} display={(v) => `${v > 0 ? '+' : ''}${v}%`} onChange={(v) => onPatch({ imageSettings: { contrast: v } })} testId="image-contrast" />
              </>
            )}
            {im.mode === 'silhouette' && <SliderField label="Background colour tolerance" value={im.bgTolerance} min={LIMITS.bgTolerance.min} max={LIMITS.bgTolerance.max} step={1} onChange={(v) => onPatch({ imageSettings: { bgTolerance: v } })} testId="image-bg-tolerance" />}
            <SliderField label="Smoothing" value={im.smoothing} min={LIMITS.smoothing.min} max={LIMITS.smoothing.max} step={1} onChange={(v) => onPatch({ imageSettings: { smoothing: v } })} testId="image-smoothing" />
            <SliderField label="Simplify outline" value={im.simplify} min={LIMITS.simplify.min} max={LIMITS.simplify.max} step={0.1} display={(v) => `${v.toFixed(1)} px`} onChange={(v) => onPatch({ imageSettings: { simplify: v } })} testId="image-simplify" />
            <SliderField label="Ignore specks smaller than" value={im.minFeature} min={LIMITS.minFeature.min} max={LIMITS.minFeature.max} step={2} display={(v) => `${v} px²`} onChange={(v) => onPatch({ imageSettings: { minFeature: v } })} testId="image-minfeature" />
            <p className="text-xs text-slate-500">Photos and gradients cannot be turned into clean relief. For best results use simple, high-contrast artwork on a plain background, or an SVG.</p>
          </div>
        )}
      </Section>

      <Section title="Hole placement" testId="section-hole">
        <HolePlacement card={card} model={model} onChange={onPatch} placeOnViewer={placeOnViewer} onTogglePlaceOnViewer={onTogglePlaceOnViewer} />
      </Section>

      <Section title="Geometry and print settings" testId="section-geometry" defaultOpen={false}>
        <SelectField label="Curve quality" value={g.quality} options={QUALITY} onChange={(v) => onPatch({ geometrySettings: { quality: v } })} testId="geometry-quality" />
        <div className="grid grid-cols-2 gap-3">
          <NumberField label="Edge clearance" value={g.edgeClearance} min={LIMITS.clearance.min} max={LIMITS.clearance.max} step={0.5} onChange={(v) => onPatch({ geometrySettings: { edgeClearance: v } })} testId="geometry-edge-clearance" hint="Details stay this far from the edge" />
          <NumberField label="Hole clearance" value={g.holeClearance} min={LIMITS.clearance.min} max={LIMITS.clearance.max} step={0.5} onChange={(v) => onPatch({ geometrySettings: { holeClearance: v } })} testId="geometry-hole-clearance" hint="Details stay this far from the hole" />
        </div>
        <div className="rounded-lg bg-slate-50 p-2.5 text-xs text-slate-600">
          <p className="font-semibold text-slate-700">Coordinates and units</p>
          <p>STL units are millimetres. The origin is the centre of the card, +X is to the right, +Y is up the card, +Z comes out of the front. The back face is at Z = 0, so the card lies flat on a print bed with the raised details facing up. Print in one colour: a standard STL cannot carry colours.</p>
        </div>
      </Section>
    </div>
  );
}
