import { describe, it, expect } from 'vitest';
import { validateImportIR, LIMITS } from '../src/import/validator';
import { ImportValidationError } from '../src/import/errors';
import type { ImportIR } from '../src/import/types';

function baseIR(overrides: Partial<ImportIR> = {}): ImportIR {
  return {
    meta: { sourceFormat: 'guitar-pro' },
    ticksPerQuarter: 480,
    totalTicks: 1920,
    tempos: [{ atTick: 0, bpm: 120, interpolation: 'step' }],
    timeSignatures: [{ atTick: 0, numerator: 4, denominator: 4 }],
    keySignatures: [],
    sections: [],
    tracks: [
      {
        id: 't1',
        name: 'Lead',
        tuning: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'],
        events: [{ atTick: 0, durationTicks: 480, notes: [{ string: 0, fret: 3 }] }],
      },
    ],
    ...overrides,
  };
}

describe('validateImportIR', () => {
  it('passes through a healthy IR with no warnings', () => {
    const { ir, warnings } = validateImportIR(baseIR());
    expect(warnings).toEqual([]);
    expect(ir.tracks[0].events).toHaveLength(1);
  });

  it('rejects when ticksPerQuarter is out of range', () => {
    expect(() => validateImportIR(baseIR({ ticksPerQuarter: 0 }))).toThrow(ImportValidationError);
  });

  it('rejects when totalTicks exceeds cap', () => {
    expect(() => validateImportIR(baseIR({ totalTicks: LIMITS.maxTotalTicks + 1 }))).toThrow(
      ImportValidationError,
    );
  });

  it('clamps out-of-range fret positions', () => {
    const ir = baseIR();
    ir.tracks[0].events[0].notes[0].fret = 999;
    const result = validateImportIR(ir);
    expect(result.ir.tracks[0].events[0].notes[0].fret).toBe(LIMITS.maxFret);
  });

  it('clamps string index to the tuning length minus one', () => {
    const ir = baseIR();
    ir.tracks[0].events[0].notes[0].string = 50;
    const result = validateImportIR(ir);
    // tuning has 6 strings → max index 5
    expect(result.ir.tracks[0].events[0].notes[0].string).toBe(5);
  });

  it('drops events with non-finite ticks', () => {
    const ir = baseIR();
    ir.tracks[0].events.push({
      atTick: NaN as unknown as number,
      durationTicks: 480,
      notes: [],
    });
    expect(validateImportIR(ir).ir.tracks[0].events).toHaveLength(1);
  });

  it('caps event count and emits a warning', () => {
    const ir = baseIR();
    const extra = LIMITS.maxEventsPerTrack + 5;
    ir.tracks[0].events = Array.from({ length: extra }, (_, i) => ({
      atTick: i,
      durationTicks: 1,
      notes: [{ string: 0, fret: 0 }],
    }));
    const { ir: out, warnings } = validateImportIR(ir);
    expect(out.tracks[0].events.length).toBe(LIMITS.maxEventsPerTrack);
    expect(warnings.some((w) => w.includes('clamped'))).toBe(true);
  });

  it('strips control characters from metadata strings', () => {
    const ir = baseIR();
    ir.meta.title = 'Hello\x00World!\x1f';
    expect(validateImportIR(ir).ir.meta.title).toBe('HelloWorld!');
  });

  it('caps long metadata strings', () => {
    const ir = baseIR();
    ir.meta.title = 'a'.repeat(LIMITS.maxStringLength + 100);
    expect(validateImportIR(ir).ir.meta.title!.length).toBe(LIMITS.maxStringLength);
  });

  it('clamps BPM into the allowed range', () => {
    const ir = baseIR({ tempos: [{ atTick: 0, bpm: 9999, interpolation: 'step' }] });
    expect(validateImportIR(ir).ir.tempos[0].bpm).toBe(LIMITS.maxBpm);
  });

  it('clamps time signature numerator/denominator', () => {
    const ir = baseIR({ timeSignatures: [{ atTick: 0, numerator: 999, denominator: 999 }] });
    const result = validateImportIR(ir);
    expect(result.ir.timeSignatures[0].numerator).toBe(LIMITS.maxTimeSignatureNumerator);
    expect(result.ir.timeSignatures[0].denominator).toBe(LIMITS.maxTimeSignatureDenominator);
  });

  it('drops tracks beyond the maxTracks cap and warns', () => {
    const ir = baseIR();
    ir.tracks = Array.from({ length: LIMITS.maxTracks + 3 }, (_, i) => ({
      id: `t${i}`,
      name: `Track ${i}`,
      tuning: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'],
      events: [],
    }));
    const { ir: out, warnings } = validateImportIR(ir);
    expect(out.tracks.length).toBe(LIMITS.maxTracks);
    expect(warnings.some((w) => w.includes('beyond the'))).toBe(true);
  });

  it('drops invalid dynamics rather than passing them through', () => {
    const ir = baseIR();
    // @ts-expect-error — feeding the validator a bogus dynamic on purpose
    ir.tracks[0].events[0].dynamic = 'evil';
    expect(validateImportIR(ir).ir.tracks[0].events[0].dynamic).toBeUndefined();
  });

  it('clamps tempo bpm to a minimum', () => {
    const ir = baseIR({ tempos: [{ atTick: 0, bpm: 1, interpolation: 'step' }] });
    expect(validateImportIR(ir).ir.tempos[0].bpm).toBe(LIMITS.minBpm);
  });

  it('preserves section markers with sanitized names', () => {
    const ir = baseIR({
      sections: [
        { atTick: 0, name: 'Verse\x001' },
        { atTick: 960, name: 'Chorus' },
      ],
    });
    const result = validateImportIR(ir);
    expect(result.ir.sections).toEqual([
      { atTick: 0, name: 'Verse1' },
      { atTick: 960, name: 'Chorus' },
    ]);
  });
});
