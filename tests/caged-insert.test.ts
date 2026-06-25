import { describe, it, expect } from 'vitest';
import { planCagedInsert, isCagedInsertApplicable } from '../src/patterns/caged-insert';
import type { CagedInsertRequest } from '../src/patterns/caged-insert';
import { getTuning } from '../src/lib/tunings';
import { getInstrument } from '../src/lib/instruments';
import { PPQ } from '../src/patterns/timebase';
import { pitchOf } from '../src/lib/fretboard';

const STANDARD = getTuning('standard')!;
const BASS = getTuning('bass-standard')!;
const GUITAR_FRETS = getInstrument('guitar')!.fretCount;
const BASS_FRETS = getInstrument('bass')!.fretCount;

function guitarReq(overrides: Partial<CagedInsertRequest> = {}): CagedInsertRequest {
  return {
    shapeId: 'caged-e',
    mode: 'scale',
    key: 'A',
    scaleType: 'major',
    traversal: 'string-by-string',
    tuning: STANDARD,
    capo: 0,
    fretCount: GUITAR_FRETS,
    stringCount: 6,
    ...overrides,
  };
}

const STEP_EIGHTH = PPQ / 2; // 240 ticks

describe('planCagedInsert — scale mode', () => {
  it('returns a plan with notes when shape resolves', () => {
    const plan = planCagedInsert(guitarReq(), STEP_EIGHTH);
    expect(plan.notes.length).toBeGreaterThan(0);
    expect(plan.totalTicks).toBe(plan.notes.length * STEP_EIGHTH);
  });

  it('assigns sequential startTickOffsets in scale mode', () => {
    const plan = planCagedInsert(guitarReq(), STEP_EIGHTH);
    plan.notes.forEach((n, i) => {
      expect(n.startTickOffset).toBe(i * STEP_EIGHTH);
      expect(n.durationTicks).toBe(STEP_EIGHTH);
    });
  });

  it('string-by-string traversal: notes are grouped by ascending string, frets ascending within each', () => {
    const plan = planCagedInsert(guitarReq({ traversal: 'string-by-string' }), STEP_EIGHTH);
    let lastString = -1;
    let lastFret = -Infinity;
    for (const n of plan.notes) {
      if (n.stringIndex !== lastString) {
        expect(n.stringIndex).toBeGreaterThan(lastString);
        lastString = n.stringIndex;
        lastFret = -Infinity;
      }
      expect(n.fret).toBeGreaterThanOrEqual(lastFret);
      lastFret = n.fret;
    }
  });

  it('returns empty plan when shape does not resolve (e.g., scale not CAGED-supported)', () => {
    const plan = planCagedInsert(guitarReq({ scaleType: 'blues' }), STEP_EIGHTH);
    expect(plan.notes).toEqual([]);
    expect(plan.totalTicks).toBe(0);
  });

  it('bass: drops cells where stringIndex >= 4', () => {
    const plan = planCagedInsert(
      guitarReq({ tuning: BASS, stringCount: 4, fretCount: BASS_FRETS }),
      STEP_EIGHTH,
    );
    expect(plan.notes.length).toBeGreaterThan(0);
    for (const n of plan.notes) {
      expect(n.stringIndex).toBeLessThanOrEqual(3);
    }
  });

  it('isCagedInsertApplicable mirrors plan.notes.length > 0', () => {
    expect(isCagedInsertApplicable(guitarReq())).toBe(true);
    expect(isCagedInsertApplicable(guitarReq({ scaleType: 'blues' }))).toBe(false);
  });
});

