/**
 * CAGED chord shape definitions.
 *
 * Five movable voicings per chord quality, mirroring the major-scale CAGED
 * system. Each shape is hand-authored as a list of cells with `stringIndex`,
 * `offset` (fret relative to the shape's anchor root), and `degree` (chord
 * tone identity: 1, 3, ♭3, 5, ♭7, 7).
 *
 * Resolution: locate the root pitch class on the shape's `anchorString` at the
 * lowest valid fret where the cells fit within `[capo, fretCount]`; emit
 * absolute `(stringIndex, fret)` cells, dropping any with `stringIndex >=
 * stringCount` (bass support).
 *
 * Coverage:
 *   - major: all 5 shapes (C/A/G/E/D) — standard CAGED voicings.
 *   - dom7:  all 5 shapes — standard.
 *   - maj7:  all 5 shapes — standard.
 *   - minor, min7: derived at runtime from major / dom7 by lowering every
 *     degree '3' cell by 1 semitone and relabeling it 'b3'.
 *   - 9th chords (dom9, maj9, min9): NOT included — the 5-shape CAGED system
 *     for 9ths isn't standardized in pedagogy. Clean voicings exist only for
 *     1-3 of the 5 shapes per 9th quality. Tracked as a follow-up.
 */
import type { ResolveInput } from '../types';
import type { TuningDef } from '../../types';
import { pitchClass } from '../../lib/theory';

export type ChordDegree = '1' | '3' | 'b3' | '5' | 'b7' | '7';

export type ChordQuality =
  | 'major'
  | 'minor'
  | 'dom7'
  | 'maj7'
  | 'min7';

export type CagedChordLetter = 'C' | 'A' | 'G' | 'E' | 'D';

export interface CagedChordCell {
  readonly stringIndex: number;
  readonly offset: number;
  readonly degree: ChordDegree;
}

export interface CagedChordShape {
  readonly letter: CagedChordLetter;
  readonly anchorString: number;
  readonly cells: readonly CagedChordCell[];
}

// ─── Major triads ─────────────────────────────────────────────────────────────

const C_SHAPE_MAJOR: CagedChordShape = {
  letter: 'C',
  anchorString: 1, // A string
  cells: [
    { stringIndex: 1, offset: 0, degree: '1' },
    { stringIndex: 2, offset: -1, degree: '3' },
    { stringIndex: 3, offset: -3, degree: '5' },
    { stringIndex: 4, offset: -2, degree: '1' },
    { stringIndex: 5, offset: -3, degree: '3' },
  ],
};

const A_SHAPE_MAJOR: CagedChordShape = {
  letter: 'A',
  anchorString: 1,
  cells: [
    { stringIndex: 1, offset: 0, degree: '1' },
    { stringIndex: 2, offset: 2, degree: '5' },
    { stringIndex: 3, offset: 2, degree: '1' },
    { stringIndex: 4, offset: 2, degree: '3' },
    { stringIndex: 5, offset: 0, degree: '5' },
  ],
};

const G_SHAPE_MAJOR: CagedChordShape = {
  letter: 'G',
  anchorString: 0, // low E
  cells: [
    { stringIndex: 0, offset: 0, degree: '1' },
    { stringIndex: 1, offset: -1, degree: '3' },
    { stringIndex: 2, offset: -3, degree: '5' },
    { stringIndex: 3, offset: -3, degree: '1' },
    { stringIndex: 4, offset: -3, degree: '3' },
    { stringIndex: 5, offset: 0, degree: '1' },
  ],
};

const E_SHAPE_MAJOR: CagedChordShape = {
  letter: 'E',
  anchorString: 0,
  cells: [
    { stringIndex: 0, offset: 0, degree: '1' },
    { stringIndex: 1, offset: 2, degree: '5' },
    { stringIndex: 2, offset: 2, degree: '1' },
    { stringIndex: 3, offset: 1, degree: '3' },
    { stringIndex: 4, offset: 0, degree: '5' },
    { stringIndex: 5, offset: 0, degree: '1' },
  ],
};

const D_SHAPE_MAJOR: CagedChordShape = {
  letter: 'D',
  anchorString: 2, // D string
  cells: [
    { stringIndex: 2, offset: 0, degree: '1' },
    { stringIndex: 3, offset: 2, degree: '5' },
    { stringIndex: 4, offset: 3, degree: '1' },
    { stringIndex: 5, offset: 2, degree: '3' },
  ],
};

const MAJOR_CHORDS: readonly CagedChordShape[] = [
  C_SHAPE_MAJOR,
  A_SHAPE_MAJOR,
  G_SHAPE_MAJOR,
  E_SHAPE_MAJOR,
  D_SHAPE_MAJOR,
];

