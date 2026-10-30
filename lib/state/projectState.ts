/**
 * Project state: the list of cards, which one is selected and whether there are unsaved
 * changes. A pure reducer so every card edit, duplicate, delete, A-Z generation and import
 * is deterministic and testable. Every card keeps its own complete configuration.
 */
import {
  DEFAULT_ALPHABET_DATA,
  createDefaultCard,
  createLetterCard,
  newId,
  presetPosition,
  sanitizeCard,
  LIMITS,
  type CardImage,
  type DeepPartial,
  type FlashcardConfig,
} from '../../types/flashcard';
import { clampHoleCenter, round2 } from '../geometry/hole';

export interface ProjectState {
  projectId: string;
  projectName: string;
  cards: FlashcardConfig[];
  selectedId: string;
  /** unsaved changes since the last explicit save / load / import */
  dirty: boolean;
  /** increments on every change, used to debounce autosave */
  revision: number;
}

export type ApplyGroup = 'dimensions' | 'text' | 'image' | 'hole' | 'geometry';

export interface LoadedProject {
  projectId: string;
  projectName: string;
  cards: FlashcardConfig[];
  selectedId?: string;
}

export type ProjectAction =
  | { type: 'select'; id: string }
  | { type: 'update'; id: string; patch: DeepPartial<FlashcardConfig> }
  | { type: 'setImage'; id: string; image: CardImage | null }
  | { type: 'add' }
  | { type: 'duplicate'; id: string }
  | { type: 'delete'; id: string }
  | { type: 'generateAz' }
  | { type: 'applySettings'; fromId: string; toIds: string[]; groups: ApplyGroup[] }
  | { type: 'replace'; project: LoadedProject }
  | { type: 'markSaved'; projectId: string; projectName: string }
  | { type: 'rename'; name: string };

export function createInitialState(): ProjectState {
  const card = createDefaultCard('Aa', 'ant');
  return { projectId: '', projectName: 'Untitled project', cards: [card], selectedId: card.id, dirty: false, revision: 0 };
}

// ---------------------------------------------------------------------------

const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function applyPatch<T>(target: T, patch: unknown): T {
  if (!isPlain(patch) || !isPlain(target)) return patch as T;
  const out: Record<string, unknown> = { ...target };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    const cur = out[k];
    out[k] = k === 'image' ? v : isPlain(v) && isPlain(cur) ? applyPatch(cur, v) : v;
  }
  return out as T;
}

/** Keeps a card internally consistent after any edit (corner radius, hole preset and position). */
export function normalizeCard(card: FlashcardConfig): FlashcardConfig {
  const d = card.dimensions;
  const cornerRadius = Math.max(0, Math.min(d.cornerRadius, Math.min(d.width, d.height) / 2));
  const dims = cornerRadius === d.cornerRadius ? d : { ...d, cornerRadius };
  const h = card.holeSettings;
  const diameter = Math.max(
    LIMITS.holeDiameter.min,
    Math.min(h.diameter, LIMITS.holeDiameter.max, Math.min(dims.width, dims.height) * 0.45),
  );
  let x = h.x;
  let y = h.y;
  if (h.preset !== 'custom') {
    const p = presetPosition(h.preset, dims, diameter);
    x = p.x;
    y = p.y;
  }
  if (h.enabled) {
    const c = clampHoleCenter(x, y, dims, diameter, card.geometrySettings.edgeClearance);
    x = c.x;
    y = c.y;
  } else {
    x = Math.max(0, Math.min(dims.width, x));
    y = Math.max(0, Math.min(dims.height, y));
  }
  x = round2(x);
  y = round2(y);
  if (dims === d && diameter === h.diameter && x === h.x && y === h.y) return card;
  return { ...card, dimensions: dims, holeSettings: { ...h, diameter, x, y } };
}

const firstLetter = (s: string): string => {
  const ch = Array.from(s.trim())[0];
  return ch ? ch.toUpperCase() : '';
};

export function missingLetters(cards: FlashcardConfig[]): string[] {
  const have = new Set(cards.map((c) => firstLetter(c.alphabet)));
  return DEFAULT_ALPHABET_DATA.map((e) => e.letter).filter((l) => !have.has(l));
}

export function cloneCard(card: FlashcardConfig): FlashcardConfig {
  return {
    ...card,
    id: newId(),
    image: card.image ? { ...card.image } : null, // same image id: identical pixels share cached results
    dimensions: { ...card.dimensions },
    textSettings: { ...card.textSettings },
    imageSettings: { ...card.imageSettings },
    holeSettings: { ...card.holeSettings },
    geometrySettings: { ...card.geometrySettings },
  };
}

