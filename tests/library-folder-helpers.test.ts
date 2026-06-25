import { describe, it, expect } from 'vitest';
import {
  buildBreadcrumb,
  subfoldersOf,
  itemsInFolder,
  countItemsInFolderTree,
} from '../../example/src/library/folder-helpers';
import type { Collection } from '@fretwork/lib';

const cols: Collection[] = [
  {
    id: 'a',
    name: 'A',
    parentId: null,
    visibility: 'private',
    publishedAt: null,
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'a1',
    name: 'A1',
    parentId: 'a',
    visibility: 'private',
    publishedAt: null,
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'b',
    name: 'B',
    parentId: null,
    visibility: 'private',
    publishedAt: null,
    createdAt: 0,
    updatedAt: 0,
  },
];

const items = [
  { id: 'p1', name: 'p1', collectionId: 'a' },
  { id: 'p2', name: 'p2', collectionId: 'a1' },
  { id: 'p3', name: 'p3', collectionId: null },
];

describe('folder-helpers', () => {
  it('buildBreadcrumb returns root → current', () => {
    const bc = buildBreadcrumb(new Map(cols.map((c) => [c.id, c])), 'a1');
    expect(bc.map((c) => c.id)).toEqual(['a', 'a1']);
  });

  it('subfoldersOf returns direct children sorted by name', () => {
    expect(subfoldersOf(cols, 'a').map((c) => c.id)).toEqual(['a1']);
    expect(subfoldersOf(cols, null).map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('itemsInFolder filters by collectionId', () => {
    expect(itemsInFolder(items, 'a').map((i) => i.id)).toEqual(['p1']);
    expect(itemsInFolder(items, null).map((i) => i.id)).toEqual(['p3']);
  });

  it('countItemsInFolderTree walks descendants', () => {
    expect(countItemsInFolderTree(cols, items, 'a')).toBe(2);
    expect(countItemsInFolderTree(cols, items, 'b')).toBe(0);
  });
});