// ─── Dominant 7 ───────────────────────────────────────────────────────────────

const C_SHAPE_DOM7: CagedChordShape = {
  letter: 'C',
  anchorString: 1,
  cells: [
    { stringIndex: 1, offset: 0, degree: '1' },
    { stringIndex: 2, offset: -1, degree: '3' },
    { stringIndex: 3, offset: 0, degree: 'b7' },
    { stringIndex: 4, offset: -2, degree: '1' },
    { stringIndex: 5, offset: -3, degree: '3' },
  ],
};

const A_SHAPE_DOM7: CagedChordShape = {
  letter: 'A',
  anchorString: 1,
  cells: [
    { stringIndex: 1, offset: 0, degree: '1' },
    { stringIndex: 2, offset: 2, degree: '5' },
    { stringIndex: 3, offset: 0, degree: 'b7' },
    { stringIndex: 4, offset: 2, degree: '3' },
    { stringIndex: 5, offset: 0, degree: '5' },
  ],
};

const G_SHAPE_DOM7: CagedChordShape = {
  letter: 'G',
  anchorString: 0,
  cells: [
    { stringIndex: 0, offset: 0, degree: '1' },
    { stringIndex: 1, offset: -1, degree: '3' },
    { stringIndex: 2, offset: -3, degree: '5' },
    { stringIndex: 3, offset: -3, degree: '1' },
    { stringIndex: 4, offset: -3, degree: '3' },
    { stringIndex: 5, offset: -2, degree: 'b7' },
  ],
};

const E_SHAPE_DOM7: CagedChordShape = {
  letter: 'E',
  anchorString: 0,
  cells: [
    { stringIndex: 0, offset: 0, degree: '1' },
    { stringIndex: 1, offset: 2, degree: '5' },
    { stringIndex: 2, offset: 0, degree: 'b7' },
    { stringIndex: 3, offset: 1, degree: '3' },
    { stringIndex: 4, offset: 0, degree: '5' },
    { stringIndex: 5, offset: 0, degree: '1' },
  ],
};

const D_SHAPE_DOM7: CagedChordShape = {
  letter: 'D',
  anchorString: 2,
  cells: [
    { stringIndex: 2, offset: 0, degree: '1' },
    { stringIndex: 3, offset: 2, degree: '5' },
    { stringIndex: 4, offset: 1, degree: 'b7' },
    { stringIndex: 5, offset: 2, degree: '3' },
  ],
};

const DOM7_CHORDS: readonly CagedChordShape[] = [
  C_SHAPE_DOM7,
  A_SHAPE_DOM7,
  G_SHAPE_DOM7,
  E_SHAPE_DOM7,
  D_SHAPE_DOM7,
];

// ─── Major 7 ──────────────────────────────────────────────────────────────────

const C_SHAPE_MAJ7: CagedChordShape = {
  letter: 'C',
  anchorString: 1,
  cells: [
    { stringIndex: 1, offset: 0, degree: '1' },
    { stringIndex: 2, offset: -1, degree: '3' },
    { stringIndex: 3, offset: -3, degree: '5' },
    { stringIndex: 4, offset: -3, degree: '7' },
    { stringIndex: 5, offset: -3, degree: '3' },
  ],
};

const A_SHAPE_MAJ7: CagedChordShape = {
  letter: 'A',
  anchorString: 1,
  cells: [
    { stringIndex: 1, offset: 0, degree: '1' },
    { stringIndex: 2, offset: 2, degree: '5' },
    { stringIndex: 3, offset: 1, degree: '7' },
    { stringIndex: 4, offset: 2, degree: '3' },
    { stringIndex: 5, offset: 0, degree: '5' },
  ],
};

const G_SHAPE_MAJ7: CagedChordShape = {
  letter: 'G',
  anchorString: 0,
  cells: [
    { stringIndex: 0, offset: 0, degree: '1' },
    { stringIndex: 1, offset: -1, degree: '3' },
    { stringIndex: 2, offset: -3, degree: '5' },
    { stringIndex: 3, offset: -3, degree: '1' },
    { stringIndex: 4, offset: -3, degree: '3' },
    { stringIndex: 5, offset: -1, degree: '7' },
  ],
};

const E_SHAPE_MAJ7: CagedChordShape = {
  letter: 'E',
  anchorString: 0,
  cells: [
    { stringIndex: 0, offset: 0, degree: '1' },
    { stringIndex: 1, offset: 2, degree: '5' },
    { stringIndex: 2, offset: 1, degree: '7' },
    { stringIndex: 3, offset: 1, degree: '3' },
    { stringIndex: 4, offset: 0, degree: '5' },
    { stringIndex: 5, offset: 0, degree: '1' },
  ],
};

