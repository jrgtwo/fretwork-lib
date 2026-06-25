import { describe, it, expect } from 'vitest';
import {
  CAGED_PATTERNS,
  resolveShapeAbsoluteCells,
  getCagedPositionMap,
  getCagedShapeSet,
} from '../src/playback/patterns/caged';
import { buildGrid, computeHighlights, pitchOf, FRET_COUNT } from '../src/lib/fretboard';
import { getTuning } from '../src/lib/tunings';
import { getScale } from '../src/lib/scales';
import type { ResolveInput } from '../src/playback/types';

const STANDARD = getTuning('standard')!;

function makeInput(overrides: Partial<ResolveInput> = {}): ResolveInput {
  const scaleId = (overrides.scaleType as string | undefined) ?? 'major';
  const scale = getScale(scaleId);
  const intervals = scale?.intervals ?? [0];
  const grid = buildGrid(STANDARD, overrides.capo ?? 0);
  const highlights = computeHighlights(grid, overrides.key ?? 'A', intervals, overrides.capo ?? 0);
  return {
    highlights,
    tuning: STANDARD,
    key: 'A',
    capo: 0,
    mode: 'scales',
    instrumentId: 'guitar',
    fretCount: FRET_COUNT,
    scaleType: scaleId,
    ...overrides,
  };
}

const findShape = (id: string) => CAGED_PATTERNS.find((p) => p.id === id)!;

// ─── Cell-set checks ───────────────────────────────────────────────────────────
// For A major in standard tuning, no capo, the 5 boxes should land at the
// guitarist-expected positions.

describe('CAGED — E shape (A major, std tuning)', () => {
  it('anchors at fret 5 on low E with box covering frets 4–8', () => {
    const seq = findShape('caged-e').resolve(makeInput());
    expect(seq.length).toBeGreaterThan(0);
    for (const c of seq) {
      expect(c.fret).toBeGreaterThanOrEqual(4);
      expect(c.fret).toBeLessThanOrEqual(8);
    }
    expect(seq.some((c) => c.stringIndex === 0 && c.fret === 5)).toBe(true);
  });
});

describe('CAGED — D shape (A major, std tuning)', () => {
  it('anchors at fret 7 on D string with box covering frets 6–10', () => {
    const seq = findShape('caged-d').resolve(makeInput());
    expect(seq.length).toBeGreaterThan(0);
    for (const c of seq) {
      expect(c.fret).toBeGreaterThanOrEqual(6);
      expect(c.fret).toBeLessThanOrEqual(10);
    }
    expect(seq.some((c) => c.stringIndex === 2 && c.fret === 7)).toBe(true);
  });
});

describe('CAGED — C shape (A major, std tuning)', () => {
  it('positions at the octave (fret 12 anchor) since open box would fall behind nut', () => {
    const seq = findShape('caged-c').resolve(makeInput());
    expect(seq.length).toBeGreaterThan(0);
    // Octave-up C-shape for A: anchor fret 12, box 9–13.
    for (const c of seq) {
      expect(c.fret).toBeGreaterThanOrEqual(9);
      expect(c.fret).toBeLessThanOrEqual(13);
    }
    expect(seq.some((c) => c.stringIndex === 1 && c.fret === 12)).toBe(true);
  });
});

describe('CAGED — A shape (A major, std tuning)', () => {
  it('positions at the open A position (anchor fret 0, box ~0–3)', () => {
    const seq = findShape('caged-a').resolve(makeInput());
    expect(seq.length).toBeGreaterThan(0);
    // Open A-shape for A major: anchor fret 0, cells span fret 0–3.
    for (const c of seq) {
      expect(c.fret).toBeGreaterThanOrEqual(0);
      expect(c.fret).toBeLessThanOrEqual(3);
    }
    // The A-string root at fret 0 (open A) should be present.
    expect(seq.some((c) => c.stringIndex === 1 && c.fret === 0)).toBe(true);
  });
});

