import type { FlashcardConfig } from '../../types/flashcard';
import type { FlashcardModel } from '../geometry/model';
import { analyzeStl, mergeParts, positionsToStl, stlFileName, type StlReport } from './stl';

export class ExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExportError';
  }
}

export interface ExportedStl {
  fileName: string;
  buffer: ArrayBuffer;
  report: StlReport;
  expected: { width: number; height: number; zMax: number };
  /** measured bounding box of the exported bytes matches the configured size */
  dimensionsMatch: boolean;
  /** model warnings that existed when the file was written */
  warnings: string[];
}

/**
 * Turns a finished model into STL bytes and re-reads those bytes to verify them.
 * The report therefore describes the file the user actually gets.
 */
export function createStl(card: FlashcardConfig, model: FlashcardModel): ExportedStl {
  if (model.blocking) {
    const first = model.issues.find((i) => i.severity === 'error');
    throw new ExportError(first ? first.message : 'This card has errors and cannot be exported.');
  }
  const positions = mergeParts(model.parts);
  if (positions.length === 0) throw new ExportError('The model is empty, so there is nothing to export.');

  const buffer = positionsToStl(positions);
  const report = analyzeStl(buffer);
  const v = report.validation;
  if (v.status === 'error') {
    throw new ExportError(`The generated mesh failed its checks: ${v.messages.join(' ')}`);
  }
  if (v.triangles !== model.validation.triangles) {
    throw new ExportError('Internal consistency check failed: the exported file does not match the preview geometry.');
  }
  const tol = 0.02;
  const e = model.expected;
  const dimensionsMatch =
    Math.abs(v.size[0] - e.width) <= tol && Math.abs(v.size[1] - e.height) <= tol && Math.abs(v.size[2] - e.maxZ) <= tol;

  return {
    fileName: stlFileName(card.alphabet, card.word),
    buffer,
    report,
    expected: { width: e.width, height: e.height, zMax: e.maxZ },
    dimensionsMatch,
    warnings: model.issues.filter((i) => i.severity === 'warning').map((i) => i.message),
  };
}
