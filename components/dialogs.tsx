'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Loader2, Trash2, CheckCircle2, XCircle, Clock } from 'lucide-react';
import type { FlashcardConfig } from '@/types/flashcard';
import { Modal, btn } from '@/components/ui/Modal';
import { deleteProject, estimateStorage, listProjects, type ProjectSummary } from '@/lib/storage/projectDb';
import type { ApplyGroup } from '@/lib/state/projectState';
import { exportCardsToZip, type BatchProgress } from '@/lib/export/batch';
import { downloadBlob } from '@/lib/export/download';

// ---------------------------------------------------------------------------

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: React.ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      testId="confirm-dialog"
      footer={
        <>
          <button type="button" className={`${btn.base} ${btn.secondary}`} onClick={onCancel} data-testid="confirm-cancel">
            Cancel
          </button>
          <button type="button" className={`${btn.base} ${danger ? btn.danger : btn.primary}`} onClick={onConfirm} data-testid="confirm-ok">
            {confirmLabel}
          </button>
        </>
      }
    >
      <div>{message}</div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------

export function SaveProjectDialog({ initialName, onSave, onCancel }: { initialName: string; onSave: (name: string) => Promise<void>; onCancel: () => void }) {
  const [name, setName] = useState(initialName);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const n = name.trim();
    if (!n) return;
    setBusy(true);
    try {
      await onSave(n);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Save project"
      onClose={onCancel}
      testId="save-dialog"
      footer={
        <>
          <button type="button" className={`${btn.base} ${btn.secondary}`} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className={`${btn.base} ${btn.primary}`} disabled={busy || !name.trim()} onClick={submit} data-testid="save-confirm">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Save in this browser
          </button>
        </>
      }
    >
      <label htmlFor="project-name" className="mb-1 block text-xs font-medium text-slate-600">
        Project name
      </label>
      <input
        id="project-name"
        data-testid="project-name-input"
        value={name}
        maxLength={80}
        autoFocus
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void submit();
        }}
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-green-500"
      />
      <p className="mt-2 text-xs text-slate-500">Saved in this browser only (IndexedDB), including all cards, settings and illustrations. Use “Export project” to keep a file you can move between computers.</p>
    </Modal>
  );
}

// ---------------------------------------------------------------------------

