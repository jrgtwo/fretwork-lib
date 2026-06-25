import { describe, it, expect } from 'vitest';
import { GROOVE_PRESETS, presetMatching, type GroovePresetId } from '../src/patterns';

describe('GROOVE_PRESETS', () => {
  it('includes Straight, Swing 8ths, Shuffle, 16th Swing', () => {
    const ids = GROOVE_PRESETS.map((p) => p.id);
    expect(ids).toContain('straight');
    expect(ids).toContain('swing-8ths');
    expect(ids).toContain('shuffle');
    expect(ids).toContain('16th-swing');
  });

  it("Straight is represented by groove=null", () => {
    const straight = GROOVE_PRESETS.find((p) => p.id === 'straight');
    expect(straight?.groove).toBeNull();
  });

  it('Swing 8ths uses appliedTo eighths', () => {
    const s = GROOVE_PRESETS.find((p) => p.id === 'swing-8ths');
    expect(s?.groove?.appliedTo).toBe('eighths');
  });
});

describe('presetMatching', () => {
  it("returns 'straight' when groove is null", () => {
    expect(presetMatching(null)).toBe('straight');
  });

  it('returns the preset id whose groove matches exactly', () => {
    const swing = GROOVE_PRESETS.find((p) => p.id === 'swing-8ths')!;
    expect(presetMatching(swing.groove)).toBe('swing-8ths');
  });

  it("returns 'custom' when no preset matches", () => {
    expect(presetMatching({ swing: 0.58, appliedTo: 'eighths' })).toBe('custom');
  });
});
