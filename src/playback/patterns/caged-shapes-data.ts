/**
 * CAGED shape definitions — per-cell offset model.
 *
 * Each shape is a hand-authored list of cells expressed as `(stringIndex, offset, degree)`
 * where `offset` is the fret offset relative to the shape's anchor root. The shape's
 * anchor is a specific string + occurrence of the scale tonic; positioning the shape
 * means resolving `anchorFret = the chosen occurrence of the root pitch class on the
 * anchor string` and then emitting `(stringIndex, anchorFret + offset)` for every cell.
 *
 * The major shapes here are derived from the standard 5-position CAGED scale boxes
 * (Jens Larsen, MusicianPoster, etc. — see SPEC.md). Harmonic and melodic minor shapes
 * are derived from the major shapes by lowering specific scale degrees:
 *   - Harmonic minor = major with ♭3 and ♭6  → cells at degrees 3 and 6 shifted -1 fret.
 *   - Melodic minor  = major with ♭3 only    → cells at degree 3 shifted -1 fret.
 * Modes of the major scale and the relative-minor pentatonic share their parent's shape
 * positions; the resolver finds the parent major's tonic and uses major shapes anchored
 * there.
 *
 * Display order in this array determines the order shapes are checked when sorting by
 * fret position for "Position N" labelling.
 */
export type CagedShapeId = 'caged-c' | 'caged-a' | 'caged-g' | 'caged-e' | 'caged-d';
export type CagedLetter = 'C' | 'A' | 'G' | 'E' | 'D';

export interface CagedCell {
  /** 0 = low E, 5 = high E in standard 6-string layout. */
  readonly stringIndex: number;
  /** Fret offset relative to the shape's anchor root. */
  readonly offset: number;
  /** Scale degree (1..7) this cell represents in the parent major scale. Used to
   *  filter cells when deriving pentatonics, and to apply lowered-degree shifts when
   *  deriving harmonic/melodic minor. */
  readonly degree: 1 | 2 | 3 | 4 | 5 | 6 | 7;
}

export interface CagedShape {
  readonly id: CagedShapeId;
  readonly letter: CagedLetter;
  /** Which string carries the shape's primary anchor root. 0 = low E. */
  readonly anchorString: number;
  /** Cells that make up the shape. */
  readonly cells: readonly CagedCell[];
}

// ─── Major-scale CAGED shapes ──────────────────────────────────────────────────
// All offsets are relative to the shape's anchor root. Verified by hand against
// the C-major fretboard (anchor frets: C-shape 3 on A, A-shape 3 on A, G-shape 8
// on low E, E-shape 8 on low E, D-shape 10 on D).

export const C_SHAPE_MAJOR: CagedShape = {
  id: 'caged-c',
  letter: 'C',
  anchorString: 1, // A string
  cells: [
    // low E: E (3), F (4), G (5)
    { stringIndex: 0, offset: -3, degree: 3 },
    { stringIndex: 0, offset: -2, degree: 4 },
    { stringIndex: 0, offset: 0, degree: 5 },
    // A: A (6), B (7), C (1)
    { stringIndex: 1, offset: -3, degree: 6 },
    { stringIndex: 1, offset: -1, degree: 7 },
    { stringIndex: 1, offset: 0, degree: 1 },
    // D: D (2), E (3), F (4)
    { stringIndex: 2, offset: -3, degree: 2 },
    { stringIndex: 2, offset: -1, degree: 3 },
    { stringIndex: 2, offset: 0, degree: 4 },
    // G: G (5), A (6), B (7)
    { stringIndex: 3, offset: -3, degree: 5 },
    { stringIndex: 3, offset: -1, degree: 6 },
    // { stringIndex: 3, offset: 1, degree: 7 },
    // B: B (7), C (1), D (2)
    { stringIndex: 4, offset: -3, degree: 7 },
    { stringIndex: 4, offset: -2, degree: 1 },
    { stringIndex: 4, offset: 0, degree: 2 },
    // high E: E (3), F (4), G (5)
    { stringIndex: 5, offset: -3, degree: 3 },
    { stringIndex: 5, offset: -2, degree: 4 },
    { stringIndex: 5, offset: 0, degree: 5 },
  ],
};

