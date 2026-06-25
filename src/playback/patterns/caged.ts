/**
 * CAGED playback patterns — five hand-authored scale boxes positioned per-key.
 *
 * For each shape (C/A/G/E/D), the resolver:
 *   1. Determines the shape's anchor pitch class (the tonic of the parent major for
 *      modes/pentatonics, or the scale's own tonic for major / harmonic minor /
 *      melodic minor).
 *   2. Finds the lowest occurrence of that pitch class on the shape's anchor string
 *      such that every cell of the shape lands within the playable range
 *      `[capo, fretCount]`.
 *   3. Emits absolute `(stringIndex, fret)` cells, optionally filtered by degree for
 *      pentatonics.
 *   4. Builds an "up-and-down" sequence: ascending string-by-string (each string's
 *      cells in fret-ascending order), then descending string-by-string (each string's
 *      cells in fret-descending order). The apex note isn't repeated.
 *
 * Shape names in the dropdown are computed per-key as `Position N — X shape` where
 * the position number reflects how the box ranks against the other 4 shapes by
 * lowest fret in the active key.
 */
import type { PlaybackPattern, ResolveInput } from '../types';
import type { CagedShape, CagedShapeId, CagedLetter } from './caged-shapes-data';
import {
  MAJOR_CAGED_SHAPES,
  HARMONIC_MINOR_CAGED_SHAPES,
  MELODIC_MINOR_CAGED_SHAPES,
} from './caged-shapes-data';
import { pitchClass } from '../../lib/theory';
import { buildUpAndDown } from './up-and-down';
import { getInstrument } from '../../lib/instruments';

// ─── Scale-family helpers ──────────────────────────────────────────────────────

/**
 * Pitch-class offset (semitones) from the active scale's tonic to the parent major's
 * tonic, by scale id. For modes of the major scale, the parent major's tonic is the
 * note a specific number of semitones below the mode's root (e.g. D Dorian → C major,
 * which is 2 semitones below D). For relative minor / minor pentatonic, the parent
 * major is 3 semitones above (relative-major relationship).
 *
 * Scales not listed are unsupported by CAGED and the pattern will return empty.
 */
function parentMajorOffsetFor(scaleId: string | undefined): number | null {
  switch (scaleId) {
    case 'major':
    case 'major-pentatonic':
    case 'harmonic-minor':
    case 'melodic-minor':
      return 0;
    case 'dorian':
      return -2; // dorian is the 2nd of parent major
    case 'phrygian':
      return -4; // 3rd of parent
    case 'lydian':
      return -5; // 4th
    case 'mixolydian':
      return -7; // 5th
    case 'minor':
    case 'minor-pentatonic':
      return +3; // relative major is 3 semitones up from the minor tonic
    case 'locrian':
      return +1; // locrian is the 7th of parent; parent is a half-step up
    default:
      return null;
  }
}

function shapeSetFor(scaleId: string | undefined): readonly CagedShape[] | null {
  if (!scaleId) return null;
  if (scaleId === 'harmonic-minor') return HARMONIC_MINOR_CAGED_SHAPES;
  if (scaleId === 'melodic-minor') return MELODIC_MINOR_CAGED_SHAPES;
  if (parentMajorOffsetFor(scaleId) != null) return MAJOR_CAGED_SHAPES;
  return null;
}

/** Resolve the right shape set for the active mode + type. Arpeggios always use
 *  the major shape set as a positioning template — actual cell content is
 *  intersected with the active highlights to filter to arp-only pitch classes. */
function shapeSetForInput(input: { mode: string; scaleType?: string; arpeggioType?: string }): readonly CagedShape[] | null {
  if (input.mode === 'arpeggios') {
    return input.arpeggioType ? MAJOR_CAGED_SHAPES : null;
  }
  return shapeSetFor(input.scaleType);
}

/** Public: which CAGED shape set applies to a given scale id (or null when CAGED
 *  doesn't apply, e.g. blues). Used by UI to decide whether to surface the shape
 *  selector at all. */
export function getCagedShapeSet(scaleId: string | undefined): readonly CagedShape[] | null {
  return shapeSetFor(scaleId);
}

