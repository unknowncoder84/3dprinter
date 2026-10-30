'use client';

import { useEffect, useRef, useState } from 'react';
import type { FlashcardModel } from '../geometry/model';
import type { FlashcardConfig } from '../../types/flashcard';
import { getModel, peekModel } from './modelCache';

export interface ModelState {
  /** Last successfully built model for the selected card (may be one edit behind while building). */
  model: FlashcardModel | null;
  /** Card the `model` was built for. */
  modelCardId: string | null;
  status: 'building' | 'ready' | 'error';
  error: string | null;
  /** The card object the current status refers to. */
  forCard: FlashcardConfig | null;
}

const DEBOUNCE_MS = 140;

/**
 * Builds the geometry for the selected card whenever its configuration changes.
 * - edits are debounced so typing does not rebuild on every keystroke
 * - results for an older configuration are discarded (no stale overwrite)
 * - on failure the previous model stays visible, flagged as out of date, with the error
 */
export function useFlashcardModel(card: FlashcardConfig | undefined): ModelState {
  const [state, setState] = useState<ModelState>({ model: null, modelCardId: null, status: 'building', error: null, forCard: null });
  const lastBuilt = useRef<FlashcardConfig | null>(null);

  useEffect(() => {
    if (!card) return;
    let cancelled = false;
    const cached = peekModel(card);
    if (cached) {
      lastBuilt.current = card;
      setState({ model: cached, modelCardId: card.id, status: 'ready', error: null, forCard: card });
      return;
    }
    setState((s) => ({ ...s, status: 'building', error: null, forCard: card }));
    const sameCard = lastBuilt.current?.id === card.id;
    const timer = setTimeout(
      () => {
        getModel(card, () => cancelled)
          .then((model) => {
            if (cancelled) return;
            lastBuilt.current = card;
            setState({ model, modelCardId: card.id, status: 'ready', error: null, forCard: card });
          })
          .catch((e: unknown) => {
            if (cancelled) return;
            const message = e instanceof Error ? e.message : String(e);
            if (message === 'cancelled') return;
            setState((s) => ({ ...s, status: 'error', error: message, forCard: card }));
          });
      },
      sameCard ? DEBOUNCE_MS : 0,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [card]);

  return state;
}
