import { describe, it, expect, beforeEach } from 'vitest';
import {
  usePatternsStore,
  DEFAULT_PATTERNS_STATE,
  selectCompositionsUsingPattern,
} from '../src/patterns/store/usePatternsStore';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  usePatternsStore.setState({ ...DEFAULT_PATTERNS_STATE });
});

describe('selectCompositionsUsingPattern', () => {
  it('returns empty when no compositions reference the pattern', () => {
    const { createPattern } = usePatternsStore.getState();
    const p = createPattern('riff');
    const result = selectCompositionsUsingPattern(usePatternsStore.getState(), p);
    expect(result).toEqual([]);
  });

  it('returns compositions whose placements reference the pattern', () => {
    const { createPattern, createComposition, openCompositionForArranging, addPlacement } =
      usePatternsStore.getState();
    const p = createPattern('riff');
    const c1 = createComposition('Song A');
    const c2 = createComposition('Song B');
    // addPlacement targets the currently-editing composition, so open each in turn.
    openCompositionForArranging(c1);
    addPlacement(p);
    openCompositionForArranging(c2);
    addPlacement(p);
    const result = selectCompositionsUsingPattern(usePatternsStore.getState(), p);
    expect(result).toHaveLength(2);
    const names = result.map((c) => c.name).sort();
    expect(names).toEqual(['Song A', 'Song B']);
  });

  it('dedupes when the same pattern appears in multiple placements of one composition', () => {
    const { createPattern, createComposition, openCompositionForArranging, addPlacement } =
      usePatternsStore.getState();
    const p = createPattern('riff');
    const c = createComposition('Song');
    openCompositionForArranging(c);
    addPlacement(p);
    addPlacement(p);
    const result = selectCompositionsUsingPattern(usePatternsStore.getState(), p);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(c);
  });
});