/** Public: shape set for any (mode, type) — handles arpeggios as well. */
export function getCagedShapeSetForInput(input: {
  mode: string;
  scaleType?: string;
  arpeggioType?: string;
}): readonly CagedShape[] | null {
  return shapeSetForInput(input);
}

/** Pentatonic scales are major-shape-derived but only emit cells at degrees 1,2,3,5,6
 *  (which, in the parent major's degree space, is the major pentatonic — and that's
 *  also the minor pentatonic's note set when anchored at the parent major's tonic). */
const PENTATONIC_DEGREES: ReadonlySet<number> = new Set([1, 2, 3, 5, 6]);
function isPentatonic(scaleId: string | undefined): boolean {
  return scaleId === 'major-pentatonic' || scaleId === 'minor-pentatonic';
}

// ─── Anchor positioning ────────────────────────────────────────────────────────

export interface AbsoluteCell {
  readonly stringIndex: number;
  readonly fret: number;
  readonly degree: number;
}

interface ResolvedShape {
  readonly anchorFret: number;
  readonly cells: readonly AbsoluteCell[];
  /** Lowest fret occupied by any cell — used for sorting shapes into Position N order. */
  readonly minFret: number;
  /** Highest fret occupied by any cell. */
  readonly maxFret: number;
}

const MIN_CELLS_FOR_VALID_ANCHOR_GUITAR = 8;

/** Minimum playable cells required to consider an anchor "usable", scaled to
 *  the active instrument's string count. The constant 8 was chosen for 6-string
 *  shapes (~15 cells total); on 4-string bass the truncated box has fewer
 *  cells, so we scale proportionally to keep the same "most of the box must
 *  fit" gate. */
function minCellsForAnchor(stringCount: number): number {
  return Math.max(4, Math.ceil((MIN_CELLS_FOR_VALID_ANCHOR_GUITAR * stringCount) / 6));
}

/**
 * Find the lowest fret on `anchorString` where the root pitch class lands such that
 * the shape has at least `minCellsForAnchor(stringCount)` cells inside `[capo, fretCount]`.
 * Cells that fall outside that range are dropped by `resolveShapeCells`; this function
 * just decides which anchor produces a recognizable box.
 *
 * Walking from `capo` upward means we always pick the lowest neck position where the
 * shape is playable.
 */
function findValidAnchorFret(
  shape: CagedShape,
  rootPC: number,
  openNotePC: number,
  capo: number,
  fretCount: number,
  stringCount: number,
): number | null {
  let maxOff = -Infinity;
  for (const c of shape.cells) {
    if (c.stringIndex >= stringCount) continue;
    if (c.offset > maxOff) maxOff = c.offset;
  }
  const minCells = minCellsForAnchor(stringCount);
  for (let f = capo; f <= fretCount; f++) {
    const pc = (openNotePC + f) % 12;
    if (pc !== rootPC) continue;
    // Anchor cell must itself be reachable (root note in playable range).
    if (f + maxOff > fretCount) continue;
    // Count cells that land in the playable range.
    let fits = 0;
    for (const c of shape.cells) {
      if (c.stringIndex >= stringCount) continue;
      const fret = f + c.offset;
      if (fret >= capo && fret <= fretCount) fits++;
    }
    if (fits >= minCells) return f;
  }
  return null;
}

/** Build the absolute cells for a shape positioned at the given anchor fret. Drops
 *  cells that fall outside `[capo, fretCount]` (e.g. open-position shapes whose
 *  lower offsets land behind the nut), and drops cells on strings beyond `stringCount`
 *  (for shorter instruments like bass). Applies the pentatonic-degree filter when
 *  requested. Returns null if no cells survive. */