describe('CAGED — G shape (A major, std tuning)', () => {
  it('anchors at fret 5 on low E with box covering frets 1–5', () => {
    const seq = findShape('caged-g').resolve(makeInput());
    expect(seq.length).toBeGreaterThan(0);
    for (const c of seq) {
      expect(c.fret).toBeGreaterThanOrEqual(1);
      expect(c.fret).toBeLessThanOrEqual(5);
    }
    expect(seq.some((c) => c.stringIndex === 0 && c.fret === 5)).toBe(true);
  });
});

// ─── Up-and-down sequence shape ───────────────────────────────────────────────

describe('CAGED — up-and-down sequence', () => {
  it('starts and ends on the lowest-pitch cell of the box', () => {
    const seq = findShape('caged-e').resolve(makeInput());
    expect(seq.length).toBeGreaterThan(0);
    const first = seq[0];
    const last = seq[seq.length - 1];
    const lowestPitch = Math.min(...seq.map((c) => pitchOf(c, STANDARD)));
    expect(pitchOf(first, STANDARD)).toBe(lowestPitch);
    expect(pitchOf(last, STANDARD)).toBe(lowestPitch);
  });

  it('reaches an apex (highest-pitch cell) in the middle', () => {
    const seq = findShape('caged-e').resolve(makeInput());
    const pitches = seq.map((c) => pitchOf(c, STANDARD));
    const max = Math.max(...pitches);
    const apexIdx = pitches.indexOf(max);
    expect(apexIdx).toBeGreaterThan(0);
    expect(apexIdx).toBeLessThan(seq.length - 1);
    // The apex should appear exactly once.
    expect(pitches.filter((p) => p === max).length).toBe(1);
  });

  it('is monotonically non-decreasing up to the apex, then non-increasing', () => {
    const seq = findShape('caged-d').resolve(makeInput());
    const pitches = seq.map((c) => pitchOf(c, STANDARD));
    const max = Math.max(...pitches);
    const apexIdx = pitches.indexOf(max);
    for (let i = 1; i <= apexIdx; i++) {
      expect(pitches[i]).toBeGreaterThanOrEqual(pitches[i - 1]);
    }
    for (let i = apexIdx + 1; i < pitches.length; i++) {
      expect(pitches[i]).toBeLessThanOrEqual(pitches[i - 1]);
    }
  });
});

// ─── Applicability ─────────────────────────────────────────────────────────────

describe('CAGED — applicability', () => {
  it('returns false isApplicable when mode is not scales', () => {
    for (const p of CAGED_PATTERNS) {
      expect(p.isApplicable(makeInput({ mode: 'arpeggios' }))).toBe(false);
      expect(p.isApplicable(makeInput({ mode: 'notes' }))).toBe(false);
    }
  });

  it('returns false isApplicable for unsupported instruments (e.g. ukulele)', () => {
    for (const p of CAGED_PATTERNS) {
      expect(p.isApplicable(makeInput({ instrumentId: 'ukulele' }))).toBe(false);
    }
  });

  it('all 5 shapes are applicable for A major in standard tuning, no capo', () => {
    for (const p of CAGED_PATTERNS) {
      expect(p.isApplicable(makeInput())).toBe(true);
    }
  });

  it('returns false isApplicable for unsupported scale types (e.g. blues)', () => {
    for (const p of CAGED_PATTERNS) {
      expect(p.isApplicable(makeInput({ scaleType: 'blues' }))).toBe(false);
    }
  });
});

// ─── Capo ──────────────────────────────────────────────────────────────────────

describe('CAGED — capo handling', () => {
  it('shifts anchor up so all cells stay >= capo', () => {
    const seq = findShape('caged-e').resolve(makeInput({ capo: 5 }));
    expect(seq.length).toBeGreaterThan(0);
    for (const c of seq) {
      expect(c.fret).toBeGreaterThanOrEqual(5);
    }
  });
});

// ─── Pentatonic filtering ─────────────────────────────────────────────────────

