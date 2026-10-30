/**
 * Project file format (versioned JSON).
 *
 * {
 *   "format": "flashcard-studio-project",
 *   "version": 2,
 *   "name": "My alphabet set",
 *   "createdAt": "<ISO date>", "updatedAt": "<ISO date>",
 *   "units": "mm",
 *   "selectedId": "<card id>",
 *   "cards": [ <FlashcardConfig>, ... ]       // see types/flashcard.ts, images are data URLs
 * }
 *
 * Version 1 files (written by the first prototype, version "1.0", no "format" key) are
 * still accepted and converted. Unknown newer versions and damaged files are rejected with a
 * message instead of being half-loaded.
 */
import { PROJECT_FORMAT, PROJECT_VERSION, sanitizeCard, newId, type FlashcardConfig } from '../../types/flashcard';
import type { LoadedProject, ProjectState } from '../state/projectState';

export interface ProjectFile {
  format: typeof PROJECT_FORMAT;
  version: typeof PROJECT_VERSION;
  name: string;
  createdAt: string;
  updatedAt: string;
  units: 'mm';
  selectedId: string;
  cards: FlashcardConfig[];
}

export class ProjectFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectFileError';
  }
}

export const MAX_CARDS = 200;
export const MAX_PROJECT_FILE_BYTES = 250 * 1024 * 1024;

export function serializeProject(state: Pick<ProjectState, 'projectName' | 'cards' | 'selectedId'>, createdAt?: string): ProjectFile {
  const now = new Date().toISOString();
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    name: state.projectName,
    createdAt: createdAt ?? now,
    updatedAt: now,
    units: 'mm',
    selectedId: state.selectedId,
    cards: state.cards,
  };
}

export interface ParsedProject {
  project: LoadedProject;
  warnings: string[];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function parseProject(input: string | unknown): ParsedProject {
  let data: unknown = input;
  if (typeof input === 'string') {
    if (input.length > MAX_PROJECT_FILE_BYTES) throw new ProjectFileError('The project file is too large to open in the browser.');
    try {
      data = JSON.parse(input);
    } catch {
      throw new ProjectFileError('This file is not valid JSON, so it cannot be a project exported from Flashcard Studio.');
    }
  }
  if (!isObj(data)) throw new ProjectFileError('This file does not contain a project (expected a JSON object).');

  const warnings: string[] = [];
  const legacy = data.format === undefined && Array.isArray(data.cards);
  if (!legacy) {
    if (data.format !== PROJECT_FORMAT) {
      throw new ProjectFileError('This is not a Flashcard Studio project file (missing or unknown "format").');
    }
    const v = typeof data.version === 'number' ? data.version : NaN;
    if (!Number.isFinite(v) || v < 2) throw new ProjectFileError('The project file has an invalid version number.');
    if (v > PROJECT_VERSION) {
      throw new ProjectFileError(`This project was saved by a newer version of Flashcard Studio (file version ${v}, this app supports up to ${PROJECT_VERSION}). Update the app to open it.`);
    }
  } else {
    warnings.push('This file was created by an earlier version. It was converted; please check the card layouts.');
  }

  if (!Array.isArray(data.cards)) throw new ProjectFileError('The project file has no "cards" list.');
  if (data.cards.length === 0) throw new ProjectFileError('The project file contains no cards.');
  if (data.cards.length > MAX_CARDS) throw new ProjectFileError(`The project has ${data.cards.length} cards; the maximum is ${MAX_CARDS}.`);

  const seen = new Set<string>();
  let droppedImages = 0;
  const cards = data.cards.map((raw) => {
    let card = sanitizeCard(raw);
    if (isObj(raw) && raw.image && !card.image) droppedImages++;
    if (seen.has(card.id)) card = { ...card, id: newId() };
    seen.add(card.id);
    return card;
  });
  if (droppedImages) warnings.push(`${droppedImages} illustration(s) were damaged or in an unsupported format and were removed. Re-upload them.`);

  const name = typeof data.name === 'string' && data.name.trim() ? data.name.trim().slice(0, 80) : 'Imported project';
  return {
    project: { projectId: '', projectName: name, cards, selectedId: typeof data.selectedId === 'string' ? data.selectedId : undefined },
    warnings,
  };
}

export function projectFileName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `${slug || 'flashcards'}.flashcards.json`;
}
