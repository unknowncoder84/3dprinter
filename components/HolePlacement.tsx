'use client';

import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { AlertTriangle, RotateCcw, MousePointerClick } from 'lucide-react';
import { HOLE_PRESETS, LIMITS, presetPosition, type DeepPartial, type FlashcardConfig, type HolePreset } from '@/types/flashcard';
import type { FlashcardModel } from '@/lib/geometry/model';
import { clampHoleCenter, computeHolePlacement, holeWall, round2 } from '@/lib/geometry/hole';
import { regionToSvgPath } from '@/lib/geometry/svgPath';
import { NumberField, Toggle } from '@/components/ui/fields';

interface Props {
  card: FlashcardConfig;
  model: FlashcardModel | null;
  onChange: (patch: DeepPartial<FlashcardConfig>) => void;
  placeOnViewer: boolean;
  onTogglePlaceOnViewer: (v: boolean) => void;
}

const PRESET_GRID: Array<HolePreset | null> = [
  'top-left', 'top-center', 'top-right',
  'middle-left', 'custom', 'middle-right',
  'bottom-left', 'bottom-center', 'bottom-right',
];

export function HolePlacement({ card, model, onChange, placeOnViewer, onTogglePlaceOnViewer }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragging = useRef(false);
  const [note, setNote] = useState<string | null>(null);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dims = card.dimensions;
  const { width: W, height: H, cornerRadius: R } = dims;
  const h = card.holeSettings;
  const g = card.geometrySettings;
  const margin = h.diameter / 2 + g.edgeClearance;
  const wall = holeWall(h.x, h.y, dims, h.diameter);

  const showNote = (text: string | null) => {
    setNote(text);
    if (noteTimer.current) clearTimeout(noteTimer.current);
    if (text) noteTimer.current = setTimeout(() => setNote(null), 3500);
  };

  /** Convert a pointer position to card millimetres (from left / from top) using the SVG's own transform. */
  const toMm = (e: { clientX: number; clientY: number }): { x: number; y: number } | null => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return null;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  };

  const place = (x: number, y: number, fromPointer = true) => {
    if (!h.enabled) return;
    if (fromPointer && (x < 0 || x > W || y < 0 || y > H)) return; // outside the card
    const p = computeHolePlacement(x, y, dims, h.diameter, g.edgeClearance);
    onChange({ holeSettings: { x: p.x, y: p.y, preset: p.preset } });
    showNote(p.adjusted ? `Moved to the nearest valid spot: at least ${g.edgeClearance} mm of material must remain around the hole.` : null);
  };

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (!h.enabled) return;
    const p = toMm(e);
    if (!p) return;
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    place(p.x, p.y);
  };
  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!dragging.current) return;
    const p = toMm(e);
    if (p) place(p.x, p.y, false);
  };
  const endDrag = (e: PointerEvent<SVGSVGElement>) => {
    dragging.current = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };
  const onKeyDown = (e: KeyboardEvent<SVGSVGElement>) => {
    if (!h.enabled) return;
    const step = e.shiftKey ? 2 : 0.5;
    const d: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const v = d[e.key];
    if (!v) return;
    e.preventDefault();
    place(h.x + v[0], h.y + v[1], false);
  };

  const choosePreset = (preset: HolePreset) => {
    if (preset === 'custom') {
      onChange({ holeSettings: { preset: 'custom' } });
      return;
    }
    const p = presetPosition(preset, dims, h.diameter);
    const c = clampHoleCenter(p.x, p.y, dims, h.diameter, g.edgeClearance);
    onChange({ holeSettings: { preset, x: round2(c.x), y: round2(c.y) } });
    showNote(null);
  };

  const resetPosition = () => {
    choosePreset('top-left');
  };

  const pad = 2.5;
  const validW = W - 2 * margin;
  const validH = H - 2 * margin;
  const holeIssues = (model?.issues ?? []).filter((i) => i.code.startsWith('hole'));
  const collides = holeIssues.some((i) => i.code === 'hole-collision');
  const markerColor = holeIssues.some((i) => i.code === 'hole-edge') ? '#dc2626' : collides ? '#d97706' : '#16a34a';

  return (
    <div className="space-y-3" data-testid="hole-section">
      <Toggle label="Hanging hole" description="Cut a real hole through the whole card" checked={h.enabled} onChange={(v) => onChange({ holeSettings: { enabled: v } })} testId="hole-enabled" />

      <div className={h.enabled ? 'space-y-3' : 'pointer-events-none space-y-3 opacity-50'} aria-disabled={!h.enabled}>
        <NumberField label="Hole diameter" value={h.diameter} min={LIMITS.holeDiameter.min} max={LIMITS.holeDiameter.max} step={0.5} onChange={(v) => onChange({ holeSettings: { diameter: v } })} testId="hole-diameter" />

        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-medium text-slate-600">Click or tap the card to place the hole</span>
            <span className="text-xs text-slate-400">arrow keys nudge</span>
          </div>
          <svg
            ref={svgRef}
            data-testid="hole-canvas"
            role="application"
            aria-label="Hole placement. Click or tap on the card to choose where the hole is cut. Arrow keys nudge it."
            tabIndex={0}
            viewBox={`${-pad} ${-pad} ${W + 2 * pad} ${H + 2 * pad}`}
            className="mx-auto block max-h-72 w-full cursor-crosshair touch-none select-none rounded-lg bg-slate-100 outline-none focus-visible:ring-2 focus-visible:ring-green-500"
            style={{ touchAction: 'none' }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onKeyDown={onKeyDown}
          >
            <rect x={0} y={0} width={W} height={H} rx={R} ry={R} fill="#ffffff" stroke="#94a3b8" strokeWidth={0.6} />
            {model && (
              <g fill="#334155" fillRule="evenodd" opacity={0.85} pointerEvents="none">
                <path d={regionToSvgPath(model.layers.alphabet, W, H)} />
                <path d={regionToSvgPath(model.layers.image, W, H)} />
                <path d={regionToSvgPath(model.layers.word, W, H)} />
              </g>
            )}
            {validW > 0 && validH > 0 && (
              <rect x={margin} y={margin} width={validW} height={validH} rx={Math.max(0, R - margin)} fill="none" stroke="#22c55e" strokeWidth={0.4} strokeDasharray="1.5 1.5" pointerEvents="none" />
            )}
            {h.enabled && (
              <g pointerEvents="none" data-testid="hole-marker" data-x={h.x} data-y={h.y}>
                <circle cx={h.x} cy={h.y} r={h.diameter / 2} fill={markerColor} fillOpacity={0.18} stroke={markerColor} strokeWidth={0.7} />
                <path d={`M${h.x - 1.6} ${h.y}H${h.x + 1.6}M${h.x} ${h.y - 1.6}V${h.y + 1.6}`} stroke={markerColor} strokeWidth={0.5} />
              </g>
            )}
          </svg>
          <p className="mt-1 text-center text-xs text-slate-500" data-testid="hole-readout">
            Centre: {h.x.toFixed(1)} mm from left · {h.y.toFixed(1)} mm from top · {wall.toFixed(1)} mm to edge
          </p>
          {note && (
            <p className="mt-1 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800" role="status" data-testid="hole-note">
              {note}
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <NumberField label="From left edge" value={round2(h.x)} min={0} max={W} step={0.5} onChange={(v) => place(v, h.y, false)} testId="hole-x" />
          <NumberField label="From top edge" value={round2(h.y)} min={0} max={H} step={0.5} onChange={(v) => place(h.x, v, false)} testId="hole-y" />
        </div>

        <div>
          <span className="mb-1 block text-xs font-medium text-slate-600">Position presets</span>
          <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="Hole position presets">
            {PRESET_GRID.map((p, i) => {
              if (!p) return <span key={i} />;
              const label = HOLE_PRESETS.find((x) => x.id === p)!.label;
              const active = h.preset === p;
              return (
                <button
                  key={p}
                  type="button"
                  data-testid={`hole-preset-${p}`}
                  aria-pressed={active}
                  onClick={() => choosePreset(p)}
                  className={`rounded-lg border px-1.5 py-1.5 text-xs font-medium leading-tight ${active ? 'border-green-600 bg-green-600 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={resetPosition} data-testid="hole-reset" className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
            <RotateCcw className="h-3.5 w-3.5" /> Reset hole position
          </button>
          <button
            type="button"
            onClick={() => onTogglePlaceOnViewer(!placeOnViewer)}
            aria-pressed={placeOnViewer}
            data-testid="hole-place-3d"
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium ${placeOnViewer ? 'border-green-600 bg-green-50 text-green-800' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}
          >
            <MousePointerClick className="h-3.5 w-3.5" /> Place on 3D view
          </button>
        </div>

        {holeIssues.length > 0 && (
          <ul className="space-y-1" data-testid="hole-issues">
            {holeIssues.map((i, k) => (
              <li key={k} className={`flex gap-1.5 rounded px-2 py-1 text-xs ${i.severity === 'error' ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-800'}`}>
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                {i.message}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
