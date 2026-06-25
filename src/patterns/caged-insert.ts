/**
 * Builds an ordered insert plan for adding a CAGED shape to a pattern editor
 * timeline. Pure functions — no React, no store access, no audio. Input is a
 * `CagedInsertRequest`; output is a `CagedInsertPlan` of notes with tick
 * offsets relative to the insertion point.
 *
 * Three modes:
 *   - 'chord': every shape cell at offset 0, duration = step length.
 *   - 'scale': cells walked by the chosen traversal, one step per note.
 *   - 'arp':   cells = intersection of the arpeggio's highlights with the
 *               shape's fret window; walked by the chosen traversal.
 *
 * Bass support: cells beyond `stringCount - 1` are dropped before walking.
 * The CAGED playback resolver also respects `stringCount` (see Task 1), so a
 * shape that doesn't fit at all returns an empty plan.
 */
import type { TuningDef } from '../types';
import type { Tick } from './types';
import type { CagedShapeId } from '../playback/patterns/caged-shapes-data';
import type { AbsoluteCell } from '../playback/patterns/caged';
import { resolveShapeAbsoluteCells } from '../playback/patterns/caged';
import { buildUpAndDown } from '../playback/patterns/up-and-down';
import { buildGrid, computeHighlights, pitchOf } from '../lib/fretboard';
import { getArpeggio } from '../lib/arpeggios';
import {
  resolveCagedChordCells,
  type ChordQuality,
  type CagedChordLetter,
} from '../playback/patterns/caged-chord-shapes-data';

export type CagedInsertMode = 'chord' | 'scale' | 'arp';
export type CagedTraversal = 'ascending-pitch' | 'string-by-string' | 'up-and-down';

export type { ChordQuality };

export interface CagedInsertRequest {
  shapeId: CagedShapeId;
  mode: CagedInsertMode;
  key: string;
  scaleType?: string;
  arpeggioType?: string;
  /** Required when mode = 'chord'. Defaults to 'major' when omitted. */
  chordQuality?: ChordQuality;
  traversal?: CagedTraversal;
  tuning: TuningDef;
  capo: number;
  fretCount: number;
  stringCount: number;
}

export interface PlannedNote {
  stringIndex: number;
  fret: number;
  startTickOffset: Tick;
  durationTicks: Tick;
}

export interface CagedInsertPlan {
  readonly notes: readonly PlannedNote[];
  readonly totalTicks: Tick;
}

const EMPTY_PLAN: CagedInsertPlan = { notes: [], totalTicks: 0 };

export function isCagedInsertApplicable(req: CagedInsertRequest): boolean {
  return planCagedInsert(req, 1).notes.length > 0;
}

export function planCagedInsert(
  req: CagedInsertRequest,
  stepLengthTicks: Tick,
): CagedInsertPlan {
  const cells = resolveCellsFor(req);
  if (cells.length === 0) return EMPTY_PLAN;

  if (req.mode === 'chord') {
    return {
      notes: cells.map((c) => ({
        stringIndex: c.stringIndex,
        fret: c.fret,
        startTickOffset: 0,
        durationTicks: stepLengthTicks,
      })),
      totalTicks: stepLengthTicks,
    };
  }

  const traversal = req.traversal ?? 'string-by-string';
  const ordered = walk(cells, traversal, req.tuning);
  const notes = ordered.map((c, i) => ({
    stringIndex: c.stringIndex,
    fret: c.fret,
    startTickOffset: i * stepLengthTicks,
    durationTicks: stepLengthTicks,
  }));
  return { notes, totalTicks: notes.length * stepLengthTicks };
}

interface PositionedCell {
  readonly stringIndex: number;
  readonly fret: number;
}

function letterFromShapeId(id: CagedShapeId): CagedChordLetter {
  // 'caged-c' → 'C', etc.
  switch (id) {
    case 'caged-c': return 'C';
    case 'caged-a': return 'A';
    case 'caged-g': return 'G';
    case 'caged-e': return 'E';
    case 'caged-d': return 'D';
  }
}

function resolveCellsFor(req: CagedInsertRequest): readonly PositionedCell[] {
  if (req.mode === 'chord') {
    const quality = req.chordQuality ?? 'major';
    const cells = resolveCagedChordCells(letterFromShapeId(req.shapeId), quality, {
      tuning: req.tuning,
      key: req.key,
      capo: req.capo,
      fretCount: req.fretCount,
      stringCount: req.stringCount,
    });
    return cells;
  }
  if (req.mode === 'scale') {
    const scaleType = req.scaleType ?? 'major';
    const cells = resolveShapeAbsoluteCells(req.shapeId, {
      mode: 'scales',
      tuning: req.tuning,
      key: req.key,
      capo: req.capo,
      fretCount: req.fretCount,
      instrumentId: instrumentIdFor(req.stringCount),
      scaleType,
      highlights: [],
    });
    return filterByStringCount(cells, req.stringCount);
  }
  if (req.mode === 'arp') {
    const arpType = req.arpeggioType;
    if (!arpType) return [];
    const arp = getArpeggio(arpType);
    if (!arp) return [];
    const grid = buildGrid(req.tuning, req.capo, req.fretCount);
    const highlights = computeHighlights(grid, req.key, arp.intervals, req.capo);
    const cells = resolveShapeAbsoluteCells(req.shapeId, {
      mode: 'arpeggios',
      tuning: req.tuning,
      key: req.key,
      capo: req.capo,
      fretCount: req.fretCount,
      instrumentId: instrumentIdFor(req.stringCount),
      arpeggioType: arpType,
      highlights,
    });
    return filterByStringCount(cells, req.stringCount);
  }
  return [];
}

function filterByStringCount(
  cells: readonly AbsoluteCell[],
  stringCount: number,
): AbsoluteCell[] {
  return cells.filter((c) => c.stringIndex < stringCount);
}

function instrumentIdFor(stringCount: number): string {
  return stringCount <= 4 ? 'bass' : 'guitar';
}

function walk(
  cells: readonly PositionedCell[],
  traversal: CagedTraversal,
  tuning: TuningDef,
): readonly PositionedCell[] {
  if (traversal === 'string-by-string') return walkStringByString(cells);
  if (traversal === 'ascending-pitch') return walkAscendingPitch(cells, tuning);
  const walked = buildUpAndDown(cells);
  return walked;
}

function walkStringByString(cells: readonly PositionedCell[]): readonly PositionedCell[] {
  const byString = new Map<number, PositionedCell[]>();
  for (const c of cells) {
    const arr = byString.get(c.stringIndex);
    if (arr) arr.push(c);
    else byString.set(c.stringIndex, [c]);
  }
  const out: PositionedCell[] = [];
  const strings = [...byString.keys()].sort((a, b) => a - b);
  for (const s of strings) {
    const group = byString.get(s)!;
    group.sort((a, b) => a.fret - b.fret);
    out.push(...group);
  }
  return out;
}

function walkAscendingPitch(
  cells: readonly PositionedCell[],
  tuning: TuningDef,
): readonly PositionedCell[] {
  return [...cells].sort((a, b) => pitchOf(a, tuning) - pitchOf(b, tuning));
}
