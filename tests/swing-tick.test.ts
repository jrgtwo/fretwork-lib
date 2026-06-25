import { describe, it, expect } from 'vitest';
import { applySwingToTick } from '../src/metronome/types';

const PPQ = 480;

describe('applySwingToTick', () => {
  it('is identity when subdivision does not support swing', () => {
    expect(applySwingToTick(240, 'off', 0.67, PPQ)).toBe(240);
    expect(applySwingToTick(240, 'triplets', 0.67, PPQ)).toBe(240);
    expect(applySwingToTick(240, 'sextuplets', 0.67, PPQ)).toBe(240);
  });

  it('is identity when swing is straight (0.5)', () => {
    expect(applySwingToTick(240, '8ths', 0.5, PPQ)).toBe(240);
    expect(applySwingToTick(120, '16ths', 0.5, PPQ)).toBe(120);
  });

  it('keeps the pair downbeat fixed under 8th swing', () => {
    // Tick 0 = pair start; tick 480 = next pair start.
    expect(applySwingToTick(0, '8ths', 0.67, PPQ)).toBeCloseTo(0);
    expect(applySwingToTick(480, '8ths', 0.67, PPQ)).toBeCloseTo(480);
    expect(applySwingToTick(960, '8ths', 0.67, PPQ)).toBeCloseTo(960);
  });

  it('pushes the off-beat 8th to swing × pairTicks', () => {
    // pairTicks = 480; off-beat 8th originally at 240.
    // At swing = 0.67: off-beat → 2*0.67*240 = 321.6.
    expect(applySwingToTick(240, '8ths', 0.67, PPQ)).toBeCloseTo(321.6);
    // At swing = 0.75 (hard shuffle): off-beat → 2*0.75*240 = 360.
    expect(applySwingToTick(240, '8ths', 0.75, PPQ)).toBeCloseTo(360);
  });

  it('warps positions between grid points proportionally', () => {
    // A tick at 1/4 of the way through the down half (positionInPair = 60,
    // ticksPerSub = 240) should map to 60 * 2 * 0.67 = 80.4.
    expect(applySwingToTick(60, '8ths', 0.67, PPQ)).toBeCloseTo(80.4);
    // A tick at the midpoint of the up half (positionInPair = 360, excess = 120)
    // should map to 2*0.67*240 + 120 * 2 * (1 - 0.67) = 321.6 + 79.2 = 400.8.
    expect(applySwingToTick(360, '8ths', 0.67, PPQ)).toBeCloseTo(400.8);
  });

  it('16ths swing pairs 16ths within each 8th boundary', () => {
    // 16ths: ticksPerSub = 120, pairTicks = 240. Off-beat 16th at 120 → 2*0.67*120 = 160.8.
    expect(applySwingToTick(120, '16ths', 0.67, PPQ)).toBeCloseTo(160.8);
    // Next pair starts at 240 — its downbeat stays.
    expect(applySwingToTick(240, '16ths', 0.67, PPQ)).toBeCloseTo(240);
    // Next off-beat at 360 → 240 + 2*0.67*120 = 240 + 160.8 = 400.8.
    expect(applySwingToTick(360, '16ths', 0.67, PPQ)).toBeCloseTo(400.8);
  });

  it('is continuous across the sub-tick boundary', () => {
    // Approaching the boundary from below and from above should give the same
    // swung tick (the boundary itself is the swung off-beat position).
    const justBelow = applySwingToTick(239.999, '8ths', 0.67, PPQ);
    const exactlyAt = applySwingToTick(240, '8ths', 0.67, PPQ);
    const justAbove = applySwingToTick(240.001, '8ths', 0.67, PPQ);
    expect(Math.abs(exactlyAt - justBelow)).toBeLessThan(0.01);
    expect(Math.abs(justAbove - exactlyAt)).toBeLessThan(0.01);
  });
});
