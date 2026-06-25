import { describe, it, expect } from 'vitest';
import {
  createEmptyComposition,
  createEmptyPattern,
  resolveEffectivePlayback,
  setCompositionGroove,
  setCompositionGrooveMode,
  setCompositionBpm,
  setCompositionTempoMode,
  setPatternGroove,
  setPatternSuggestedBpm,
} from '../src/patterns';

function makePlacement(p: ReturnType<typeof createEmptyPattern>) {
  return {
    id: 'pl-1',
    patternSnapshot: p,
    startTick: 0,
    repeat: 1,
    transposeSemitones: 0,
    lengthTicks: null,
  };
}

describe('resolveEffectivePlayback', () => {
  describe('global tempo mode', () => {
    it('returns the composition bpm regardless of the source pattern', () => {
      const comp = setCompositionBpm(createEmptyComposition(), 100);
      const src = setPatternSuggestedBpm(createEmptyPattern(), 160);
      const { bpm } = resolveEffectivePlayback(comp, makePlacement(src));
      expect(bpm).toBe(100);
    });
  });

  describe('inherit tempo mode', () => {
    it('returns the source pattern bpm when present', () => {
      const comp = setCompositionTempoMode(
        setCompositionBpm(createEmptyComposition(), 100),
        'inherit',
      );
      const src = setPatternSuggestedBpm(createEmptyPattern(), 160);
      const { bpm } = resolveEffectivePlayback(comp, makePlacement(src));
      expect(bpm).toBe(160);
    });

    it('falls back to composition bpm when source has null suggestedBpm', () => {
      const comp = setCompositionTempoMode(
        setCompositionBpm(createEmptyComposition(), 100),
        'inherit',
      );
      const src = createEmptyPattern();
      const { bpm } = resolveEffectivePlayback(comp, makePlacement(src));
      expect(bpm).toBe(100);
    });
  });

  describe('global groove mode', () => {
    it('returns the composition groove regardless of source', () => {
      const comp = setCompositionGroove(createEmptyComposition(), {
        swing: 0.67,
        appliedTo: 'eighths',
      });
      const src = setPatternGroove(createEmptyPattern(), {
        swing: 0.75,
        appliedTo: 'sixteenths',
      });
      const { groove } = resolveEffectivePlayback(comp, makePlacement(src));
      expect(groove).toEqual({ swing: 0.67, appliedTo: 'eighths' });
    });
  });

  describe('inherit groove mode', () => {
    it("returns the source groove when present", () => {
      const comp = setCompositionGrooveMode(createEmptyComposition(), 'inherit');
      const src = setPatternGroove(createEmptyPattern(), {
        swing: 0.75,
        appliedTo: 'sixteenths',
      });
      const { groove } = resolveEffectivePlayback(comp, makePlacement(src));
      expect(groove).toEqual({ swing: 0.75, appliedTo: 'sixteenths' });
    });

    it('falls back to composition groove when source has null groove', () => {
      const comp = setCompositionGrooveMode(
        setCompositionGroove(createEmptyComposition(), { swing: 0.67, appliedTo: 'eighths' }),
        'inherit',
      );
      const src = createEmptyPattern();
      const { groove } = resolveEffectivePlayback(comp, makePlacement(src));
      expect(groove).toEqual({ swing: 0.67, appliedTo: 'eighths' });
    });

    it('returns null when both source and composition groove are null', () => {
      const comp = setCompositionGrooveMode(createEmptyComposition(), 'inherit');
      const src = createEmptyPattern();
      const { groove } = resolveEffectivePlayback(comp, makePlacement(src));
      expect(groove).toBeNull();
    });
  });
});
