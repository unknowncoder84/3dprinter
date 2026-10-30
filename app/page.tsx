'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useReducer, useRef, useState, type ReactNode } from 'react';
import { Copy, Download, FilePlus, FilePlus2, FolderOpen, Hash, Loader2, Package, Save, Settings2, Sparkles, Upload, Boxes } from 'lucide-react';
import type { CardImage, DeepPartial, FlashcardConfig } from '@/types/flashcard';
import { createInitialState, missingLetters, projectReducer, type ApplyGroup, type LoadedProject } from '@/lib/state/projectState';
import { useFlashcardModel } from '@/lib/state/useFlashcardModel';
import { getModel } from '@/lib/state/modelCache';
import { createStl, ExportError } from '@/lib/export/exportStl';
import { downloadBlob, stlBlob } from '@/lib/export/download';
import { AUTOSAVE_ID, getProject, putProject, StorageError } from '@/lib/storage/projectDb';
import { parseProject, projectFileName, ProjectFileError, serializeProject } from '@/lib/storage/projectFile';
import { computeHolePlacement } from '@/lib/geometry/hole';
import CardControls from '@/components/CardControls';
import { CardStrip } from '@/components/CardStrip';
import { StatusPanel, toExportRecord, type ExportRecord } from '@/components/StatusPanel';
import { ApplySettingsDialog, ConfirmDialog, ExportAllDialog, LoadProjectDialog, SaveProjectDialog } from '@/components/dialogs';
import { NumberRangeDialog } from '@/components/NumberRangeDialog';
import { ToastProvider, useToast } from '@/components/ui/Toast';
import { btn } from '@/components/ui/Modal';

const FlashcardViewer3D = dynamic(() => import('@/components/FlashcardViewer3D'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-slate-100 text-sm text-slate-500">
      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading 3D viewer…
    </div>
  ),
});

interface ConfirmRequest {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  danger?: boolean;
}

type Dialog = null | 'save' | 'load' | 'exportAll' | 'apply' | 'numbers';

