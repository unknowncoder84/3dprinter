'use client';

import { AlertTriangle, CheckCircle2, XCircle, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import type { FlashcardModel } from '@/lib/geometry/model';
import type { ExportedStl } from '@/lib/export/exportStl';

export interface ExportRecord {
  cardId: string;
  at: number;
  fileName: string;
  fileBytes: number;
  triangles: number;
  size: [number, number, number];
  expected: { width: number; height: number; zMax: number };
  dimensionsMatch: boolean;
  closedManifold: boolean;
  components: number;
}

export function toExportRecord(cardId: string, stl: ExportedStl): ExportRecord {
  const v = stl.report.validation;
  return {
    cardId,
    at: Date.now(),
    fileName: stl.fileName,
    fileBytes: stl.report.fileBytes,
    triangles: v.triangles,
    size: v.size,
    expected: stl.expected,
    dimensionsMatch: stl.dimensionsMatch,
    closedManifold: v.closedManifold,
    components: v.components,
  };
}

const n2 = (v: number) => (Math.round(v * 100) / 100).toFixed(2);

export function StatusPanel({ model, building, error, lastExport, cardId }: { model: FlashcardModel | null; building: boolean; error: string | null; lastExport: ExportRecord | null; cardId: string }) {
  const [open, setOpen] = useState(true);
  const issues = model?.issues ?? [];
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning' && !i.code.startsWith('image') && !i.code.startsWith('hole'));
  const v = model?.validation;
  const e = model?.expected;
  const dimsOk = v && e ? Math.abs(v.size[0] - e.width) < 0.02 && Math.abs(v.size[1] - e.height) < 0.02 && Math.abs(v.size[2] - e.maxZ) < 0.02 : false;
  const exp = lastExport && lastExport.cardId === cardId ? lastExport : null;

  return (
    <div className="border-t border-slate-200 bg-white text-xs text-slate-700" data-testid="status-panel">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center justify-between px-4 py-2 text-left font-semibold text-slate-900 hover:bg-slate-50">
        <span className="flex items-center gap-2">
          Model check & export status
          {building ? <span className="font-normal text-slate-500">· generating…</span> : error ? <span className="font-normal text-red-600">· error</span> : errors.length ? <span className="font-normal text-red-600">· {errors.length} problem{errors.length === 1 ? '' : 's'}</span> : warnings.length ? <span className="font-normal text-amber-600">· {warnings.length} warning{warnings.length === 1 ? '' : 's'}</span> : model ? <span className="font-normal text-green-700">· no problems found</span> : null}
        </span>
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {open && (
        <div className="grid gap-3 px-4 pb-3 md:grid-cols-3">
          <div data-testid="check-dimensions">
            <p className="mb-1 font-semibold text-slate-600">Dimensions (mm)</p>
            {model && v && e ? (
              <table className="w-full">
                <tbody>
                  <tr><td className="pr-2 text-slate-500">Expected</td><td className="tabular-nums">{n2(e.width)} × {n2(e.height)} × {n2(e.maxZ)}</td></tr>
                  <tr><td className="pr-2 text-slate-500">Measured</td><td className="tabular-nums">{n2(v.size[0])} × {n2(v.size[1])} × {n2(v.size[2])} {dimsOk ? <CheckCircle2 className="inline h-3.5 w-3.5 text-green-600" aria-label="matches" /> : <XCircle className="inline h-3.5 w-3.5 text-red-600" aria-label="differs" />}</td></tr>
                  <tr><td className="pr-2 text-slate-500">Triangles</td><td className="tabular-nums">{v.triangles.toLocaleString()}</td></tr>
                </tbody>
              </table>
            ) : (
              <p className="text-slate-400">—</p>
            )}
          </div>

          <div data-testid="check-mesh">
            <p className="mb-1 font-semibold text-slate-600">Mesh checks</p>
            {model && v ? (
              <ul className="space-y-0.5">
                <li className="flex items-center gap-1.5">{v.closedManifold ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600" /> : <XCircle className="h-3.5 w-3.5 text-red-600" />} Closed and manifold surface</li>
                <li className="flex items-center gap-1.5">{v.components === 1 ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600" /> : <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />} {v.components} connected piece{v.components === 1 ? '' : 's'}</li>
                <li className="flex items-center gap-1.5">{v.degenerate === 0 ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600" /> : <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />} {v.degenerate} degenerate triangles</li>
                <li className="text-slate-500">Self-intersections and wall thickness are not checked; confirm in your slicer.</li>
              </ul>
            ) : (
              <p className="text-slate-400">—</p>
            )}
          </div>

          <div data-testid="check-export">
            <p className="mb-1 font-semibold text-slate-600">Last STL export</p>
            {exp ? (
              <ul className="space-y-0.5">
                <li className="font-medium text-slate-900" data-testid="export-file">{exp.fileName}</li>
                <li className="tabular-nums">{(exp.fileBytes / 1024).toFixed(0)} KB · {exp.triangles.toLocaleString()} triangles</li>
                <li className="tabular-nums">Bounding box {n2(exp.size[0])} × {n2(exp.size[1])} × {n2(exp.size[2])} mm {exp.dimensionsMatch ? <CheckCircle2 className="inline h-3.5 w-3.5 text-green-600" aria-label="matches expected" /> : <XCircle className="inline h-3.5 w-3.5 text-red-600" aria-label="differs from expected" />}</li>
                <li>{exp.closedManifold ? 'File re-read: closed and manifold' : 'File re-read: has open or non-manifold edges'}, {exp.components} piece{exp.components === 1 ? '' : 's'}</li>
              </ul>
            ) : (
              <p className="text-slate-400">Nothing exported for this card yet.</p>
            )}
          </div>

          {(errors.length > 0 || warnings.length > 0) && (
            <ul className="space-y-1 md:col-span-3" data-testid="issue-list">
              {errors.map((i, k) => (
                <li key={`e${k}`} className="flex gap-1.5 rounded bg-red-50 px-2 py-1 text-red-800" data-severity="error"><XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {i.message}</li>
              ))}
              {warnings.map((i, k) => (
                <li key={`w${k}`} className="flex gap-1.5 rounded bg-amber-50 px-2 py-1 text-amber-800" data-severity="warning"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {i.message}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
