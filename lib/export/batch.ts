import JSZip from 'jszip';
import type { FlashcardConfig } from '../../types/flashcard';
import { getModel } from '../state/modelCache';
import { createStl } from './exportStl';

export type ItemStatus = 'pending' | 'working' | 'done' | 'failed' | 'skipped';

export interface BatchItemResult {
  id: string;
  label: string;
  fileName: string;
  status: ItemStatus;
  triangles?: number;
  bytes?: number;
  message?: string;
}

export interface BatchProgress {
  total: number;
  completed: number;
  failed: number;
  current: string | null;
  phase: 'generating' | 'zipping' | 'finished' | 'cancelled';
  items: BatchItemResult[];
}

export interface BatchOutcome {
  zip: Blob | null;
  progress: BatchProgress;
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

const labelOf = (c: FlashcardConfig) => `${c.alphabet.trim() || '?'} – ${c.word.trim() || '(no word)'}`;

/**
 * Generates every selected card (real geometry, real STL bytes), verifies each file by
 * re-reading it, and packs the successful ones into a ZIP. A failing card is reported and
 * skipped; nothing is written for it, and the remaining cards still run.
 */
export async function exportCardsToZip(
  cards: FlashcardConfig[],
  onProgress: (p: BatchProgress) => void,
  shouldCancel: () => boolean = () => false,
): Promise<BatchOutcome> {
  const used = new Map<string, number>();
  const items: BatchItemResult[] = cards.map((c) => ({ id: c.id, label: labelOf(c), fileName: '', status: 'pending' }));
  const progress: BatchProgress = { total: cards.length, completed: 0, failed: 0, current: null, phase: 'generating', items };
  const emit = () => onProgress({ ...progress, items: items.map((i) => ({ ...i })) });
  emit();

  const zip = new JSZip();
  for (let i = 0; i < cards.length; i++) {
    if (shouldCancel()) {
      progress.phase = 'cancelled';
      progress.current = null;
      for (const it of items) if (it.status === 'pending') it.status = 'skipped';
      emit();
      break;
    }
    const card = cards[i];
    const item = items[i];
    item.status = 'working';
    progress.current = item.label;
    emit();
    await tick();
    try {
      const model = await getModel(card);
      const stl = createStl(card, model);
      // unique file name inside the archive
      const base = stl.fileName.replace(/\.stl$/i, '');
      const n = (used.get(base) ?? 0) + 1;
      used.set(base, n);
      const fileName = n === 1 ? stl.fileName : `${base}_${n}.stl`;
      zip.file(fileName, stl.buffer, { binary: true });
      item.fileName = fileName;
      item.status = 'done';
      item.triangles = stl.report.validation.triangles;
      item.bytes = stl.report.fileBytes;
      progress.completed++;
    } catch (e) {
      item.status = 'failed';
      item.message = e instanceof Error ? e.message : String(e);
      progress.failed++;
    }
    emit();
  }

  if (progress.phase === 'cancelled' && progress.completed === 0) {
    progress.current = null;
    emit();
    return { zip: null, progress };
  }

  let blob: Blob | null = null;
  if (progress.completed > 0) {
    progress.phase = 'zipping';
    progress.current = 'Packing ZIP archive';
    emit();
    await tick();
    try {
      blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    } catch (e) {
      progress.phase = 'finished';
      progress.current = null;
      const message = `The ZIP archive could not be created: ${e instanceof Error ? e.message : String(e)}`;
      for (const it of items) if (it.status === 'done') {
        it.status = 'failed';
        it.message = message;
      }
      progress.failed += progress.completed;
      progress.completed = 0;
      emit();
      return { zip: null, progress };
    }
  }
  if (progress.phase !== 'cancelled') progress.phase = 'finished';
  progress.current = null;
  emit();
  return { zip: blob, progress };
}
