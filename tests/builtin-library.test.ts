import { describe, it, expect } from 'vitest';
import {
  BUILTIN_PATTERNS,
  BUILTIN_COMPOSITIONS,
  BUILTIN_COLLECTIONS,
  BUILTIN_COLLECTION_ID,
  isBuiltinId,
} from '../src/patterns';

describe('built-in library', () => {
  const collectionIds = new Set(BUILTIN_COLLECTIONS.map((c) => c.id));
  const byName = (name: string) => BUILTIN_PATTERNS.find((p) => p.name === name);

  it('ships theory + original patterns, each with events and a built-in folder', () => {
    expect(BUILTIN_PATTERNS.length).toBeGreaterThanOrEqual(40);
    for (const p of BUILTIN_PATTERNS) {
      expect(isBuiltinId(p.id)).toBe(true);
      expect(p.events.length).toBeGreaterThan(0); // generators actually produced notes
      expect(p.durationTicks).toBeGreaterThan(0);
      // Each pattern is filed under a built-in folder that actually exists.
      expect(p.collectionId).not.toBeNull();
      expect(isBuiltinId(p.collectionId!)).toBe(true);
      expect(collectionIds.has(p.collectionId!)).toBe(true);
    }
  });

  it('forms a valid built-in folder tree (single root, resolvable parents)', () => {
    const roots = BUILTIN_COLLECTIONS.filter((c) => c.parentId === null);
    expect(roots).toHaveLength(1);
    expect(roots[0].id).toBe(BUILTIN_COLLECTION_ID);
    for (const c of BUILTIN_COLLECTIONS) {
      expect(isBuiltinId(c.id)).toBe(true);
      if (c.parentId !== null) expect(collectionIds.has(c.parentId)).toBe(true);
    }
  });

  it('files chords into per-quality folders', () => {
    expect(byName('C')?.collectionId).toBe('builtin-col-chords-major');
    expect(byName('Am')?.collectionId).toBe('builtin-col-chords-minor');
    expect(byName('G7')?.collectionId).toBe('builtin-col-chords-dom7');
    expect(byName('Cmaj7')?.collectionId).toBe('builtin-col-chords-maj7');
    expect(byName('Am7')?.collectionId).toBe('builtin-col-chords-min7');
  });

  it('covers the chord quality vocabulary (major/minor/dom7/maj7/min7) + scales + arps', () => {
    const names = BUILTIN_PATTERNS.map((p) => p.name);
    expect(names).toContain('C'); // major
    expect(names).toContain('Am'); // minor
    expect(names).toContain('G7'); // dominant 7
    expect(names).toContain('Cmaj7'); // major 7
    expect(names).toContain('Am7'); // minor 7
    expect(names.some((n) => n.includes('Major (Ionian)'))).toBe(true); // scales
    expect(names.some((n) => n.includes('Pentatonic'))).toBe(true);
    expect(names.some((n) => n.includes('arpeggio'))).toBe(true); // arps
  });

  it('has unique ids across all built-in patterns', () => {
    const ids = BUILTIN_PATTERNS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('ships at least one demo composition with placements, filed in a built-in folder', () => {
    expect(BUILTIN_COMPOSITIONS.length).toBeGreaterThanOrEqual(1);
    const comp = BUILTIN_COMPOSITIONS[0];
    expect(isBuiltinId(comp.id)).toBe(true);
    expect(collectionIds.has(comp.collectionId!)).toBe(true);
    const placements = comp.tracks.flatMap((t) => t.placements);
    expect(placements.length).toBeGreaterThan(0);
  });

  it('isBuiltinId matches the builtin- prefix and the root folder id', () => {
    expect(isBuiltinId('builtin-pat-x')).toBe(true);
    expect(isBuiltinId(BUILTIN_COLLECTION_ID)).toBe(true); // root folder ('builtin')
    expect(isBuiltinId('some-uuid')).toBe(false);
    expect(isBuiltinId(null)).toBe(false);
  });
});