describe('planCagedInsert — chord mode (CAGED chord voicings)', () => {
  it('major: stacks 3-5 chord-tone cells at offset 0 with one step duration', () => {
    const plan = planCagedInsert(
      guitarReq({ mode: 'chord', chordQuality: 'major' }),
      STEP_EIGHTH,
    );
    expect(plan.notes.length).toBeGreaterThanOrEqual(3);
    expect(plan.notes.length).toBeLessThanOrEqual(6);
    for (const n of plan.notes) {
      expect(n.startTickOffset).toBe(0);
      expect(n.durationTicks).toBe(STEP_EIGHTH);
    }
    expect(plan.totalTicks).toBe(STEP_EIGHTH);
  });

  it('major notes are chord tones only (1, 3, 5) — no scale-cluster notes', () => {
    // C-shape A major: A C# E. Pitch classes: 9, 1, 4.
    const plan = planCagedInsert(
      guitarReq({ shapeId: 'caged-c', mode: 'chord', chordQuality: 'major', key: 'A' }),
      STEP_EIGHTH,
    );
    const allowedPcs = new Set([9, 1, 4]);
    for (const n of plan.notes) {
      expect(allowedPcs.has(pitchOf(n, STANDARD) % 12)).toBe(true);
    }
  });

  it('minor: lowers the 3rd to b3 (e.g., A minor has C natural, not C#)', () => {
    // Minor A: A C E. PCs: 9, 0, 4.
    const plan = planCagedInsert(
      guitarReq({ shapeId: 'caged-a', mode: 'chord', chordQuality: 'minor', key: 'A' }),
      STEP_EIGHTH,
    );
    const allowedPcs = new Set([9, 0, 4]); // A, C, E
    for (const n of plan.notes) {
      expect(allowedPcs.has(pitchOf(n, STANDARD) % 12)).toBe(true);
    }
    // Specifically: no C# (pc 1) anywhere.
    for (const n of plan.notes) {
      expect(pitchOf(n, STANDARD) % 12).not.toBe(1);
    }
  });

  it('dom7: includes the b7 of the key', () => {
    // A7: A C# E G. PCs: 9, 1, 4, 7.
    const plan = planCagedInsert(
      guitarReq({ shapeId: 'caged-a', mode: 'chord', chordQuality: 'dom7', key: 'A' }),
      STEP_EIGHTH,
    );
    expect(plan.notes.some((n) => pitchOf(n, STANDARD) % 12 === 7)).toBe(true); // G present
  });

  it('maj7: includes the natural 7 of the key', () => {
    // Amaj7: A C# E G#. PC of G# is 8.
    const plan = planCagedInsert(
      guitarReq({ shapeId: 'caged-a', mode: 'chord', chordQuality: 'maj7', key: 'A' }),
      STEP_EIGHTH,
    );
    expect(plan.notes.some((n) => pitchOf(n, STANDARD) % 12 === 8)).toBe(true); // G# present
  });

  it('defaults to major when chordQuality is omitted', () => {
    const a = planCagedInsert(
      guitarReq({ mode: 'chord' }),
      STEP_EIGHTH,
    );
    const b = planCagedInsert(
      guitarReq({ mode: 'chord', chordQuality: 'major' }),
      STEP_EIGHTH,
    );
    expect(a.notes.length).toBe(b.notes.length);
  });

  it('bass: chord modes work on 4-string bass (cells dropped on absent strings)', () => {
    const plan = planCagedInsert(
      guitarReq({
        shapeId: 'caged-e',
        mode: 'chord',
        chordQuality: 'major',
        tuning: BASS,
        stringCount: 4,
        fretCount: BASS_FRETS,
      }),
      STEP_EIGHTH,
    );
    expect(plan.notes.length).toBeGreaterThanOrEqual(3);
    for (const n of plan.notes) {
      expect(n.stringIndex).toBeLessThanOrEqual(3);
    }
  });
});

describe('planCagedInsert — arp mode', () => {
  it('emits cells whose pitch-classes match the arp intervals from the key', () => {
    const plan = planCagedInsert(
      guitarReq({ mode: 'arp', arpeggioType: 'maj7', scaleType: undefined }),
      STEP_EIGHTH,
    );
    expect(plan.notes.length).toBeGreaterThan(0);
    // maj7 of A = A C# E G#: PCs 9, 1, 4, 8
    const allowed = new Set([9, 1, 4, 8]);
    for (const n of plan.notes) {
      const openName = STANDARD.strings[n.stringIndex];
      const pc = (parsePc(openName) + n.fret) % 12;
      expect(allowed.has(pc)).toBe(true);
    }
  });

  it('arp mode advances cursor sequentially like scale mode', () => {
    const plan = planCagedInsert(
      guitarReq({ mode: 'arp', arpeggioType: 'maj7', scaleType: undefined }),
      STEP_EIGHTH,
    );
    plan.notes.forEach((n, i) => {
      expect(n.startTickOffset).toBe(i * STEP_EIGHTH);
    });
  });
});

describe('planCagedInsert — traversal variants', () => {
  it('ascending-pitch: every consecutive pair is non-decreasing pitch', () => {
    const plan = planCagedInsert(
      guitarReq({ traversal: 'ascending-pitch' }),
      STEP_EIGHTH,
    );
    for (let i = 1; i < plan.notes.length; i++) {
      const prev = plan.notes[i - 1];
      const cur = plan.notes[i];
      const prevPitch = pitchOf(prev, STANDARD);
      const curPitch = pitchOf(cur, STANDARD);
      expect(curPitch).toBeGreaterThanOrEqual(prevPitch);
    }
  });

  it('up-and-down: total cells equal more than ascending-pitch (apex unrepeated)', () => {
    const up = planCagedInsert(guitarReq({ traversal: 'ascending-pitch' }), STEP_EIGHTH);
    const updown = planCagedInsert(guitarReq({ traversal: 'up-and-down' }), STEP_EIGHTH);
    expect(updown.notes.length).toBeGreaterThan(up.notes.length);
  });
});

// Helper: pitch class from an open-string note name like 'E2' or 'A#'.
function parsePc(name: string): number {
  const letter = name[0];
  const accidental = name[1] === '#' || name[1] === 'b' ? name[1] : '';
  const base: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  let pc = base[letter] ?? 0;
  if (accidental === '#') pc += 1;
  else if (accidental === 'b') pc -= 1;
  return ((pc % 12) + 12) % 12;
}
