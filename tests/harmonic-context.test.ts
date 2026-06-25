import { describe, it, expect } from 'vitest';
import {
  harmonicContextAt,
  nextHarmonicContext,
  type HarmonicContextBlock,
} from '../src/lookahead/harmonic-context';

const blocks: HarmonicContextBlock[] = [
  { id: 'a', startTick: 0, endTick: 3840, chord: 'C', scale: { root: 'C', type: 'major' } },
  { id: 'b', startTick: 3840, endTick: 5760, chord: 'Am', scale: null },
  { id: 'c', startTick: 5760, endTick: 7680, chord: 'G', scale: null },
];

describe('harmonicContextAt', () => {
  it('returns the block covering a tick', () => {
    expect(harmonicContextAt(blocks, 0)?.id).toBe('a');
    expect(harmonicContextAt(blocks, 4000)?.id).toBe('b');
    expect(harmonicContextAt(blocks, 6000)?.id).toBe('c');
  });

  it('returns null outside any block', () => {
    expect(harmonicContextAt(blocks, 9000)).toBeNull();
    expect(harmonicContextAt([], 0)).toBeNull();
  });

  it('is end-exclusive at boundaries', () => {
    // tick 3840 belongs to b (its start), not a (its end)
    expect(harmonicContextAt(blocks, 3840)?.id).toBe('b');
  });
});

describe('nextHarmonicContext', () => {
  it('returns the block after the current tick', () => {
    expect(nextHarmonicContext(blocks, 0)?.id).toBe('b');
    expect(nextHarmonicContext(blocks, 4000)?.id).toBe('c');
  });

  it('returns null when nothing follows', () => {
    expect(nextHarmonicContext(blocks, 6000)).toBeNull();
  });
});