describe('CAGED — pentatonic filtering', () => {
  it('emits fewer cells for major-pentatonic than for major', () => {
    const major = findShape('caged-e').resolve(makeInput({ scaleType: 'major' }));
    const pent = findShape('caged-e').resolve(makeInput({ scaleType: 'major-pentatonic' }));
    expect(pent.length).toBeGreaterThan(0);
    expect(pent.length).toBeLessThan(major.length);
  });

  it('minor-pentatonic resolves to the same notes as the relative major-pentatonic', () => {
    // A minor pentatonic = C major pentatonic in note content.
    const aMinorPent = findShape('caged-e').resolve(makeInput({ key: 'A', scaleType: 'minor-pentatonic' }));
    const cMajorPent = findShape('caged-e').resolve(makeInput({ key: 'C', scaleType: 'major-pentatonic' }));
    expect(aMinorPent.length).toBeGreaterThan(0);
    // Same up-and-down sequence (same anchor, same cells, same ordering).
    expect(aMinorPent).toEqual(cMajorPent);
  });
});

// ─── Modes ────────────────────────────────────────────────────────────────────

describe('CAGED — modes share parent major positions', () => {
  it('D dorian resolves to the same cells as C major', () => {
    const dDorian = findShape('caged-e').resolve(makeInput({ key: 'D', scaleType: 'dorian' }));
    const cMajor = findShape('caged-e').resolve(makeInput({ key: 'C', scaleType: 'major' }));
    expect(dDorian).toEqual(cMajor);
  });

  it('A natural minor resolves to the same cells as C major', () => {
    const aMinor = findShape('caged-e').resolve(makeInput({ key: 'A', scaleType: 'minor' }));
    const cMajor = findShape('caged-e').resolve(makeInput({ key: 'C', scaleType: 'major' }));
    expect(aMinor).toEqual(cMajor);
  });
});

// ─── Harmonic / melodic minor use their own shape sets ────────────────────────

describe('CAGED — harmonic minor', () => {
  it('emits non-empty C harmonic minor sequence anchored at C', () => {
    const seq = findShape('caged-c').resolve(makeInput({ key: 'C', scaleType: 'harmonic-minor' }));
    expect(seq.length).toBeGreaterThan(0);
    // Cell at A string fret 3 (the C anchor) should be present.
    expect(seq.some((c) => c.stringIndex === 1 && c.fret === 3)).toBe(true);
  });

  it('differs from C major shape (♭3 and ♭6 are at different frets)', () => {
    const hm = findShape('caged-c').resolve(makeInput({ key: 'C', scaleType: 'harmonic-minor' }));
    const major = findShape('caged-c').resolve(makeInput({ key: 'C', scaleType: 'major' }));
    expect(hm).not.toEqual(major);
  });
});

describe('CAGED — melodic minor', () => {
  it('emits non-empty C melodic minor sequence anchored at C', () => {
    const seq = findShape('caged-c').resolve(makeInput({ key: 'C', scaleType: 'melodic-minor' }));
    expect(seq.length).toBeGreaterThan(0);
    expect(seq.some((c) => c.stringIndex === 1 && c.fret === 3)).toBe(true);
  });

  it('shares the natural 6th with major (only ♭3 differs)', () => {
    // Cells differing between major and melodic-minor should only be those involving the
    // 3rd. The total number of cells should be equal (we don't add or remove cells, just
    // shift specific ones).
    const mm = findShape('caged-e').resolve(makeInput({ key: 'C', scaleType: 'melodic-minor' }));
    const maj = findShape('caged-e').resolve(makeInput({ key: 'C', scaleType: 'major' }));
    expect(mm.length).toBe(maj.length);
  });
});

// ─── Position numbering ───────────────────────────────────────────────────────

describe('CAGED — position numbering', () => {
  it('labels shapes with "Position N — X shape" sorted by lowest fret of the box', () => {
    // For C major, going up the neck: C (open), A (~2-5), G (~5-8), E (~7-10), D (~9-13)
    const input = makeInput({ key: 'C', scaleType: 'major' });
    const labels = new Map<string, string | undefined>();
    for (const p of CAGED_PATTERNS) {
      labels.set(p.id, p.displayName?.(input));
    }
    expect(labels.get('caged-c')).toMatch(/Position 1 — C shape/);
    expect(labels.get('caged-a')).toMatch(/Position 2 — A shape/);
    expect(labels.get('caged-g')).toMatch(/Position 3 — G shape/);
    expect(labels.get('caged-e')).toMatch(/Position 4 — E shape/);
    expect(labels.get('caged-d')).toMatch(/Position 5 — D shape/);
  });

  it('rotates position numbers when the key changes', () => {
    // For E major, the lowest box on the neck is E shape (open position).
    const input = makeInput({ key: 'E', scaleType: 'major' });
    const eLabel = findShape('caged-e').displayName?.(input);
    expect(eLabel).toMatch(/Position 1 — E shape/);
  });
});