function resolveShapeCells(
  shape: CagedShape,
  anchorFret: number,
  capo: number,
  fretCount: number,
  stringCount: number,
  pentatonic: boolean,
): ResolvedShape | null {
  const cells: AbsoluteCell[] = [];
  let minFret = Infinity;
  let maxFret = -Infinity;
  for (const c of shape.cells) {
    if (c.stringIndex >= stringCount) continue;
    if (pentatonic && !PENTATONIC_DEGREES.has(c.degree)) continue;
    const fret = anchorFret + c.offset;
    if (fret < capo || fret > fretCount) continue;
    cells.push({ stringIndex: c.stringIndex, fret, degree: c.degree });
    if (fret < minFret) minFret = fret;
    if (fret > maxFret) maxFret = fret;
  }
  if (cells.length === 0) return null;
  return { anchorFret, cells, minFret, maxFret };
}

/** Resolve a shape end-to-end given a ResolveInput. Returns null when the shape
 *  isn't usable (wrong scale family, no valid anchor, empty after filter).
 *
 *  Two paths:
 *   - **Scales mode**: anchor at parent major's tonic, emit shape.cells (offsets
 *     applied to anchor fret), optionally filtered by pentatonic degree.
 *   - **Arpeggios mode**: anchor at the arpeggio's root, compute the shape's
 *     fret window from min/max offsets, emit cells from `input.highlights` that
 *     fall inside the window. Highlights already encode the arpeggio's pitch
 *     classes, so the window is the only thing the shape contributes to the
 *     filter — no per-cell shape data needed for arpeggios. */
function resolveShape(shape: CagedShape, input: ResolveInput): ResolvedShape | null {
  if (input.mode === 'arpeggios') {
    return resolveArpeggioShape(shape, input);
  }
  const { tuning, key, capo, fretCount, scaleType, instrumentId } = input;
  const offset = parentMajorOffsetFor(scaleType);
  if (offset == null) return null;
  const keyPC = pitchClass(key);
  const anchorPC = (((keyPC + offset) % 12) + 12) % 12;

  const openNote = tuning.strings[shape.anchorString];
  if (!openNote) return null;
  const openNotePC = pitchClass(openNote);

  const stringCount = getInstrument(instrumentId)?.stringCount ?? tuning.strings.length;
  const anchorFret = findValidAnchorFret(shape, anchorPC, openNotePC, capo, fretCount, stringCount);
  if (anchorFret == null) return null;

  return resolveShapeCells(shape, anchorFret, capo, fretCount, stringCount, isPentatonic(scaleType));
}

/** Arpeggio path: anchor at root pc, slice highlights by the shape's fret window. */
function resolveArpeggioShape(shape: CagedShape, input: ResolveInput): ResolvedShape | null {
  const { tuning, key, capo, fretCount, highlights, arpeggioType, instrumentId } = input;
  if (!arpeggioType) return null;
  const keyPC = pitchClass(key);

  const openNote = tuning.strings[shape.anchorString];
  if (!openNote) return null;
  const openNotePC = pitchClass(openNote);

  const stringCount = getInstrument(instrumentId)?.stringCount ?? tuning.strings.length;

  // Anchor at the arpeggio's root pitch class. Validity is still gauged by the
  // major-shape's cell layout — that ensures the resulting box is recognisable,
  // even though the arpeggio itself fills only some of those cells.
  const anchorFret = findValidAnchorFret(shape, keyPC, openNotePC, capo, fretCount, stringCount);
  if (anchorFret == null) return null;

  let minOff = Infinity;
  let maxOff = -Infinity;
  for (const c of shape.cells) {
    if (c.stringIndex >= stringCount) continue;
    if (c.offset < minOff) minOff = c.offset;
    if (c.offset > maxOff) maxOff = c.offset;
  }
  const minFretWindow = Math.max(capo, anchorFret + minOff);
  const maxFretWindow = Math.min(fretCount, anchorFret + maxOff);

  // Filter the active highlights (which already encode the arpeggio's cells) to
  // the box. This unifies arpeggio and scale rendering — the window comes from
  // the shape, the actual cells come from the highlights.
  const cells: AbsoluteCell[] = [];
  let minFret = Infinity;
  let maxFret = -Infinity;
  for (const h of highlights) {
    if (h.stringIndex >= stringCount) continue;
    if (h.fret < minFretWindow || h.fret > maxFretWindow) continue;
    cells.push({ stringIndex: h.stringIndex, fret: h.fret, degree: h.degreeNumber });
    if (h.fret < minFret) minFret = h.fret;
    if (h.fret > maxFret) maxFret = h.fret;
  }
  if (cells.length === 0) return null;
  return { anchorFret, cells, minFret, maxFret };
}

