'use client';

import { Trash2 } from 'lucide-react';
import type { FlashcardConfig } from '@/types/flashcard';

interface Props {
  cards: FlashcardConfig[];
  selectedId: string;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}

export function CardStrip({ cards, selectedId, onSelect, onDelete }: Props) {
  const withImage = cards.filter((c) => c.image).length;
  return (
    <div className="border-b border-slate-200 px-4 py-3" data-testid="card-strip">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900">
          Cards <span className="font-normal text-slate-500" data-testid="card-count">({cards.length})</span>
        </h2>
        <span className="text-xs text-slate-500" data-testid="image-count">{withImage}/{cards.length} with illustration</span>
      </div>
      <div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto pr-1" role="listbox" aria-label="Cards">
        {cards.map((c) => {
          const selected = c.id === selectedId;
          return (
            <button
              key={c.id}
              type="button"
              role="option"
              aria-selected={selected}
              data-testid="card-chip"
              data-card-id={c.id}
              data-selected={selected}
              onClick={() => onSelect(c.id)}
              title={`${c.alphabet || '—'} · ${c.word || '(no word)'}${c.image ? '' : ' · needs illustration'}`}
              className={`relative min-w-[2.75rem] rounded-lg border px-2 py-1 text-sm font-semibold ${selected ? 'border-green-600 bg-green-600 text-white' : 'border-slate-300 bg-white text-slate-800 hover:bg-slate-50'}`}
            >
              {c.alphabet.trim() || '—'}
              <span className={`absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border border-white ${c.image ? 'bg-green-400' : 'bg-amber-400'}`} aria-label={c.image ? 'has illustration' : 'needs illustration'} />
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
        <span>
          <span className="mr-1 inline-block h-2 w-2 rounded-full bg-amber-400" /> needs illustration
        </span>
        <button type="button" onClick={() => onDelete(selectedId)} data-testid="delete-card" className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-red-700 hover:bg-red-50">
          <Trash2 className="h-3.5 w-3.5" aria-hidden /> Delete card
        </button>
      </div>
    </div>
  );
}