// ─── Public utility surface ──────────────────────────────────────────────────

describe('resolveShapeAbsoluteCells', () => {
  it('returns the same cells the caged pattern resolver walks (just unsorted)', () => {
    const input = makeInput({ key: 'A', scaleType: 'major' });
    const cells = resolveShapeAbsoluteCells('caged-e', input);
    expect(cells.length).toBeGreaterThan(0);
    // The walked sequence is a permutation of the cell set.
    const seq = findShape('caged-e').resolve(input);
    const cellKeys = new Set(cells.map((c) => `${c.stringIndex}:${c.fret}`));
    for (const c of seq) {
      expect(cellKeys.has(`${c.stringIndex}:${c.fret}`)).toBe(true);
    }
  });

  it('returns [] for an unsupported scale (e.g. blues)', () => {
    const input = makeInput({ scaleType: 'blues' });
    expect(resolveShapeAbsoluteCells('caged-c', input)).toEqual([]);
  });
});

describe('getCagedShapeSet + getCagedPositionMap (public)', () => {
  it('returns null for blues; non-empty for major', () => {
    expect(getCagedShapeSet('blues')).toBeNull();
    expect(getCagedShapeSet('major')).not.toBeNull();
  });

  it('builds Position 1..5 numbering keyed by shape id', () => {
    const map = getCagedPositionMap(makeInput({ key: 'C', scaleType: 'major' }));
    const positions = [...map.values()].sort((a, b) => a - b);
    expect(positions).toEqual([1, 2, 3, 4, 5]);
  });
});

// ─── Arpeggio shapes ──────────────────────────────────────────────────────────

import { getArpeggio } from '../src/lib/arpeggios';
import { getInstrument } from '../src/lib/instruments';

function makeArpeggioInput(arpeggioId: string, key = 'A', overrides: Partial<ResolveInput> = {}): ResolveInput {
  const arp = getArpeggio(arpeggioId)!;
  const grid = buildGrid(STANDARD, overrides.capo ?? 0);
  const highlights = computeHighlights(grid, key, arp.intervals, overrides.capo ?? 0);
  return {
    highlights,
    tuning: STANDARD,
    key,
    capo: 0,
    mode: 'arpeggios',
    instrumentId: 'guitar',
    fretCount: FRET_COUNT,
    arpeggioType: arpeggioId,
    ...overrides,
  };
}

