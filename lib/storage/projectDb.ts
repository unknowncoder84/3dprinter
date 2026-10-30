/**
 * Local persistence in IndexedDB (no server, no account).
 *
 * Browser storage is limited, so every write is wrapped: a full disk/quota becomes a clear
 * StorageError that tells the user what to do instead of silently losing work.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { ProjectFile } from './projectFile';

export const AUTOSAVE_ID = '__autosave__';

export interface ProjectRecord {
  id: string;
  name: string;
  updatedAt: number;
  cardCount: number;
  approxBytes: number;
  project: ProjectFile;
}

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: number;
  cardCount: number;
  approxBytes: number;
  isAutosave: boolean;
}

interface Schema extends DBSchema {
  /** store used by the first prototype (read-only recovery) */
  projects: { key: string; value: unknown };
  projects_v2: { key: string; value: ProjectRecord };
}

export class StorageError extends Error {
  constructor(
    message: string,
    public readonly quota = false,
  ) {
    super(message);
    this.name = 'StorageError';
  }
}

let dbPromise: Promise<IDBPDatabase<Schema>> | null = null;

function getDb(): Promise<IDBPDatabase<Schema>> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new StorageError('This browser does not provide IndexedDB (private mode?), so projects cannot be stored locally. Use Export Project to save a file instead.'));
  }
  if (!dbPromise) {
    dbPromise = openDB<Schema>('3d-flashcard-studio', 2, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('projects_v2')) db.createObjectStore('projects_v2', { keyPath: 'id' });
      },
    }).catch((e) => {
      dbPromise = null;
      throw new StorageError(`Local storage could not be opened: ${e instanceof Error ? e.message : String(e)}`);
    });
  }
  return dbPromise;
}

function wrap(e: unknown): StorageError {
  if (e instanceof StorageError) return e;
  const name = (e as { name?: string })?.name;
  if (name === 'QuotaExceededError') {
    return new StorageError('Browser storage is full. Delete saved projects you no longer need, remove large images, or use Export Project to keep a copy as a file.', true);
  }
  return new StorageError(`Local storage failed: ${e instanceof Error ? e.message : String(e)}`);
}

const approxSize = (p: ProjectFile): number => {
  let n = 2000;
  for (const c of p.cards) n += 1500 + (c.image ? c.image.dataUrl.length : 0);
  return n;
};

export async function putProject(id: string, project: ProjectFile): Promise<void> {
  try {
    const db = await getDb();
    const record: ProjectRecord = {
      id,
      name: project.name,
      updatedAt: Date.now(),
      cardCount: project.cards.length,
      approxBytes: approxSize(project),
      project,
    };
    await db.put('projects_v2', record);
  } catch (e) {
    throw wrap(e);
  }
}

export async function getProject(id: string): Promise<ProjectRecord | null> {
  try {
    const db = await getDb();
    return (await db.get('projects_v2', id)) ?? null;
  } catch (e) {
    throw wrap(e);
  }
}

export async function listProjects(): Promise<ProjectSummary[]> {
  try {
    const db = await getDb();
    const all = await db.getAll('projects_v2');
    return all
      .map((r) => ({
        id: r.id,
        name: r.id === AUTOSAVE_ID ? 'Automatic backup (last session)' : r.name,
        updatedAt: r.updatedAt,
        cardCount: r.cardCount,
        approxBytes: r.approxBytes,
        isAutosave: r.id === AUTOSAVE_ID,
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch (e) {
    throw wrap(e);
  }
}

export async function deleteProject(id: string): Promise<void> {
  try {
    const db = await getDb();
    await db.delete('projects_v2', id);
  } catch (e) {
    throw wrap(e);
  }
}

/** The project saved by the first prototype under key "current", if any. */
export async function getLegacyProject(): Promise<unknown | null> {
  try {
    const db = await getDb();
    return (await db.get('projects', 'current')) ?? null;
  } catch {
    return null;
  }
}

export async function estimateStorage(): Promise<{ usage: number; quota: number } | null> {
  try {
    if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
      const e = await navigator.storage.estimate();
      return { usage: e.usage ?? 0, quota: e.quota ?? 0 };
    }
  } catch {
    /* ignore */
  }
  return null;
}
