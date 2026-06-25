import { describe, it, expect } from 'vitest';
import {
  effectiveBpm,
  effectiveTimeSignature,
  isAutomated,
} from '../src/patterns/automation';
import type {
  PatternTimeSignature,
  TempoEvent,
  TimeSignatureEvent,
} from '../src/patterns/types';

const FALLBACK_TS: PatternTimeSignature = { numerator: 4, denominator: 4 };

describe('effectiveBpm', () => {
  it('returns the fallback when the track is empty', () => {
    expect(effectiveBpm([], 120, 1920)).toBe(120);
  });

  it('returns the active step value', () => {
    const track: TempoEvent[] = [
      { atTick: 0, bpm: 100, interpolation: 'step' },
      { atTick: 1920, bpm: 140, interpolation: 'step' },
    ];
    expect(effectiveBpm(track, 0, 0)).toBe(100);
    expect(effectiveBpm(track, 0, 1919)).toBe(100);
    expect(effectiveBpm(track, 0, 1920)).toBe(140);
    expect(effectiveBpm(track, 0, 9999)).toBe(140);
  });

  it('ramps linearly between events', () => {
    const track: TempoEvent[] = [
      { atTick: 0, bpm: 100, interpolation: 'step' },
      { atTick: 100, bpm: 200, interpolation: 'linear' },
    ];
    expect(effectiveBpm(track, 0, 0)).toBe(100);
    expect(effectiveBpm(track, 0, 50)).toBeCloseTo(150);
    expect(effectiveBpm(track, 0, 100)).toBe(200);
  });

  it('clamps a query before the first event to the first event bpm', () => {
    const track: TempoEvent[] = [{ atTick: 500, bpm: 90, interpolation: 'step' }];
    expect(effectiveBpm(track, 0, 0)).toBe(90);
  });
});

describe('effectiveTimeSignature', () => {
  it('returns the fallback when the track is empty', () => {
    expect(effectiveTimeSignature([], FALLBACK_TS, 0)).toEqual(FALLBACK_TS);
  });

  it('returns the active TS at the query tick', () => {
    const track: TimeSignatureEvent[] = [
      { atTick: 0, numerator: 4, denominator: 4 },
      { atTick: 3840, numerator: 6, denominator: 8 },
    ];
    expect(effectiveTimeSignature(track, FALLBACK_TS, 0)).toEqual({ numerator: 4, denominator: 4 });
    expect(effectiveTimeSignature(track, FALLBACK_TS, 3839)).toEqual({ numerator: 4, denominator: 4 });
    expect(effectiveTimeSignature(track, FALLBACK_TS, 3840)).toEqual({ numerator: 6, denominator: 8 });
  });

  it('clamps a query before the first event to the first event TS', () => {
    const track: TimeSignatureEvent[] = [{ atTick: 1000, numerator: 3, denominator: 4 }];
    expect(effectiveTimeSignature(track, FALLBACK_TS, 0)).toEqual({ numerator: 3, denominator: 4 });
  });
});

describe('isAutomated', () => {
  it('false on empty + length-1 tracks (the BPM stepper / TS picker stays editable)', () => {
    expect(isAutomated([])).toBe(false);
    expect(isAutomated([{ atTick: 0 }])).toBe(false);
  });
  it('true on length-2+ tracks', () => {
    expect(isAutomated([{ atTick: 0 }, { atTick: 100 }])).toBe(true);
  });
});