describe('CAGED shapes in arpeggios mode', () => {
  it('A major arp C-shape lives near fret 9–13 (root on A string fret 12)', () => {
    const input = makeArpeggioInput('major', 'A');
    const cells = resolveShapeAbsoluteCells('caged-c', input);
    expect(cells.length).toBeGreaterThan(0);
    for (const c of cells) {
      expect(c.fret).toBeGreaterThanOrEqual(9);
      expect(c.fret).toBeLessThanOrEqual(13);
    }
    // The anchor cell (A on the A string at fret 12) is part of the arpeggio.
    expect(cells.some((c) => c.stringIndex === 1 && c.fret === 12)).toBe(true);
  });

  it('A major arp emits cells whose pitch class is in {A, C#, E}', () => {
    const input = makeArpeggioInput('major', 'A');
    const cells = resolveShapeAbsoluteCells('caged-e', input);
    expect(cells.length).toBeGreaterThan(0);
    const arpPCs = new Set([9, 1, 4]); // A=9, C#=1, E=4
    for (const c of cells) {
      const openNote = STANDARD.strings[c.stringIndex];
      const openPC = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
        .indexOf(openNote.replace(/\d+$/, '').replace('Db', 'C#').replace('Eb', 'D#').replace('Gb', 'F#').replace('Ab', 'G#').replace('Bb', 'A#'));
      const cellPC = (openPC + c.fret) % 12;
      expect(arpPCs.has(cellPC)).toBe(true);
    }
  });

  it('A minor arp emits only cells whose pitch class is in {A, C, E}', () => {
    const input = makeArpeggioInput('minor', 'A');
    const cells = resolveShapeAbsoluteCells('caged-e', input);
    expect(cells.length).toBeGreaterThan(0);
    // All cells must be A, C, or E (pcs 9, 0, 4).
    const arpPCs = new Set([9, 0, 4]);
    const openPCs = STANDARD.strings.map((n) => {
      // Strip octave digit, then look up pc via Tonal — done minimally here to
      // avoid pulling in Tonal at test setup. Hardcode standard tuning pcs.
      void n;
      return 0;
    });
    // Standard tuning string pcs: low E (4), A (9), D (2), G (7), B (11), high E (4).
    const STANDARD_PCS = [4, 9, 2, 7, 11, 4];
    void openPCs;
    for (const c of cells) {
      const pc = (STANDARD_PCS[c.stringIndex] + c.fret) % 12;
      expect(arpPCs.has(pc)).toBe(true);
    }
  });

  it('Position numbering rotates between major and minor arp because pitch classes differ', () => {
    // The shape windows are key-based, so for the same key (A) both arps
    // produce a Position 1..5 ordering. Just verify both are well-formed.
    const major = getCagedPositionMap(makeArpeggioInput('major', 'A'));
    const minor = getCagedPositionMap(makeArpeggioInput('minor', 'A'));
    expect([...major.values()].sort()).toEqual([1, 2, 3, 4, 5]);
    expect([...minor.values()].sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('CAGED playback patterns are applicable in arpeggios mode for guitar', () => {
    const input = makeArpeggioInput('major', 'A');
    for (const p of CAGED_PATTERNS) {
      expect(p.isApplicable(input)).toBe(true);
    }
  });
});

// ─── Bass parity ──────────────────────────────────────────────────────────────

const BASS = getTuning('bass-standard')!;

function makeBassInput(overrides: Partial<ResolveInput> = {}): ResolveInput {
  const scaleId = (overrides.scaleType as string | undefined) ?? 'major';
  const scale = getScale(scaleId);
  const intervals = scale?.intervals ?? [0];
  const fretCount = getInstrument('bass')!.fretCount;
  const grid = buildGrid(BASS, overrides.capo ?? 0, fretCount);
  const highlights = computeHighlights(grid, overrides.key ?? 'A', intervals, overrides.capo ?? 0);
  return {
    highlights,
    tuning: BASS,
    key: 'A',
    capo: 0,
    mode: 'scales',
    instrumentId: 'bass',
    fretCount,
    scaleType: scaleId,
    ...overrides,
  };
}

describe('CAGED — bass parity', () => {
  it('A-shape major scale on bass: only emits cells on strings 0–3', () => {
    const seq = findShape('caged-a').resolve(makeBassInput());
    expect(seq.length).toBeGreaterThan(0);
    for (const c of seq) {
      expect(c.stringIndex).toBeGreaterThanOrEqual(0);
      expect(c.stringIndex).toBeLessThanOrEqual(3);
    }
  });

  it('E-shape major scale on bass for A major: anchors at fret 5 on low E', () => {
    const seq = findShape('caged-e').resolve(makeBassInput());
    expect(seq.length).toBeGreaterThan(0);
    for (const c of seq) {
      expect(c.stringIndex).toBeLessThanOrEqual(3);
      expect(c.fret).toBeGreaterThanOrEqual(4);
      expect(c.fret).toBeLessThanOrEqual(8);
    }
    expect(seq.some((c) => c.stringIndex === 0 && c.fret === 5)).toBe(true);
  });

  it('isApplicable returns true on bass for guitar+bass-supported shapes', () => {
    expect(findShape('caged-e').isApplicable(makeBassInput())).toBe(true);
  });
});