export const A_SHAPE_MAJOR: CagedShape = {
  id: 'caged-a',
  letter: 'A',
  anchorString: 1, // A string
  cells: [
    // low E: G (5), A (6)
    { stringIndex: 0, offset: 0, degree: 5 },
    { stringIndex: 0, offset: 2, degree: 6 },
    // A: B (7), C (1), D (2)
    { stringIndex: 1, offset: -1, degree: 7 },
    { stringIndex: 1, offset: 0, degree: 1 },
    { stringIndex: 1, offset: 2, degree: 2 },
    // D: E (3), F (4), G (5)
    { stringIndex: 2, offset: -1, degree: 3 },
    { stringIndex: 2, offset: 0, degree: 4 },
    { stringIndex: 2, offset: 2, degree: 5 },
    // G: A (6), B (7), C (1)
    { stringIndex: 3, offset: -1, degree: 6 },
    { stringIndex: 3, offset: 1, degree: 7 },
    { stringIndex: 3, offset: 2, degree: 1 },
    // B: D (2), E (3), F (4)
    { stringIndex: 4, offset: 0, degree: 2 },
    { stringIndex: 4, offset: 2, degree: 3 },
    { stringIndex: 4, offset: 3, degree: 4 },
    // high E: G (5), A (6)
    { stringIndex: 5, offset: 0, degree: 5 },
    { stringIndex: 5, offset: 2, degree: 6 },
  ],
};

export const G_SHAPE_MAJOR: CagedShape = {
  id: 'caged-g',
  letter: 'G',
  anchorString: 0, // low E string
  cells: [
    // low E: A (6), B (7), C (1)
    { stringIndex: 0, offset: -3, degree: 6 },
    { stringIndex: 0, offset: -1, degree: 7 },
    { stringIndex: 0, offset: 0, degree: 1 },
    // A: D (2), E (3), F (4)
    { stringIndex: 1, offset: -3, degree: 2 },
    { stringIndex: 1, offset: -1, degree: 3 },
    { stringIndex: 1, offset: 0, degree: 4 },
    // D: G (5), A (6), B (7)
    { stringIndex: 2, offset: -3, degree: 5 },
    { stringIndex: 2, offset: -1, degree: 6 },
    // G: C (1), D (2), E (3)
    { stringIndex: 3, offset: -4, degree: 7 },
    { stringIndex: 3, offset: -3, degree: 1 },
    { stringIndex: 3, offset: -1, degree: 2 },
    // B: E (3), F (4), G (5)
    { stringIndex: 4, offset: -3, degree: 3 },
    { stringIndex: 4, offset: -2, degree: 4 },
    { stringIndex: 4, offset: 0, degree: 5 },
    // high E: A (6), B (7), C (1)
    { stringIndex: 5, offset: -3, degree: 6 },
    { stringIndex: 5, offset: -1, degree: 7 },
    { stringIndex: 5, offset: 0, degree: 1 },
  ],
};

export const E_SHAPE_MAJOR: CagedShape = {
  id: 'caged-e',
  letter: 'E',
  anchorString: 0, // low E string
  cells: [
    // low E: C (1), D (2)
    { stringIndex: 0, offset: 0, degree: 1 },
    { stringIndex: 0, offset: 2, degree: 2 },
    // A: E (3), F (4), G (5)
    { stringIndex: 1, offset: -1, degree: 3 },
    { stringIndex: 1, offset: 0, degree: 4 },
    { stringIndex: 1, offset: 2, degree: 5 },
    // D: A (6), B (7), C (1)
    { stringIndex: 2, offset: -1, degree: 6 },
    { stringIndex: 2, offset: 1, degree: 7 },
    { stringIndex: 2, offset: 2, degree: 1 },
    // G: D (2), E (3), F (4)
    { stringIndex: 3, offset: -1, degree: 2 },
    { stringIndex: 3, offset: 1, degree: 3 },
    { stringIndex: 3, offset: 2, degree: 4 },
    // B: G (5), A (6)
    { stringIndex: 4, offset: 0, degree: 5 },
    { stringIndex: 4, offset: 2, degree: 6 },
    // high E: B (7), C (1), D (2)
    { stringIndex: 5, offset: -1, degree: 7 },
    { stringIndex: 5, offset: 0, degree: 1 },
    { stringIndex: 5, offset: 2, degree: 2 },
  ],
};