/**
 * Public wrapper: resolve a shape by id, returning the absolute cells (with
 * `degree` retained) that make up that shape in the given context. Used by both
 * the playback resolver (to walk only shape cells) and the fretboard renderer
 * (to know which highlights to emphasize / ghost). Returns an empty array when
 * the shape isn't applicable (wrong scale family, no valid anchor on this neck).
 */
export function resolveShapeAbsoluteCells(
  shapeId: CagedShapeId,
  input: ResolveInput,
): readonly AbsoluteCell[] {
  const set = shapeSetForInput(input);
  if (!set) return [];
  const shape = set.find((s) => s.id === shapeId);
  if (!shape) return [];
  const resolved = resolveShape(shape, input);
  return resolved?.cells ?? [];
}

/** Public: per-key Position 1..5 numbering for each shape in the active state.
 *  Surfaced for the TopBar shape selector and pattern dropdown labels. */
export function getCagedPositionMap(input: ResolveInput): Map<CagedShapeId, number> {
  return buildPositionMap(input);
}

// ─── Per-key Position numbering ────────────────────────────────────────────────

/**
 * Compute Position 1..5 for each shape in the active key, sorted by lowest fret of
 * the resolved box. Shapes that don't resolve in the current state get position null.
 *
 * Cached on the input identity — Playback re-resolves when the input changes anyway,
 * so a fresh map per resolve call is acceptable.
 */
function buildPositionMap(input: ResolveInput): Map<CagedShapeId, number> {
  const set = shapeSetForInput(input);
  if (!set) return new Map();

  const positions: Array<{ id: CagedShapeId; minFret: number }> = [];
  for (const shape of set) {
    const resolved = resolveShape(shape, input);
    if (resolved) positions.push({ id: shape.id, minFret: resolved.minFret });
  }
  positions.sort((a, b) => a.minFret - b.minFret);

  const map = new Map<CagedShapeId, number>();
  positions.forEach((p, i) => {
    map.set(p.id, i + 1);
  });
  return map;
}

// ─── Pattern construction ─────────────────────────────────────────────────────

/** Pretty name for the dropdown — `Position N — X shape`, or just `X shape` if the
 *  position number can't be computed (shape not currently applicable). */
function displayName(letter: CagedLetter, position: number | null): string {
  if (position == null) return `${letter} shape`;
  return `Position ${position} — ${letter} shape`;
}

function buildCagedPattern(letter: CagedLetter, id: CagedShapeId): PlaybackPattern {
  return {
    id,
    name: `${letter} shape`,
    group: 'CAGED',
    applicableInstruments: ['guitar', 'bass'],
    isApplicable: (input) => {
      if (input.instrumentId !== 'guitar' && input.instrumentId !== 'bass') return false;
      if (input.mode !== 'scales' && input.mode !== 'arpeggios') return false;
      const set = shapeSetForInput(input);
      if (!set) return false;
      const shape = set.find((s) => s.id === id);
      if (!shape) return false;
      const resolved = resolveShape(shape, input);
      return resolved != null && resolved.cells.length > 0;
    },
    resolve: (input) => {
      const set = shapeSetForInput(input);
      if (!set) return [];
      const shape = set.find((s) => s.id === id);
      if (!shape) return [];
      const resolved = resolveShape(shape, input);
      if (!resolved) return [];
      return buildUpAndDown(resolved.cells);
    },
    displayName: (input) => {
      const map = buildPositionMap(input);
      return displayName(letter, map.get(id) ?? null);
    },
  };
}

export const CAGED_PATTERNS: readonly PlaybackPattern[] = [
  buildCagedPattern('C', 'caged-c'),
  buildCagedPattern('A', 'caged-a'),
  buildCagedPattern('G', 'caged-g'),
  buildCagedPattern('E', 'caged-e'),
  buildCagedPattern('D', 'caged-d'),
];

export { CAGED_PATTERN_IDS, isCagedShapeId } from './caged-shapes-data';
