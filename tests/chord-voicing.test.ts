import { describe, it, expect } from 'vitest';
import { voiceChord, voiceChordPreferred } from '../src/lib/chord-voicing';
import { parseChordSymbol } from '../src/lib/chords';
import { getTuning } from '../src/lib/tunings';
import { pitchOf } from '../src/lib/fretboard';
import type { TuningDef } from '../src/types';

const standard = getTuning('standard') as TuningDef;

function pcOf(cell: { stringIndex: number; fret: number }, tuning: TuningDef): number {
  return ((pitchOf(cell, tuning) % 12) + 12) % 12;
}

describe('voiceChord', () => {
  it('produces a valid major-chord voicing on standard tuning', () => {
    const chord = parseChordSymbol('C')!;
    const grip = voiceChord(chord, standard)!;
    expect(grip).not.toBeNull();

    const chordPcs = new Set(chord.pitchClasses); // C E G = {0,4,7}

    // every played cell is a chord tone
    for (const cell of grip.cells) {
      expect(chordPcs.has(pcOf(cell, standard))).toBe(true);
    }

    // at most one note per string
    const stringIdxs = grip.cells.map((c) => c.stringIndex);
    expect(new Set(stringIdxs).size).toBe(stringIdxs.length);

    // the lowest-sounding string carries the root (no slash → root in bass)
    const lowest = [...grip.cells].sort((a, b) => a.stringIndex - b.stringIndex)[0];
    expect(pcOf(lowest, standard)).toBe(0); // C

    // all three chord tones are present somewhere
    const covered = new Set(grip.cells.map((c) => pcOf(c, standard)));
    for (const pc of chordPcs) expect(covered.has(pc)).toBe(true);

    // fretted notes stay within a playable span
    const fretted = grip.cells.map((c) => c.fret).filter((f) => f > 0);
    if (fretted.length > 1) {
      expect(Math.max(...fretted) - Math.min(...fretted)).toBeLessThanOrEqual(4);
    }
  });

  it('puts the slash bass on the lowest-sounding string', () => {
    const chord = parseChordSymbol('C/E')!; // bass E
    const grip = voiceChord(chord, standard)!;
    const lowest = [...grip.cells].sort((a, b) => a.stringIndex - b.stringIndex)[0];
    expect(pcOf(lowest, standard)).toBe(4); // E
  });

  it('voices a minor chord with only chord tones', () => {
    const chord = parseChordSymbol('Am')!; // A C E
    const grip = voiceChord(chord, standard)!;
    const chordPcs = new Set(chord.pitchClasses);
    for (const cell of grip.cells) {
      expect(chordPcs.has(pcOf(cell, standard))).toBe(true);
    }
    const lowest = [...grip.cells].sort((a, b) => a.stringIndex - b.stringIndex)[0];
    expect(pcOf(lowest, standard)).toBe(9); // A
  });
});

describe('voiceChordPreferred (curated dictionary)', () => {
  function gripByString(grip: { cells: ReadonlyArray<{ stringIndex: number; fret: number }> }) {
    const byStr: Record<number, number> = {};
    for (const c of grip.cells) byStr[c.stringIndex] = c.fret;
    return byStr;
  }

  it('returns the open shape for common open chords', () => {
    for (const sym of ['C', 'G', 'D', 'A', 'E', 'Em', 'Am', 'Dm']) {
      const chord = parseChordSymbol(sym)!;
      const grip = voiceChordPreferred(chord, standard)!;
      const frets = grip.cells.map((c) => c.fret);
      expect(Math.max(...frets)).toBeLessThanOrEqual(3); // open position
      const pcs = new Set(chord.pitchClasses);
      for (const c of grip.cells) expect(pcs.has(pcOf(c, standard))).toBe(true);
    }
  });

  it('voices C as the canonical open C (x 3 2 0 1 0)', () => {
    const grip = voiceChordPreferred(parseChordSymbol('C')!, standard)!;
    const f = gripByString(grip);
    expect(f[0]).toBeUndefined(); // low E muted
    expect(f[1]).toBe(3); // A → C
    expect(f[2]).toBe(2); // D → E
    expect(f[3]).toBe(0); // G open
    expect(f[4]).toBe(1); // B → C
    expect(f[5]).toBe(0); // e open
  });

  it('chooses a complete voicing over a low sparse fragment (F covers all tones)', () => {
    const chord = parseChordSymbol('F')!; // F A C
    const grip = voiceChordPreferred(chord, standard)!;
    const covered = new Set(grip.cells.map((c) => pcOf(c, standard)));
    for (const pc of new Set(chord.pitchClasses)) expect(covered.has(pc)).toBe(true);
  });

  it('falls back to a valid voicing for chords with no dictionary shape', () => {
    const chord = parseChordSymbol('Csus4')!; // not a CAGED quality
    const grip = voiceChordPreferred(chord, standard)!;
    const pcs = new Set(chord.pitchClasses);
    for (const c of grip.cells) expect(pcs.has(pcOf(c, standard))).toBe(true);
  });
});