function bump(state: ProjectState, patch: Partial<ProjectState>, dirty = true): ProjectState {
  return { ...state, ...patch, dirty: dirty ? true : state.dirty, revision: state.revision + 1 };
}

export function projectReducer(state: ProjectState, action: ProjectAction): ProjectState {
  switch (action.type) {
    case 'select': {
      if (!state.cards.some((c) => c.id === action.id) || action.id === state.selectedId) return state;
      return { ...state, selectedId: action.id, revision: state.revision + 1 };
    }

    case 'update': {
      let found = false;
      const cards = state.cards.map((c) => {
        if (c.id !== action.id) return c;
        found = true;
        return normalizeCard(applyPatch(c, action.patch));
      });
      return found ? bump(state, { cards }) : state;
    }

    case 'setImage': {
      const cards = state.cards.map((c) => (c.id === action.id ? { ...c, image: action.image } : c));
      return bump(state, { cards });
    }

    case 'add': {
      const template = state.cards.find((c) => c.id === state.selectedId);
      const letter = missingLetters(state.cards)[0];
      const card = letter ? createLetterCard(letter, template) : { ...createLetterCard('A', template), alphabet: '', word: '' };
      const idx = state.cards.findIndex((c) => c.id === state.selectedId);
      const cards = state.cards.slice();
      cards.splice(idx + 1, 0, normalizeCard(card));
      return bump(state, { cards, selectedId: card.id });
    }

    case 'duplicate': {
      const idx = state.cards.findIndex((c) => c.id === action.id);
      if (idx < 0) return state;
      const copy = cloneCard(state.cards[idx]);
      const cards = state.cards.slice();
      cards.splice(idx + 1, 0, copy);
      return bump(state, { cards, selectedId: copy.id });
    }

    case 'delete': {
      const idx = state.cards.findIndex((c) => c.id === action.id);
      if (idx < 0) return state;
      let cards = state.cards.filter((c) => c.id !== action.id);
      if (cards.length === 0) cards = [createDefaultCard('Aa', 'ant')];
      let selectedId = state.selectedId;
      if (selectedId === action.id || !cards.some((c) => c.id === selectedId)) {
        selectedId = cards[Math.min(idx, cards.length - 1)].id;
      }
      return bump(state, { cards, selectedId });
    }

    case 'generateAz': {
      const template = state.cards.find((c) => c.id === state.selectedId);
      const letters = missingLetters(state.cards);
      if (letters.length === 0) return state;
      const created = letters.map((l) => normalizeCard(createLetterCard(l, template)));
      const all = state.cards.concat(created);
      const key = (c: FlashcardConfig, i: number) => {
        const k = DEFAULT_ALPHABET_DATA.findIndex((e) => e.letter === firstLetter(c.alphabet));
        return k >= 0 ? k : 1000 + i;
      };
      const sorted = all
        .map((c, i) => ({ c, k: key(c, i) }))
        .sort((a, b) => a.k - b.k)
        .map((x) => x.c);
      return bump(state, { cards: sorted });
    }

    case 'applySettings': {
      const from = state.cards.find((c) => c.id === action.fromId);
      if (!from) return state;
      const targets = new Set(action.toIds);
      const cards = state.cards.map((c) => {
        if (!targets.has(c.id) || c.id === from.id) return c;
        let next = c;
        for (const g of action.groups) {
          if (g === 'dimensions') next = { ...next, dimensions: { ...from.dimensions } };
          if (g === 'text') next = { ...next, textSettings: { ...from.textSettings } };
          if (g === 'image') next = { ...next, imageSettings: { ...from.imageSettings } };
          if (g === 'hole') next = { ...next, holeSettings: { ...from.holeSettings } };
          if (g === 'geometry') next = { ...next, geometrySettings: { ...from.geometrySettings } };
        }
        return normalizeCard(next);
      });
      return bump(state, { cards });
    }

    case 'replace': {
      const p = action.project;
      const cards = p.cards.length ? p.cards : [createDefaultCard('Aa', 'ant')];
      const selectedId = cards.some((c) => c.id === p.selectedId) ? (p.selectedId as string) : cards[0].id;
      return { projectId: p.projectId, projectName: p.projectName, cards, selectedId, dirty: false, revision: state.revision + 1 };
    }

    case 'markSaved':
      return { ...state, projectId: action.projectId, projectName: action.projectName, dirty: false };

    case 'rename':
      return bump(state, { projectName: action.name.slice(0, 80) || 'Untitled project' });
  }
}

export { sanitizeCard };