function App() {
  const toast = useToast();
  const [state, dispatch] = useReducer(projectReducer, undefined, createInitialState);
  const [ready, setReady] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [confirmState, setConfirmState] = useState<{ req: ConfirmRequest; resolve: (v: boolean) => void } | null>(null);
  const [placeOnViewer, setPlaceOnViewer] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [lastExport, setLastExport] = useState<ExportRecord | null>(null);
  const [autosave, setAutosave] = useState<{ at: number } | { error: string } | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  const card: FlashcardConfig = state.cards.find((c) => c.id === state.selectedId) ?? state.cards[0];
  const m = useFlashcardModel(ready ? card : undefined);

  const confirm = useCallback(
    (req: ConfirmRequest) => new Promise<boolean>((resolve) => setConfirmState({ req, resolve })),
    [],
  );

  // ---------------------------------------------------------------- restore last session
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const rec = await getProject(AUTOSAVE_ID);
        if (rec && alive) {
          const parsed = parseProject(rec.project);
          dispatch({ type: 'replace', project: { ...parsed.project, projectId: '', projectName: parsed.project.projectName } });
          toast.push('info', `Restored your last session (${parsed.project.cards.length} card${parsed.project.cards.length === 1 ? '' : 's'}).`);
        }
      } catch (e) {
        if (alive) toast.push('warning', e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setReady(true);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------- autosave (debounced)
  const autosaveWarned = useRef(false);
  useEffect(() => {
    if (!ready || state.revision === 0) return;
    const t = setTimeout(async () => {
      try {
        await putProject(AUTOSAVE_ID, serializeProject(state));
        setAutosave({ at: Date.now() });
        autosaveWarned.current = false;
      } catch (e) {
        const msg = e instanceof StorageError ? e.message : String(e);
        setAutosave({ error: msg });
        if (!autosaveWarned.current) {
          autosaveWarned.current = true;
          toast.push('warning', `Automatic backup failed. ${msg}`);
        }
      }
    }, 1200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.revision, ready]);

  useEffect(() => {
    const onBefore = (e: BeforeUnloadEvent) => {
      if (state.dirty && autosave && 'error' in autosave) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onBefore);
    return () => window.removeEventListener('beforeunload', onBefore);
  }, [state.dirty, autosave]);

  // ---------------------------------------------------------------- editing
  const patchCard = useCallback((patch: DeepPartial<FlashcardConfig>) => dispatch({ type: 'update', id: card.id, patch }), [card.id]);
  const setImage = useCallback((image: CardImage | null) => dispatch({ type: 'setImage', id: card.id, image }), [card.id]);

  const placeHole = useCallback(
    (x: number, y: number) => {
      if (!card.holeSettings.enabled) return;
      const p = computeHolePlacement(x, y, card.dimensions, card.holeSettings.diameter, card.geometrySettings.edgeClearance);
      patchCard({ holeSettings: { x: p.x, y: p.y, preset: p.preset } });
      if (p.adjusted) toast.push('info', 'Hole moved to the nearest valid position (it must keep material around it).');
    },
    [card, patchCard, toast],
  );

  const onNewCard = () => {
    dispatch({ type: 'add' });
    toast.push('success', 'New card created. Enter its alphabet, word and illustration.');
  };
  const onDuplicate = () => {
    dispatch({ type: 'duplicate', id: card.id });
    toast.push('success', 'Card duplicated. The copy is independent of the original.');
  };
  const onGenerateAz = () => {
    const missing = missingLetters(state.cards);
    if (missing.length === 0) {
      toast.push('info', 'All 26 letters already have a card. Nothing was changed.');
      return;
    }
    dispatch({ type: 'generateAz' });
    toast.push('success', `Added ${missing.length} card${missing.length === 1 ? '' : 's'} (${missing.join(' ')}) using the selected card’s settings. Existing cards were not touched. Upload an illustration for each card before exporting.`);
  };
  const onGenerateNumbers = (from: number, to: number) => {
    dispatch({ type: 'generateNumbers', from, to });
    setDialog(null);
    toast.push('success', `Added missing number cards from ${from} to ${to}. Edit their words and add illustrations as needed.`);
  };

  const onDeleteCard = async () => {
    const ok = await confirm({
      title: 'Delete this card?',
      message: <>Card “{card.alphabet || '—'} · {card.word || '(no word)'}” and its illustration will be removed from the project.</>,
      confirmLabel: 'Delete card',
      danger: true,
    });
    if (ok) {
      dispatch({ type: 'delete', id: card.id });
      toast.push('info', 'Card deleted.');
    }
  };

  // ---------------------------------------------------------------- STL export
  const onExportStl = async () => {
    if (exporting) return;
    if (!card.image) {
      const ok = await confirm({
        title: 'Export without an illustration?',
        message: <>This card has no illustration yet, so the STL will contain only the card, the alphabet and the word.</>,
        confirmLabel: 'Export anyway',
      });
      if (!ok) return;
    }
    setExporting(true);
    try {
      const model = await getModel(card);
      const stl = createStl(card, model);
      downloadBlob(stlBlob(stl.buffer), stl.fileName);
      setLastExport(toExportRecord(card.id, stl));
      const v = stl.report.validation;
      toast.push(
        stl.dimensionsMatch && v.closedManifold ? 'success' : 'warning',
        `Downloaded ${stl.fileName} (${(stl.report.fileBytes / 1024).toFixed(0)} KB, ${v.triangles.toLocaleString()} triangles, ${v.size.map((s) => s.toFixed(1)).join(' × ')} mm).${stl.warnings.length ? ` ${stl.warnings.length} warning${stl.warnings.length === 1 ? '' : 's'} – see the status panel.` : ''}`,
      );
    } catch (e) {
      toast.push('error', e instanceof ExportError || e instanceof Error ? `STL export failed: ${e.message}` : 'STL export failed.');
    } finally {
      setExporting(false);
    }
  };

  // ---------------------------------------------------------------- project save / load / import / export
  const saveProject = async (name: string) => {
    try {
      const id = state.projectId || (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Date.now()));
      await putProject(id, serializeProject({ ...state, projectName: name }));
      dispatch({ type: 'markSaved', projectId: id, projectName: name });
      setDialog(null);
      toast.push('success', `Project “${name}” saved in this browser (${state.cards.length} cards).`);
    } catch (e) {
      toast.push('error', `Not saved. ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  const onSaveClick = useCallback(async () => {
    if (state.projectId) {
      try {
        await putProject(state.projectId, serializeProject(state));
        dispatch({ type: 'markSaved', projectId: state.projectId, projectName: state.projectName });
        toast.push('success', `Project “${state.projectName}” saved.`);
      } catch (e) {
        toast.push('error', `Not saved. ${e instanceof Error ? e.message : String(e)}`);
      }
    } else {
      setDialog('save');
    }
  }, [state, toast]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void onSaveClick();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onSaveClick]);

  const confirmReplace = async (what: string): Promise<boolean> => {
    if (!state.dirty) return true;
    return confirm({
      title: 'Replace unsaved work?',
      message: <>You have unsaved changes in “{state.projectName}”. {what} will replace them. Use “Save” or “Export project” first if you want to keep them.</>,
      confirmLabel: 'Replace',
      danger: true,
    });
  };

  const loadSaved = async (id: string) => {
    if (!(await confirmReplace('Opening the saved project'))) return;
    try {
      const rec = await getProject(id);
      if (!rec) throw new ProjectFileError('That project no longer exists.');
      const parsed = parseProject(rec.project);
      const project: LoadedProject = { ...parsed.project, projectId: id === AUTOSAVE_ID ? '' : id, projectName: id === AUTOSAVE_ID ? 'Restored backup' : rec.name };
      dispatch({ type: 'replace', project });
      setDialog(null);
      setLastExport(null);
      toast.push('success', `Loaded “${project.projectName}” (${project.cards.length} cards).`);
      parsed.warnings.forEach((w) => toast.push('warning', w));
    } catch (e) {
      toast.push('error', `Could not load the project. ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const onExportProject = () => {
    try {
      const file = serializeProject(state);
      const json = JSON.stringify(file);
      const name = projectFileName(state.projectName);
      downloadBlob(new Blob([json], { type: 'application/json' }), name);
      toast.push('success', `Project file ${name} downloaded (${(json.length / 1024).toFixed(0)} KB, ${state.cards.length} cards, illustrations included).`);
    } catch (e) {
      toast.push('error', `Project export failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const onImportFile = async (file: File | undefined) => {
    if (importRef.current) importRef.current.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = parseProject(text); // validates before anything is replaced
      if (!(await confirmReplace(`Importing “${file.name}” (${parsed.project.cards.length} cards)`))) return;
      dispatch({ type: 'replace', project: { ...parsed.project, projectName: parsed.project.projectName } });
      setLastExport(null);
      toast.push('success', `Imported “${parsed.project.projectName}” with ${parsed.project.cards.length} card${parsed.project.cards.length === 1 ? '' : 's'}.`);
      parsed.warnings.forEach((w) => toast.push('warning', w));
    } catch (e) {
      toast.push('error', e instanceof ProjectFileError ? `Import failed: ${e.message}` : `Import failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const onNewProject = async () => {
    if (!(await confirmReplace('A new empty project'))) return;
    dispatch({ type: 'replace', project: { projectId: '', projectName: 'Untitled project', cards: createInitialState().cards } });
    setLastExport(null);
    toast.push('info', 'New project started.');
  };

  // ---------------------------------------------------------------- render
  if (!ready) {
    return (
      <div className="flex h-dvh items-center justify-center text-sm text-slate-500" data-testid="booting">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Starting 3D Flashcard Studio…
      </div>
    );
  }

  const displayModel = m.modelCardId === card.id ? m.model : null;
  // "building" also covers the render right after an edit, before the hook has started the new build
  const building = m.status === 'building' || (m.status === 'ready' && m.forCard !== card);
  const stale = m.status === 'error' && displayModel !== null;
  const blocking = !displayModel || displayModel.blocking || building || m.status === 'error';
  const exportTitle = building ? 'Wait for the geometry to finish generating' : m.status === 'error' ? 'Fix the geometry error first' : displayModel?.blocking ? 'This card has errors – see the status panel' : 'Generate the STL for this card and download it';

  const tbtn = `${btn.base} ${btn.secondary} !px-2.5 !py-1 !text-xs whitespace-nowrap`;

  return (
    <div className="flex min-h-dvh flex-col bg-slate-50 text-slate-900 lg:h-dvh lg:overflow-hidden">
      <header className="border-b border-slate-200 bg-white">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-green-600 text-white" aria-hidden>
              <Boxes className="h-5 w-5" />
            </div>
            <div className="leading-tight">
              <h1 className="text-base font-bold">3D Flashcard Studio</h1>
              <p className="text-[11px] text-slate-500" data-testid="project-label">
                {state.projectName}
                {state.dirty && <span title="Unsaved changes"> •</span>}
                <span className="ml-2" data-testid="autosave-status">
                  {autosave ? ('error' in autosave ? <span className="text-amber-700">backup failed</span> : `backed up ${new Date(autosave.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`) : ''}
                </span>
              </p>
            </div>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <button type="button" onClick={onExportStl} disabled={blocking || exporting} title={exportTitle} data-testid="export-stl" className={`${btn.base} ${btn.primary}`}>
              {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Generate STL
            </button>
            <button type="button" onClick={() => setDialog('exportAll')} data-testid="export-zip" title="Generate several cards and download them as a ZIP of STL files" className={`${btn.base} ${btn.primary} !bg-green-800 hover:!bg-green-900`}>
              <Package className="h-4 w-4" /> Export all (ZIP)
            </button>
          </div>
        </div>
        <div className="flex items-center gap-1.5 overflow-x-auto border-t border-slate-100 bg-slate-50 px-4 py-1.5" role="toolbar" aria-label="Project actions">
          <button type="button" onClick={onNewCard} className={tbtn} data-testid="new-card"><FilePlus2 className="h-3.5 w-3.5" /> New card</button>
          <button type="button" onClick={onDuplicate} className={tbtn} data-testid="duplicate-card"><Copy className="h-3.5 w-3.5" /> Duplicate card</button>
          <button type="button" onClick={onGenerateAz} className={tbtn} data-testid="generate-az"><Sparkles className="h-3.5 w-3.5" /> Generate A–Z</button>
          <button type="button" onClick={() => setDialog('numbers')} className={tbtn} data-testid="generate-numbers"><Hash className="h-3.5 w-3.5" /> Generate numbers</button>
          <button type="button" onClick={() => setDialog('apply')} className={tbtn} data-testid="apply-settings"><Settings2 className="h-3.5 w-3.5" /> Apply settings to cards…</button>
          <span className="mx-1 h-5 w-px bg-slate-300" aria-hidden />
          <button type="button" onClick={onSaveClick} className={tbtn} data-testid="save-project"><Save className="h-3.5 w-3.5" /> Save</button>
          <button type="button" onClick={() => setDialog('load')} className={tbtn} data-testid="load-project"><FolderOpen className="h-3.5 w-3.5" /> Load</button>
          <button type="button" onClick={onExportProject} className={tbtn} data-testid="export-project"><Download className="h-3.5 w-3.5" /> Export project</button>
          <button type="button" onClick={() => importRef.current?.click()} className={tbtn} data-testid="import-project"><Upload className="h-3.5 w-3.5" /> Import project</button>
          <button type="button" onClick={onNewProject} className={tbtn} data-testid="new-project"><FilePlus className="h-3.5 w-3.5" /> New project</button>
          <input ref={importRef} type="file" accept=".json,application/json" className="sr-only" data-testid="import-input" aria-label="Import a project file" onChange={(e) => void onImportFile(e.target.files?.[0])} />
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <section className="order-1 flex flex-col lg:order-2 lg:min-h-0 lg:flex-1" aria-label="3D preview">
          {/* explicit height on small screens: percentage heights inside need a definite parent */}
          <div className="h-[58dvh] min-h-[22rem] lg:h-auto lg:min-h-0 lg:flex-1">
            <FlashcardViewer3D
              model={displayModel}
              building={building}
              error={m.status === 'error' ? m.error : null}
              stale={stale}
              cardKey={card.id}
              placeMode={placeOnViewer}
              holeCenter={{ x: card.holeSettings.x, y: card.holeSettings.y, diameter: card.holeSettings.diameter, enabled: card.holeSettings.enabled }}
              appearance={card.appearance}
              onPlaceHole={placeHole}
            />
          </div>
          <StatusPanel model={displayModel} building={building} error={m.status === 'error' ? m.error : null} lastExport={lastExport} cardId={card.id} />
        </section>

        <aside className="order-2 w-full shrink-0 border-t border-slate-200 bg-white lg:order-1 lg:w-[400px] lg:overflow-y-auto lg:border-r lg:border-t-0 xl:w-[430px]" aria-label="Card designer">
          <CardStrip cards={state.cards} selectedId={card.id} onSelect={(id) => dispatch({ type: 'select', id })} onDelete={() => void onDeleteCard()} />
          <CardControls
            card={card}
            model={displayModel}
            building={building}
            onPatch={patchCard}
            onSetImage={setImage}
            onError={(msg) => toast.push('error', msg)}
            placeOnViewer={placeOnViewer}
            onTogglePlaceOnViewer={setPlaceOnViewer}
          />
        </aside>
      </main>

      {dialog === 'save' && <SaveProjectDialog initialName={state.projectName === 'Untitled project' ? '' : state.projectName} onSave={saveProject} onCancel={() => setDialog(null)} />}
      {dialog === 'load' && <LoadProjectDialog onLoad={loadSaved} onClose={() => setDialog(null)} onError={(msg) => toast.push('error', msg)} />}
      {dialog === 'exportAll' && <ExportAllDialog cards={state.cards} selectedId={card.id} onClose={() => setDialog(null)} onResult={(kind, msg) => toast.push(kind, msg)} />}
      {dialog === 'numbers' && <NumberRangeDialog onGenerate={onGenerateNumbers} onClose={() => setDialog(null)} />}
      {dialog === 'apply' && (
        <ApplySettingsDialog
          cards={state.cards}
          source={card}
          onClose={() => setDialog(null)}
          onApply={(groups: ApplyGroup[], toIds: string[]) => {
            dispatch({ type: 'applySettings', fromId: card.id, toIds, groups });
            setDialog(null);
            toast.push('success', `Settings applied to ${toIds.length} card${toIds.length === 1 ? '' : 's'}. Their letters, words and illustrations were not changed.`);
          }}
        />
      )}
      {confirmState && (
        <ConfirmDialog
          {...confirmState.req}
          onConfirm={() => {
            confirmState.resolve(true);
            setConfirmState(null);
          }}
          onCancel={() => {
            confirmState.resolve(false);
            setConfirmState(null);
          }}
        />
      )}
    </div>
  );
}

export default function Page() {
  return (
    <ToastProvider>
      <App />
    </ToastProvider>
  );
}