export const D_SHAPE_MAJOR: CagedShape = {
  id: 'caged-d',
  letter: 'D',
  anchorString: 2, // D string
  cells: [
    // low E: D (2), E (3)
    { stringIndex: 0, offset: 0, degree: 2 },
    { stringIndex: 0, offset: 2, degree: 3 },
    { stringIndex: 0, offset: 3, degree: 4 },
    // A: G (5), A (6)
    { stringIndex: 1, offset: 0, degree: 5 },
    { stringIndex: 1, offset: 2, degree: 6 },
    // D: B (7), C (1), D (2)
    { stringIndex: 2, offset: -1, degree: 7 },
    { stringIndex: 2, offset: 0, degree: 1 },
    { stringIndex: 2, offset: 2, degree: 2 },
    // G: E (3), F (4), G (5)
    { stringIndex: 3, offset: -1, degree: 3 },
    { stringIndex: 3, offset: 0, degree: 4 },
    { stringIndex: 3, offset: 2, degree: 5 },
    // B: A (6), B (7), C (1)
    { stringIndex: 4, offset: 0, degree: 6 },
    { stringIndex: 4, offset: 2, degree: 7 },
    { stringIndex: 4, offset: 3, degree: 1 },
    // high E: D (2), E (3), F (4)
    { stringIndex: 5, offset: 0, degree: 2 },
    { stringIndex: 5, offset: 2, degree: 3 },
    { stringIndex: 5, offset: 3, degree: 4 },
  ],
};

/** Major-scale shapes in conventional CAGED order. */
export const MAJOR_CAGED_SHAPES: readonly CagedShape[] = [
  C_SHAPE_MAJOR,
  A_SHAPE_MAJOR,
  G_SHAPE_MAJOR,
  E_SHAPE_MAJOR,
  D_SHAPE_MAJOR,
];

// ─── Harmonic and melodic minor shapes (derived) ───────────────────────────────
// Harmonic minor = major with ♭3 and ♭6.
// Melodic minor (jazz)  = major with ♭3 only.
// Both share the major shapes' anchors and string layout — only specific cells move.

function shiftDegree(shape: CagedShape, degrees: ReadonlySet<number>): CagedShape {
  return {
    ...shape,
    cells: shape.cells.map((c) =>
      degrees.has(c.degree) ? { ...c, offset: c.offset - 1 } : c,
    ),
  };
}

const HM_DEGREES = new Set([3, 6]);
const MM_DEGREES = new Set([3]);

export const HARMONIC_MINOR_CAGED_SHAPES: readonly CagedShape[] =
  MAJOR_CAGED_SHAPES.map((s) => shiftDegree(s, HM_DEGREES));

export const MELODIC_MINOR_CAGED_SHAPES: readonly CagedShape[] =
  MAJOR_CAGED_SHAPES.map((s) => shiftDegree(s, MM_DEGREES));

export const CAGED_PATTERN_IDS: readonly CagedShapeId[] = MAJOR_CAGED_SHAPES.map((s) => s.id);

/** Type guard: narrows a possibly-invalid string to a known `CagedShapeId`. Use
 *  at boundaries where a `string | null | undefined` enters CAGED-aware code
 *  (URL params, store reads) instead of casting. */
export function isCagedShapeId(s: string | null | undefined): s is CagedShapeId {
  return s != null && (CAGED_PATTERN_IDS as readonly string[]).includes(s);
}