const D_SHAPE_MAJ7: CagedChordShape = {
  letter: 'D',
  anchorString: 2,
  cells: [
    { stringIndex: 2, offset: 0, degree: '1' },
    { stringIndex: 3, offset: 2, degree: '5' },
    { stringIndex: 4, offset: 2, degree: '7' },
    { stringIndex: 5, offset: 2, degree: '3' },
  ],
};

const MAJ7_CHORDS: readonly CagedChordShape[] = [
  C_SHAPE_MAJ7,
  A_SHAPE_MAJ7,
  G_SHAPE_MAJ7,
  E_SHAPE_MAJ7,
  D_SHAPE_MAJ7,
];

// ─── Derivations: minor (from major), min7 (from dom7) ────────────────────────

function lowerThirds(shape: CagedChordShape): CagedChordShape {
  return {
    ...shape,
    cells: shape.cells.map((c) =>
      c.degree === '3' ? { ...c, offset: c.offset - 1, degree: 'b3' as const } : c,
    ),
  };
}

const MINOR_CHORDS: readonly CagedChordShape[] = MAJOR_CHORDS.map(lowerThirds);
const MIN7_CHORDS: readonly CagedChordShape[] = DOM7_CHORDS.map(lowerThirds);

// ─── Public lookup ────────────────────────────────────────────────────────────

const SHAPES_BY_QUALITY: Record<ChordQuality, readonly CagedChordShape[]> = {
  major: MAJOR_CHORDS,
  minor: MINOR_CHORDS,
  dom7: DOM7_CHORDS,
  maj7: MAJ7_CHORDS,
  min7: MIN7_CHORDS,
};

export function getCagedChordShape(
  letter: CagedChordLetter,
  quality: ChordQuality,
): CagedChordShape | null {
  const set = SHAPES_BY_QUALITY[quality];
  return set.find((s) => s.letter === letter) ?? null;
}

// ─── Resolution to absolute cells ────────────────────────────────────────────

/** Minimum cells (after string-count and capo filtering) required to consider
 *  an anchor fret "usable" for a chord. Triads have 3-5 cells in their full
 *  voicings; on bass some shapes drop to 2-3 cells. We use 3 as the floor —
 *  enough to be a real chord but permissive enough that bass D-shapes work. */
const MIN_CHORD_CELLS = 3;

export interface ResolvedChordCell {
  readonly stringIndex: number;
  readonly fret: number;
  readonly degree: ChordDegree;
}

/**
 * Resolve a CAGED chord shape into absolute cells in the given context.
 * Returns the cells from the lowest valid anchor occurrence (lowest fret where
 * the shape fits with at least MIN_CHORD_CELLS cells). Empty when no valid
 * anchor exists.
 */
export function resolveCagedChordCells(
  letter: CagedChordLetter,
  quality: ChordQuality,
  ctx: {
    tuning: TuningDef;
    key: string;
    capo: number;
    fretCount: number;
    stringCount: number;
  },
): readonly ResolvedChordCell[] {
  const shape = getCagedChordShape(letter, quality);
  if (!shape) return [];

  const openNote = ctx.tuning.strings[shape.anchorString];
  if (!openNote) return [];
  const openNotePC = pitchClass(openNote);
  const rootPC = pitchClass(ctx.key);

  for (let f = ctx.capo; f <= ctx.fretCount; f++) {
    if ((openNotePC + f) % 12 !== rootPC) continue;
    const cells: ResolvedChordCell[] = [];
    for (const c of shape.cells) {
      if (c.stringIndex >= ctx.stringCount) continue;
      const fret = f + c.offset;
      if (fret < ctx.capo || fret > ctx.fretCount) continue;
      cells.push({ stringIndex: c.stringIndex, fret, degree: c.degree });
    }
    if (cells.length >= MIN_CHORD_CELLS) return cells;
  }
  return [];
}

/** Letters in the canonical CAGED display order. */
export const CAGED_CHORD_LETTERS: readonly CagedChordLetter[] = ['C', 'A', 'G', 'E', 'D'];

/** Qualities currently supported by the chord resolver, in popover display order. */
export const SUPPORTED_CHORD_QUALITIES: readonly ChordQuality[] = [
  'major',
  'minor',
  'dom7',
  'maj7',
  'min7',
];

// Re-export ResolveInput so callers that import from this module don't need a
// second import line. (Not strictly required; kept for ergonomic parity with
// caged-shapes-data.ts which doesn't currently do this. Drop if unused.)
export type { ResolveInput };