export function LoadProjectDialog({ onLoad, onClose, onError }: { onLoad: (id: string) => Promise<void>; onClose: () => void; onError: (m: string) => void }) {
  const [items, setItems] = useState<ProjectSummary[] | null>(null);
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ProjectSummary | null>(null);

  const refresh = async () => {
    try {
      setItems(await listProjects());
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
      setItems([]);
    }
    setStorage(await estimateStorage());
  };
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const mb = (n: number) => (n / 1048576).toFixed(1);

  return (
    <>
      <Modal title="Load project" onClose={onClose} wide testId="load-dialog" footer={<button type="button" className={`${btn.base} ${btn.secondary}`} onClick={onClose}>Close</button>}>
        {items === null ? (
          <p className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Reading saved projects…</p>
        ) : items.length === 0 ? (
          <p data-testid="load-empty">No saved projects yet. Use “Save” to store one in this browser, or “Import project” to open a file.</p>
        ) : (
          <ul className="divide-y divide-slate-200" data-testid="project-list">
            {items.map((p) => (
              <li key={p.id} className="flex items-center gap-2 py-2" data-testid="project-item">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-slate-900">{p.name}</p>
                  <p className="text-xs text-slate-500">
                    {p.cardCount} card{p.cardCount === 1 ? '' : 's'} · ~{mb(p.approxBytes)} MB · {new Date(p.updatedAt).toLocaleString()}
                  </p>
                </div>
                <button type="button" className={`${btn.base} ${btn.primary}`} disabled={busyId !== null} data-testid="project-open" onClick={async () => { setBusyId(p.id); try { await onLoad(p.id); } finally { setBusyId(null); } }}>
                  {busyId === p.id && <Loader2 className="h-4 w-4 animate-spin" />} Open
                </button>
                <button type="button" aria-label={`Delete ${p.name}`} className={`${btn.base} ${btn.secondary} !px-2 text-red-700`} onClick={() => setConfirmDelete(p)}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {storage && storage.quota > 0 && (
          <p className="mt-3 text-xs text-slate-500">Browser storage in use: {mb(storage.usage)} MB of about {mb(storage.quota)} MB available.</p>
        )}
      </Modal>
      {confirmDelete && (
        <ConfirmDialog
          title="Delete saved project?"
          danger
          confirmLabel="Delete"
          message={<>“{confirmDelete.name}” will be removed from this browser. This cannot be undone.</>}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={async () => {
            const p = confirmDelete;
            setConfirmDelete(null);
            try {
              await deleteProject(p.id);
              await refresh();
            } catch (e) {
              onError(e instanceof Error ? e.message : String(e));
            }
          }}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

const GROUPS: { id: ApplyGroup; label: string; hint: string }[] = [
  { id: 'dimensions', label: 'Card dimensions', hint: 'width, height, thickness, corner radius' },
  { id: 'hole', label: 'Hole settings', hint: 'on/off, diameter, position (presets follow each card’s size)' },
  { id: 'text', label: 'Text style', hint: 'font, sizes, heights, alignment (not the letters or words)' },
  { id: 'image', label: 'Image settings', hint: 'size box, relief height, conversion options (not the pictures)' },
  { id: 'geometry', label: 'Geometry settings', hint: 'curve quality and clearances' },
  { id: 'appearance', label: 'Colours, text type and border', hint: 'preview colours, font choice and raised border' },
];

export function ApplySettingsDialog({
  cards,
  source,
  onApply,
  onClose,
}: {
  cards: FlashcardConfig[];
  source: FlashcardConfig;
  onApply: (groups: ApplyGroup[], toIds: string[]) => void;
  onClose: () => void;
}) {
  const [groups, setGroups] = useState<Set<ApplyGroup>>(new Set(['dimensions', 'hole']));
  const others = cards.filter((c) => c.id !== source.id);
  const [targets, setTargets] = useState<Set<string>>(new Set(others.map((c) => c.id)));
  const toggle = <T,>(set: Set<T>, v: T, upd: (s: Set<T>) => void) => {
    const n = new Set(set);
    if (n.has(v)) n.delete(v);
    else n.add(v);
    upd(n);
  };
  return (
    <Modal
      title={`Apply settings from “${source.alphabet || '—'}” to other cards`}
      onClose={onClose}
      wide
      testId="apply-dialog"
      footer={
        <>
          <button type="button" className={`${btn.base} ${btn.secondary}`} onClick={onClose}>Cancel</button>
          <button type="button" className={`${btn.base} ${btn.primary}`} disabled={groups.size === 0 || targets.size === 0} onClick={() => onApply([...groups], [...targets])} data-testid="apply-confirm">
            Apply to {targets.size} card{targets.size === 1 ? '' : 's'}
          </button>
        </>
      }
    >
      <p className="mb-2 text-xs text-slate-500">Each card keeps its own letters, words and illustrations. Only the chosen settings are copied.</p>
      <fieldset className="mb-3 space-y-1.5">
        <legend className="mb-1 text-xs font-semibold text-slate-600">Settings to copy</legend>
        {GROUPS.map((g) => (
          <label key={g.id} className="flex items-start gap-2">
            <input type="checkbox" className="mt-0.5 accent-green-600" checked={groups.has(g.id)} onChange={() => toggle(groups, g.id, setGroups)} data-testid={`apply-group-${g.id}`} />
            <span><span className="font-medium text-slate-800">{g.label}</span> <span className="text-xs text-slate-500">– {g.hint}</span></span>
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend className="mb-1 flex w-full items-center justify-between text-xs font-semibold text-slate-600">
          Cards
          <span className="space-x-2 font-normal">
            <button type="button" className="underline" onClick={() => setTargets(new Set(others.map((c) => c.id)))}>all</button>
            <button type="button" className="underline" onClick={() => setTargets(new Set())}>none</button>
          </span>
        </legend>
        <div className="grid max-h-48 grid-cols-2 gap-1 overflow-y-auto sm:grid-cols-3">
          {others.map((c) => (
            <label key={c.id} className="flex items-center gap-2 rounded px-1.5 py-1 hover:bg-slate-50">
              <input type="checkbox" className="accent-green-600" checked={targets.has(c.id)} onChange={() => toggle(targets, c.id, setTargets)} />
              <span className="truncate">{c.alphabet || '—'} · {c.word || '(no word)'}</span>
            </label>
          ))}
          {others.length === 0 && <p className="text-xs text-slate-500">There are no other cards yet. Use “Generate A–Z” first.</p>}
        </div>
      </fieldset>
    </Modal>
  );
}

// ---------------------------------------------------------------------------

export function ExportAllDialog({ cards, selectedId, onClose, onResult }: { cards: FlashcardConfig[]; selectedId: string; onClose: () => void; onResult: (kind: 'success' | 'warning' | 'error', message: string) => void }) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(cards.filter((c) => c.image).map((c) => c.id)));
  const [progress, setProgress] = useState<BatchProgress | null>(null);
  const [zip, setZip] = useState<Blob | null>(null);
  const cancelRef = useRef(false);
  const running = progress !== null && (progress.phase === 'generating' || progress.phase === 'zipping');
  const chosen = useMemo(() => cards.filter((c) => selected.has(c.id)), [cards, selected]);
  const missing = chosen.filter((c) => !c.image).length;

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const start = async () => {
    cancelRef.current = false;
    setZip(null);
    const outcome = await exportCardsToZip(chosen, setProgress, () => cancelRef.current);
    const p = outcome.progress;
    if (outcome.zip) {
      setZip(outcome.zip);
      downloadBlob(outcome.zip, 'flashcards-stl.zip');
      onResult(p.failed ? 'warning' : 'success', `ZIP downloaded with ${p.completed} STL file${p.completed === 1 ? '' : 's'}${p.failed ? `; ${p.failed} card${p.failed === 1 ? '' : 's'} failed (see the list)` : ''}.`);
    } else if (p.phase === 'cancelled') {
      onResult('warning', 'Export cancelled. No ZIP was created.');
    } else {
      onResult('error', 'No ZIP was created because no card could be generated.');
    }
  };

  const pct = progress ? Math.round(((progress.completed + progress.failed) / Math.max(1, progress.total)) * 100) : 0;
  const finished = progress !== null && (progress.phase === 'finished' || progress.phase === 'cancelled');

  return (
    <Modal
      title="Export STL files as ZIP"
      onClose={onClose}
      wide
      locked={running}
      testId="export-all-dialog"
      footer={
        running ? (
          <button type="button" className={`${btn.base} ${btn.secondary}`} onClick={() => { cancelRef.current = true; }} data-testid="batch-cancel">Cancel after current card</button>
        ) : (
          <>
            <button type="button" className={`${btn.base} ${btn.secondary}`} onClick={onClose} data-testid="batch-close">Close</button>
            {zip && (
              <button type="button" className={`${btn.base} ${btn.secondary}`} onClick={() => downloadBlob(zip, 'flashcards-stl.zip')} data-testid="batch-download-again">
                <Download className="h-4 w-4" /> Download ZIP again
              </button>
            )}
            {!finished && (
              <button type="button" className={`${btn.base} ${btn.primary}`} disabled={chosen.length === 0} onClick={start} data-testid="batch-start">
                Generate {chosen.length} card{chosen.length === 1 ? '' : 's'} & download ZIP
              </button>
            )}
          </>
        )
      }
    >
      {!progress && (
        <>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-slate-500">Each card is generated as real geometry, checked, and written as its own binary STL (millimetres). Cards that fail are reported and left out.</p>
            <span className="space-x-2 text-xs">
              <button type="button" className="underline" onClick={() => setSelected(new Set(cards.map((c) => c.id)))} data-testid="batch-select-all">all</button>
              <button type="button" className="underline" onClick={() => setSelected(new Set(cards.filter((c) => c.image).map((c) => c.id)))}>with illustration</button>
              <button type="button" className="underline" onClick={() => setSelected(new Set([selectedId]))}>this card</button>
              <button type="button" className="underline" onClick={() => setSelected(new Set())}>none</button>
            </span>
          </div>
          <ul className="grid max-h-72 grid-cols-1 gap-x-3 overflow-y-auto sm:grid-cols-2" data-testid="batch-list">
            {cards.map((c) => (
              <li key={c.id}>
                <label className="flex items-center gap-2 rounded px-1.5 py-1 hover:bg-slate-50">
                  <input type="checkbox" className="accent-green-600" checked={selected.has(c.id)} onChange={() => toggle(c.id)} data-testid="batch-check" />
                  <span className="truncate">{c.alphabet || '—'} · {c.word || '(no word)'}</span>
                  {!c.image && <span className="ml-auto shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">needs image</span>}
                </label>
              </li>
            ))}
          </ul>
          {missing > 0 && <p className="mt-2 rounded bg-amber-50 px-2 py-1.5 text-xs text-amber-800">{missing} selected card{missing === 1 ? ' has' : 's have'} no illustration and will be exported with letters and word only.</p>}
        </>
      )}

      {progress && (
        <div data-testid="batch-progress" data-phase={progress.phase}>
          <div className="mb-1 flex items-center justify-between text-xs text-slate-600">
            <span data-testid="batch-summary">
              Total {progress.total} · completed {progress.completed} · failed {progress.failed}
            </span>
            <span>{pct}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
            <div className="h-full bg-green-600 transition-all" style={{ width: `${pct}%` }} />
          </div>
          {progress.current && (
            <p className="mt-2 flex items-center gap-2 text-xs text-slate-600" data-testid="batch-current">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> {progress.phase === 'zipping' ? progress.current : `Generating ${progress.current}`}
            </p>
          )}
          <ul className="mt-3 max-h-64 space-y-1 overflow-y-auto" data-testid="batch-items">
            {progress.items.map((it) => (
              <li key={it.id} className="flex items-start gap-2 text-xs" data-status={it.status}>
                {it.status === 'done' ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-600" /> : it.status === 'failed' ? <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600" /> : it.status === 'working' ? <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" /> : <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />}
                <span className="min-w-0 flex-1">
                  <span className="font-medium text-slate-800">{it.label}</span>
                  {it.status === 'done' && <span className="text-slate-500"> → {it.fileName} · {((it.bytes ?? 0) / 1024).toFixed(0)} KB · {it.triangles?.toLocaleString()} triangles</span>}
                  {it.status === 'failed' && <span className="block text-red-700">{it.message}</span>}
                  {it.status === 'skipped' && <span className="text-slate-500"> skipped</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  );
}
