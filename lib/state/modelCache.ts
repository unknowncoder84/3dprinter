import { browserDeps } from '../geometry/browserDeps';
import { buildFlashcardModel, type FlashcardModel } from '../geometry/model';
import type { FlashcardConfig } from '../../types/flashcard';

/**
 * Finished models, keyed by the (immutable) card object. Editing a card creates a new
 * object, so a hit is always exactly the geometry for that configuration. The preview, STL
 * export and ZIP export all go through here, which keeps them on the same geometry and
 * avoids rebuilding when switching between cards.
 */
const cache = new WeakMap<FlashcardConfig, FlashcardModel>();

export function peekModel(card: FlashcardConfig): FlashcardModel | undefined {
  return cache.get(card);
}

export async function getModel(card: FlashcardConfig, isCancelled?: () => boolean): Promise<FlashcardModel> {
  const hit = cache.get(card);
  if (hit) return hit;
  const model = await buildFlashcardModel(card, browserDeps, { isCancelled });
  cache.set(card, model);
  return model;
}
