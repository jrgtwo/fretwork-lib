import { describe, it, expect } from 'vitest';
import {
  INSTRUMENTS,
  getInstrument,
  DEFAULT_INSTRUMENT_ID,
} from '../src/lib/instruments';
import { getTuning, getTuningsForInstrument } from '../src/lib/tunings';
import { buildGrid, computeHighlights, pitchOf } from '../src/lib/fretboard';
import { ascendingPitchPattern } from '../src/playback/patterns/ascending-pitch';
import { CAGED_PATTERNS } from '../src/playback/patterns/caged';
import { getScale } from '../src/lib/scales';
import type { ResolveInput } from '../src/playback/types';

describe('INSTRUMENTS registry', () => {
  it('has guitar, bass, ukulele', () => {
    expect(getInstrument('guitar')).toBeDefined();
    expect(getInstrument('bass')).toBeDefined();
    expect(getInstrument('ukulele')).toBeDefined();
  });

  it('default is guitar', () => {
    expect(DEFAULT_INSTRUMENT_ID).toBe('guitar');
  });

  it('each instrument has a default tuning that exists in the catalog', () => {
    for (const i of INSTRUMENTS) {
      const t = getTuning(i.defaultTuningId);
      expect(t).toBeDefined();
      expect(t!.instrumentId).toBe(i.id);
    }
  });
});

describe('getTuningsForInstrument', () => {
  it('returns guitar tunings only when querying guitar', () => {
    const tunings = getTuningsForInstrument('guitar');
    expect(tunings.length).toBeGreaterThanOrEqual(6);
    for (const t of tunings) {
      expect(t.instrumentId).toBe('guitar');
    }
  });

  it('returns 2 bass tunings', () => {
    const tunings = getTuningsForInstrument('bass');
    expect(tunings.length).toBe(2);
    expect(tunings.map((t) => t.id).sort()).toEqual(['bass-drop-d', 'bass-standard']);
  });

  it('returns 3 ukulele tunings', () => {
    const tunings = getTuningsForInstrument('ukulele');
    expect(tunings.length).toBe(3);
  });
});

describe('buildGrid with bass', () => {
  it('produces a 4-string × 22-fret grid in standard bass tuning', () => {
    const tuning = getTuning('bass-standard')!;
    const bass = getInstrument('bass')!;
    const grid = buildGrid(tuning, 0, bass.fretCount);
    expect(grid).toHaveLength(4);
    grid.forEach((row) => expect(row).toHaveLength(bass.fretCount + 1));
    // Low E (index 0) is E1; fret 5 = A1; fret 12 = E2.
    expect(grid[0][0].note).toBe('E1');
    expect(grid[0][5].note).toBe('A1');
    expect(grid[0][12].note).toBe('E2');
  });
});

describe('buildGrid with reentrant ukulele', () => {
  it('string index 0 is high G (NOT the lowest pitch)', () => {
    const tuning = getTuning('ukulele-standard')!;
    const uke = getInstrument('ukulele')!;
    const grid = buildGrid(tuning, 0, uke.fretCount);
    expect(grid).toHaveLength(4);
    grid.forEach((row) => expect(row).toHaveLength(uke.fretCount + 1));
    // Reentrant: index 0 is G4 (high), index 1 is C4 (LOWEST), index 3 is A4 (highest).
    expect(grid[0][0].note).toBe('G4');
    expect(grid[1][0].note).toBe('C4');
    expect(grid[3][0].note).toBe('A4');
  });

  it('pitchOf returns correct MIDI for reentrant tuning', () => {
    const tuning = getTuning('ukulele-standard')!;
    // G4 is MIDI 67; C4 is MIDI 60; A4 is MIDI 69.
    expect(pitchOf({ stringIndex: 0, fret: 0 }, tuning)).toBe(67); // G4
    expect(pitchOf({ stringIndex: 1, fret: 0 }, tuning)).toBe(60); // C4 (lowest!)
    expect(pitchOf({ stringIndex: 3, fret: 0 }, tuning)).toBe(69); // A4
  });
});

describe('ascendingPitchPattern with reentrant ukulele', () => {
  it('orders cells by ascending MIDI pitch — C4 first, A4 highest, G4 in the middle', () => {
    const tuning = getTuning('ukulele-standard')!;
    const uke = getInstrument('ukulele')!;
    const major = getScale('major')!;
    const grid = buildGrid(tuning, 0, uke.fretCount);
    const highlights = computeHighlights(grid, 'C', major.intervals);

    const input: ResolveInput = {
      highlights,
      tuning,
      key: 'C',
      capo: 0,
      mode: 'scales',
      instrumentId: 'ukulele',
      fretCount: uke.fretCount,
      scaleType: 'major',
    };
    const seq = ascendingPitchPattern.resolve(input);
    expect(seq.length).toBeGreaterThan(0);

    // The first cell should be the LOWEST pitch in the highlights — which on a
    // reentrant ukulele is C4 on string 1 fret 0 (NOT G4 on string 0 fret 0).
    expect(seq[0]).toEqual({ stringIndex: 1, fret: 0 });

    // Pitches are strictly non-decreasing.
    const pitches = seq.map((c) => pitchOf(c, tuning));
    for (let i = 1; i < pitches.length; i++) {
      expect(pitches[i]).toBeGreaterThanOrEqual(pitches[i - 1]);
    }
  });
});

describe('CAGED applicability per instrument', () => {
  function makeInput(instrumentId: string): ResolveInput {
    const tuningId = instrumentId === 'guitar'
      ? 'standard'
      : instrumentId === 'bass'
        ? 'bass-standard'
        : 'ukulele-standard';
    const tuning = getTuning(tuningId)!;
    const inst = getInstrument(instrumentId)!;
    const grid = buildGrid(tuning, 0, inst.fretCount);
    const highlights = computeHighlights(grid, 'A', getScale('major')!.intervals);
    return {
      highlights,
      tuning,
      key: 'A',
      capo: 0,
      mode: 'scales',
      instrumentId,
      fretCount: inst.fretCount,
      scaleType: 'major',
    };
  }

  it('CAGED is applicable on guitar', () => {
    for (const p of CAGED_PATTERNS) {
      expect(p.isApplicable(makeInput('guitar'))).toBe(true);
    }
  });

  it('CAGED is applicable on bass', () => {
    for (const p of CAGED_PATTERNS) {
      expect(p.isApplicable(makeInput('bass'))).toBe(true);
    }
  });

  it('CAGED is NOT applicable on ukulele', () => {
    for (const p of CAGED_PATTERNS) {
      expect(p.isApplicable(makeInput('ukulele'))).toBe(false);
    }
  });

  it('CAGED entries are tagged with applicableInstruments=["guitar","bass"]', () => {
    for (const p of CAGED_PATTERNS) {
      expect(p.applicableInstruments).toEqual(['guitar', 'bass']);
    }
  });
});
