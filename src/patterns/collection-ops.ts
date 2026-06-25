/**
 * Pure operations on Collection objects. Like pattern-ops, these never mutate.
 *
 * Includes a depth helper for enforcing MAX_FOLDER_DEPTH at the app layer; the
 * DB doesn't constrain depth (it's a soft cap, easy to raise later by changing
 * this constant).
 */
import type { Collection } from './types';
import { generateUuid } from './ids';

/** Soft cap on folder nesting depth, enforced in `createCollection`. Raising
 *  this is a code-only change — no DB migration needed. */
export const MAX_FOLDER_DEPTH = 8;

export function createEmptyCollection(
  name = 'Untitled folder',
  parentId: string | null = null,
): Collection {
  const now = Date.now();
  return {
    id: generateUuid(),
    name,
    parentId,
    visibility: 'private',
    publishedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function setCollectionName(collection: Collection, name: string): Collection {
  return { ...collection, name, updatedAt: Date.now() };
}

export function setCollectionParent(collection: Collection, parentId: string | null): Collection {
  return { ...collection, parentId, updatedAt: Date.now() };
}

export interface CollectionMetadataPatch {
  visibility?: string;
}

/**
 * Apply a metadata patch with the same `publishedAt` lifecycle as patterns:
 *   - private → non-private  ⇒ set publishedAt = now
 *   - non-private → private  ⇒ clear publishedAt
 *   - any other transition   ⇒ leave publishedAt untouched
 */
export function applyCollectionMetadata(
  collection: Collection,
  patch: CollectionMetadataPatch,
): Collection {
  const now = Date.now();
  const next: Collection = { ...collection, updatedAt: now };
  if (patch.visibility !== undefined && patch.visibility !== collection.visibility) {
    next.visibility = patch.visibility;
    if (collection.visibility === 'private' && patch.visibility !== 'private') {
      next.publishedAt = now;
    } else if (patch.visibility === 'private') {
      next.publishedAt = null;
    }
  }
  return next;
}

/**
 * Depth of a folder relative to the root. Root-level folders are depth 0; their
 * direct children are depth 1; etc. Walks the parent chain via the supplied
 * collections list.
 *
 * A self-referential cycle (data corruption) is broken by a hard 100-step limit;
 * the function returns Infinity in that case so the caller refuses any operation.
 */
export function getCollectionDepth(
  collections: readonly Collection[],
  collectionId: string | null,
): number {
  if (collectionId === null) return -1; // not a real folder; "root" has no depth
  const byId = new Map(collections.map((c) => [c.id, c]));
  const seen = new Set<string>();
  let current: Collection | undefined = byId.get(collectionId);
  let depth = 0;
  while (current) {
    if (seen.has(current.id)) return Infinity; // cycle
    seen.add(current.id);
    if (current.parentId === null) return depth;
    depth++;
    if (depth > 100) return Infinity; // pathological
    current = byId.get(current.parentId);
  }
  // current became undefined (parent chain points at a missing id) — treat as root.
  return depth;
}

/**
 * True if `candidateParentId` is an ancestor of `collectionId` (or equals it).
 * Used to refuse cycle-creating "move into descendant" operations.
 */
export function wouldCreateCycle(
  collections: readonly Collection[],
  collectionId: string,
  candidateParentId: string | null,
): boolean {
  if (candidateParentId === null) return false;
  if (candidateParentId === collectionId) return true;
  const byId = new Map(collections.map((c) => [c.id, c]));
  const seen = new Set<string>();
  let current = byId.get(candidateParentId);
  while (current) {
    if (current.id === collectionId) return true;
    if (seen.has(current.id)) return false; // cycle in existing data; not our fault
    seen.add(current.id);
    if (current.parentId === null) return false;
    current = byId.get(current.parentId);
  }
  return false;
}
