/**
 * Pure operations on Pattern objects. None of these mutate inputs — they return new
 * objects. The store calls these inside its set() functions.
 *
 * Same-string overlap rule: a single guitar string can only physically ring at one
 * pitch at a time. We enforce this on commit (resize/move) — drag preview UI may show
 * overlap, but the final committed state never has two events on the same string with
 * overlapping [startTick, startTick + durationTicks) intervals.
 */
import type {
  GrooveSpec,
  Lane,
  Pattern,
  PatternEvent,
  PatternTimeSignature,
  Tick,
} from './types';
import type { IntervalSet, TuningDef } from '../types';
import { generateId, generateUuid } from './ids';
import { defaultPatternDurationTicks, ticksPerBar } from './timebase';
import { DEFAULT_INSTRUMENT_ID } from '../lib/instruments';
import { pitchOf } from '../lib/fretboard';
import { pitchClass } from '../lib/theory';

const DEFAULT_TS: PatternTimeSignature = { numerator: 4, denominator: 4 };

export function createEmptyPattern(
  name = 'Untitled pattern',
  instrumentId: string = DEFAULT_INSTRUMENT_ID,
): Pattern {
  const ts = { ...DEFAULT_TS };
  const now = Date.now();
  return {
    // UUID so the same id can be used as the Supabase row id when synced.
    id: generateUuid(),
    name,
    instrumentId,
    durationTicks: defaultPatternDurationTicks(ts),
    timeSignature: ts,
    events: [],
    lanes: [],
    suggestedBpm: null,
    groove: null,
    subdivision: null,
    loop: true,
    key: null,
    scaleType: null,
    description: null,
    difficulty: null,
    genres: [],
    tags: [],
    visibility: 'private',
    publishedAt: null,
    forkedFromId: null,
    forkedFromCreatorName: null,
    collectionId: null,
    tempoTrack: [],
    timeSignatureTrack: [],
    sourceIR: null,
    createdAt: now,
    updatedAt: now,
  };
}

/** Deep clone of a pattern with a fresh id and current timestamps. Used by both the
 *  library "duplicate" action and the composition's snapshot-on-place behavior. */
export function clonePattern(
  p: Pattern,
  overrides: Partial<Pick<Pattern, 'name' | 'id' | 'visibility' | 'forkedFromId' | 'forkedFromCreatorName' | 'collectionId'>> = {},
): Pattern {
  const now = Date.now();
  return {
    ...p,
    id: overrides.id ?? generateUuid(),
    name: overrides.name ?? p.name,
    events: p.events.map((e) => ({ ...e, id: generateId('ev') })),
    lanes: p.lanes.map((l) => ({ ...l })),
    visibility: overrides.visibility ?? p.visibility,
    // New copies haven't been published yet; the catalog "recently published" sort
    // only sees them once they're transitioned out of private.
    publishedAt: null,
    // Default to not-a-fork; callers (e.g. the catalog viewer's "Fork to my library"
    // CTA) explicitly set this to track attribution.
    forkedFromId: overrides.forkedFromId ?? null,
    // Snapshot of the source creator's display name at fork-time. Only set
    // when this is a fork (forkedFromId non-null); a plain duplicate within
    // the user's own library shouldn't carry attribution.
    forkedFromCreatorName: overrides.forkedFromCreatorName ?? null,
    // Default: preserve the source's folder (duplicate-in-place semantics). Forks
    // of someone else's pattern must explicitly reset this to null since the
    // source's folder belongs to a different user's library.
    collectionId: overrides.collectionId !== undefined ? overrides.collectionId : p.collectionId,
    createdAt: now,
    updatedAt: now,
  };
}

/** Snapshot clone: same content (fresh event ids), fresh placement id assigned outside.
 *  Distinct from clonePattern in that we KEEP the pattern's id so the placement can
 *  reference back to "what library entry this came from" — but per the locked
 *  snapshot semantics, edits don't propagate, so this id is informational only. */
export function snapshotPatternForPlacement(p: Pattern): Pattern {
  return {
    ...p,
    events: p.events.map((e) => ({ ...e })),
    lanes: p.lanes.map((l) => ({ ...l })),
  };
}

/** Sort events by startTick, then by stringIndex for deterministic iteration. */
export function sortedEvents(events: readonly PatternEvent[]): PatternEvent[] {
  return [...events].sort((a, b) => {
    if (a.startTick !== b.startTick) return a.startTick - b.startTick;
    return a.stringIndex - b.stringIndex;
  });
}

/** Find the smallest startTick on the given string that is strictly greater than `tick`.
 *  Returns Infinity if no such event exists. Used to clamp resize/move operations. */
export function nextEventStartOnString(
  events: readonly PatternEvent[],
  stringIndex: number,
  afterTick: Tick,
  excludeId?: string,
): Tick {
  let best = Infinity;
  for (const e of events) {
    if (e.stringIndex !== stringIndex) continue;
    if (e.id === excludeId) continue;
    if (e.startTick > afterTick && e.startTick < best) best = e.startTick;
  }
  return best;
}

/** Find the greatest endTick on the given string that is strictly less than or equal to
 *  `tick`. Returns -Infinity if no such event exists. Used to prevent leftward overlap. */
export function prevEventEndOnString(
  events: readonly PatternEvent[],
  stringIndex: number,
  beforeOrAtTick: Tick,
  excludeId?: string,
): Tick {
  let best = -Infinity;
  for (const e of events) {
    if (e.stringIndex !== stringIndex) continue;
    if (e.id === excludeId) continue;
    const end = e.startTick + e.durationTicks;
    if (e.startTick < beforeOrAtTick && end > best) best = end;
  }
  return best;
}

export interface StampAtArgs {
  pattern: Pattern;
  stringIndex: number;
  fret: number;
  startTick: Tick;
  durationTicks: Tick;
}

/** Insert a single event at the given position, clamping duration so it doesn't overlap
 *  the next event on the same string. Returns the updated pattern AND the inserted event
 *  (so callers can select it / log its id). */
export function stampEvent(args: StampAtArgs): { pattern: Pattern; event: PatternEvent } {
  const { pattern, stringIndex, fret, startTick } = args;
  const nextStart = nextEventStartOnString(pattern.events, stringIndex, startTick);
  // Block stamping if there's an existing event whose interval covers `startTick`.
  const conflict = pattern.events.find(
    (e) =>
      e.stringIndex === stringIndex &&
      e.startTick <= startTick &&
      e.startTick + e.durationTicks > startTick,
  );
  if (conflict) {
    return { pattern, event: conflict };
  }
  const maxDuration = nextStart - startTick;
  const durationTicks = Math.max(1, Math.min(args.durationTicks, maxDuration === Infinity ? args.durationTicks : maxDuration));
  const event: PatternEvent = {
    id: generateId('ev'),
    stringIndex,
    fret,
    startTick,
    durationTicks,
  };
  return {
    pattern: { ...pattern, events: [...pattern.events, event], updatedAt: Date.now() },
    event,
  };
}

/** Resize an event's duration, clamped to prevent same-string overlap with the next event. */
export function resizeEvent(pattern: Pattern, eventId: string, newDurationTicks: Tick): Pattern {
  const event = pattern.events.find((e) => e.id === eventId);
  if (!event) return pattern;
  const nextStart = nextEventStartOnString(pattern.events, event.stringIndex, event.startTick, eventId);
  const maxDuration = nextStart === Infinity ? Number.MAX_SAFE_INTEGER : nextStart - event.startTick;
  const clamped = Math.max(1, Math.min(newDurationTicks, maxDuration));
  return {
    ...pattern,
    events: pattern.events.map((e) => (e.id === eventId ? { ...e, durationTicks: clamped } : e)),
    updatedAt: Date.now(),
  };
}

/** Resize multiple events by the same `deltaTicks`. Each event is clamped
 *  independently: against the next event on the same string (no overlap) and
 *  against a floor of 1 tick. Snapshots are captured at grab time so per-pointer
 *  reductions don't compound on top of intermediate state.
 *
 *  Returns the same pattern reference when no snapshot matches an event (so
 *  callers can short-circuit with reference equality, matching `moveEventsBy`). */
export function resizeEventsBy(
  pattern: Pattern,
  snapshots: readonly EventResizeSnapshot[],
  deltaTicks: Tick,
): Pattern {
  const snapshotById = new Map(snapshots.map((s) => [s.id, s] as const));
  let touched = false;
  const nextEvents = pattern.events.map((e) => {
    const snap = snapshotById.get(e.id);
    if (!snap) return e;
    const nextStart = nextEventStartOnString(pattern.events, e.stringIndex, e.startTick, e.id);
    const maxDuration = nextStart === Infinity ? Number.MAX_SAFE_INTEGER : nextStart - e.startTick;
    const desired = snap.durationTicks + deltaTicks;
    const clamped = Math.max(1, Math.min(desired, maxDuration));
    if (clamped === e.durationTicks) return e;
    touched = true;
    return { ...e, durationTicks: clamped };
  });
  if (!touched) return pattern;
  return { ...pattern, events: nextEvents, updatedAt: Date.now() };
}

/** Move an event in time and/or to a different string. Rejects moves that would cause
 *  same-string overlap. */
export function moveEvent(
  pattern: Pattern,
  eventId: string,
  newStartTick: Tick,
  newStringIndex?: number,
): Pattern {
  const event = pattern.events.find((e) => e.id === eventId);
  if (!event) return pattern;
  const stringIndex = newStringIndex ?? event.stringIndex;
  const startTick = Math.max(0, newStartTick);
  // Reject if there's any event on the target string that overlaps [startTick, startTick + duration).
  const overlap = pattern.events.find((e) => {
    if (e.id === eventId) return false;
    if (e.stringIndex !== stringIndex) return false;
    const aEnd = startTick + event.durationTicks;
    const bEnd = e.startTick + e.durationTicks;
    return startTick < bEnd && e.startTick < aEnd;
  });
  if (overlap) return pattern;
  return {
    ...pattern,
    events: pattern.events.map((e) =>
      e.id === eventId ? { ...e, startTick, stringIndex } : e,
    ),
    updatedAt: Date.now(),
  };
}

export interface EventDragSnapshot {
  id: string;
  startTick: Tick;
  stringIndex: number;
  durationTicks: Tick;
}

export interface EventResizeSnapshot {
  readonly id: string;
  readonly durationTicks: Tick;
}

/** Apply a (deltaTicks, deltaStringIdx) move to a group of events using their drag-start
 *  snapshots. The delta is clamped — never rejected — so the group slides up against
 *  obstacles instead of snapping back. Order of clamping:
 *
 *   1. String-row bounds: keep every event on a valid string.
 *   2. For the chosen dRow, find the largest |dTick| in the user's direction such that
 *      no selected event collides with a non-selected event on its target string.
 *   3. If no valid dTick exists for this dRow (e.g. the group can't fit on the new
 *      strings at all), shrink |dRow| by 1 and retry.
 *
 *  Selected events never collide with each other because they all shift by the same
 *  delta; only selected-vs-non-selected collisions matter. */
export function moveEventsBy(
  pattern: Pattern,
  snapshots: readonly EventDragSnapshot[],
  deltaTicks: Tick,
  deltaStringIdx: number,
  stringCount: number,
): Pattern {
  if (snapshots.length === 0) return pattern;
  const selectedIds = new Set(snapshots.map((s) => s.id));

  // String-row bounds: clamp dRow so every event lands on a valid string.
  let dRow = deltaStringIdx;
  for (const s of snapshots) {
    if (s.stringIndex + dRow < 0) dRow = -s.stringIndex;
    if (s.stringIndex + dRow > stringCount - 1) dRow = stringCount - 1 - s.stringIndex;
  }

  // Walk dRow toward 0 until a valid dTick range exists. dRow can move at most one
  // step per iteration; bounded by stringCount.
  let finalDRow = dRow;
  let finalDTick: number | null = null;
  while (true) {
    finalDTick = clampDTickForRow(pattern, snapshots, deltaTicks, finalDRow, selectedIds);
    if (finalDTick !== null) break;
    if (finalDRow === 0) {
      // No valid placement even at dRow=0 — implies the pattern was already invalid,
      // or there are no degrees of freedom. No-op.
      return pattern;
    }
    finalDRow -= Math.sign(finalDRow);
  }

  if (finalDTick === 0 && finalDRow === 0) return pattern;

  const idToNewPos = new Map<string, { startTick: Tick; stringIndex: number }>();
  for (const s of snapshots) {
    idToNewPos.set(s.id, {
      startTick: s.startTick + finalDTick,
      stringIndex: s.stringIndex + finalDRow,
    });
  }

  return {
    ...pattern,
    events: pattern.events.map((e) => {
      const np = idToNewPos.get(e.id);
      return np ? { ...e, startTick: np.startTick, stringIndex: np.stringIndex } : e;
    }),
    updatedAt: Date.now(),
  };
}

/** For a given dRow, find the largest dTick in the direction of `desiredDTick` such
 *  that every snapshot fits in its target-string gap without overlapping a non-selected
 *  event. Returns null when the group cannot fit on the target strings at all (e.g.
 *  a snapshot's original startTick falls inside a non-selected event on its new
 *  string). startTick is floored at 0; no upper-duration cap (matching moveEvent). */
function clampDTickForRow(
  pattern: Pattern,
  snapshots: readonly EventDragSnapshot[],
  desiredDTick: number,
  dRow: number,
  selectedIds: ReadonlySet<string>,
): number | null {
  let minDelta = -Infinity;
  let maxDelta = Infinity;
  for (const s of snapshots) {
    const targetString = s.stringIndex + dRow;
    let gapStart = 0;
    let gapEnd = Number.POSITIVE_INFINITY;
    for (const e of pattern.events) {
      if (selectedIds.has(e.id)) continue;
      if (e.stringIndex !== targetString) continue;
      const eEnd = e.startTick + e.durationTicks;
      if (eEnd <= s.startTick) {
        if (eEnd > gapStart) gapStart = eEnd;
      } else if (e.startTick >= s.startTick + s.durationTicks) {
        if (e.startTick < gapEnd) gapEnd = e.startTick;
      } else {
        // A non-selected event sits on top of where the snapshot would land at dTick=0.
        // No tick delta can rescue this — caller must shrink dRow.
        return null;
      }
    }
    const minD = gapStart - s.startTick;
    const maxD = gapEnd === Number.POSITIVE_INFINITY
      ? Number.POSITIVE_INFINITY
      : gapEnd - s.startTick - s.durationTicks;
    if (minD > minDelta) minDelta = minD;
    if (maxD < maxDelta) maxDelta = maxD;
  }
  if (minDelta > maxDelta) return null;
  // Floor startTick at 0 across the group: dTick >= -min(snapshot.startTick).
  let minStartTick = Number.POSITIVE_INFINITY;
  for (const s of snapshots) if (s.startTick < minStartTick) minStartTick = s.startTick;
  if (-minStartTick > minDelta) minDelta = -minStartTick;
  if (minDelta > maxDelta) return null;
  return Math.max(minDelta, Math.min(maxDelta, desiredDTick));
}

/** Change an event's fret (which note it plays on its current string). Clamped to
 *  >= 0. No string-overlap check needed because we're not changing the time slot. */
export function setEventFret(pattern: Pattern, eventId: string, newFret: number): Pattern {
  const clamped = Math.max(0, Math.floor(newFret));
  const existing = pattern.events.find((e) => e.id === eventId);
  if (!existing || existing.fret === clamped) return pattern;
  return {
    ...pattern,
    events: pattern.events.map((e) =>
      e.id === eventId ? { ...e, fret: clamped } : e,
    ),
    updatedAt: Date.now(),
  };
}

/**
 * Patchable articulation fields on `PatternEvent`. Each is optional; passing
 * `undefined` clears the field (using `undefined` rather than `null` keeps
 * JSON serialization tidy — JSON.stringify omits undefined properties).
 */
export interface PatternEventArticulationPatch {
  hammerOn?: boolean;
  pullOff?: boolean;
  tieToNext?: boolean;
  velocity?: number;
  dynamic?: import('./types').DynamicMark;
  vibrato?: 'slight' | 'wide';
  slide?: { type: PatternEventSlideType; toFret?: number };
  bend?: {
    type: PatternEventBendType;
    semitones: number;
    points?: Array<{ at: number; semitones: number }>;
  };
  palmMute?: boolean;
  ghost?: boolean;
  dead?: boolean;
  tap?: boolean;
  harmonic?: { type: 'natural' | 'artificial' | 'pinch' | 'tap' | 'semi'; fret?: number };
}

export type PatternEventSlideType =
  | 'legato'
  | 'shift'
  | 'slide-in-below'
  | 'slide-in-above'
  | 'slide-out-down'
  | 'slide-out-up';

export type PatternEventBendType = 'bend' | 'release' | 'pre-bend' | 'bend-release';

const ARTICULATION_KEYS: ReadonlyArray<keyof PatternEventArticulationPatch> = [
  'hammerOn',
  'pullOff',
  'tieToNext',
  'velocity',
  'dynamic',
  'vibrato',
  'slide',
  'bend',
  'palmMute',
  'ghost',
  'dead',
  'tap',
  'harmonic',
];

/**
 * Apply an articulation patch to a single event. A key whose value is
 * `undefined` is *removed* from the event entirely (since the model uses
 * presence-or-absent rather than nullable booleans). Hammer-on and pull-off
 * are kept mutually exclusive — setting one clears the other.
 */
export function updateEventArticulations(
  pattern: Pattern,
  eventId: string,
  patch: PatternEventArticulationPatch,
): Pattern {
  const existing = pattern.events.find((e) => e.id === eventId);
  if (!existing) return pattern;
  const next: PatternEvent = { ...existing };
  for (const key of ARTICULATION_KEYS) {
    if (!(key in patch)) continue;
    const value = patch[key];
    if (value === undefined) {
      delete (next as unknown as Record<string, unknown>)[key];
    } else {
      (next as unknown as Record<string, unknown>)[key] = value;
    }
  }
  // Maintain hammerOn / pullOff mutual exclusion.
  if (patch.hammerOn === true && existing.pullOff) delete (next as unknown as Record<string, unknown>).pullOff;
  if (patch.pullOff === true && existing.hammerOn) delete (next as unknown as Record<string, unknown>).hammerOn;
  // Bail if nothing actually changed (avoids spurious updates + re-renders).
  if (shallowEqualEvents(existing, next)) return pattern;
  return {
    ...pattern,
    events: pattern.events.map((e) => (e.id === eventId ? next : e)),
    updatedAt: Date.now(),
  };
}

function shallowEqualEvents(a: PatternEvent, b: PatternEvent): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof PatternEvent>;
  for (const k of keys) {
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) return false;
  }
  return true;
}

/**
 * Move selected events by one scale step in the given direction (1 = up, -1 = down).
 * Each event is transposed individually, preserving its chromatic offset from the
 * nearest scale tone at or below it ("relative pitch compared to the key" is preserved).
 *
 * Events whose new fret falls outside `[0, fretCount]` on the same string are
 * left unchanged. The fret stays on the same string — no string changes.
 *
 * Returns the same pattern reference when nothing changes.
 */
export function transposeEventsDiatonic(
  pattern: Pattern,
  eventIds: readonly string[],
  direction: 1 | -1,
  key: string,
  intervals: IntervalSet,
  tuning: TuningDef,
  fretCount: number,
): Pattern {
  if (eventIds.length === 0) return pattern;
  const rootPC = pitchClass(key);
  const scalePcSet = new Set(intervals.map((i) => ((rootPC + i) % 12 + 12) % 12));
  const selected = new Set(eventIds);
  let touched = false;
  const nextEvents = pattern.events.map((e) => {
    if (!selected.has(e.id)) return e;
    const oldPitch = pitchOf({ stringIndex: e.stringIndex, fret: e.fret }, tuning);
    const newPitch = transposeDiatonicPitch(oldPitch, direction, scalePcSet);
    const delta = newPitch - oldPitch;
    const newFret = e.fret + delta;
    if (newFret < 0 || newFret > fretCount) return e;
    touched = true;
    return { ...e, fret: newFret };
  });
  if (!touched) return pattern;
  return { ...pattern, events: nextEvents, updatedAt: Date.now() };
}

function transposeDiatonicPitch(
  pitch: number,
  direction: 1 | -1,
  scalePcSet: ReadonlySet<number>,
): number {
  // Anchor: nearest scale tone <= pitch.
  let anchor = pitch;
  while (!scalePcSet.has(((anchor % 12) + 12) % 12)) anchor--;
  const offset = pitch - anchor;
  // Step the anchor up or down one scale tone.
  let nextAnchor = anchor + direction;
  while (!scalePcSet.has(((nextAnchor % 12) + 12) % 12)) nextAnchor += direction;
  return nextAnchor + offset;
}

/** Remove events by id. */
export function deleteEvents(pattern: Pattern, ids: readonly string[]): Pattern {
  const set = new Set(ids);
  const filtered = pattern.events.filter((e) => !set.has(e.id));
  if (filtered.length === pattern.events.length) return pattern;
  return { ...pattern, events: filtered, updatedAt: Date.now() };
}

/** Add a lane definition (Phase 2 prep; no Phase 1 UI uses this). */
export function addLane(pattern: Pattern, lane: Lane): Pattern {
  return { ...pattern, lanes: [...pattern.lanes, lane], updatedAt: Date.now() };
}

/** Update pattern metadata. */
export function setPatternName(pattern: Pattern, name: string): Pattern {
  return { ...pattern, name, updatedAt: Date.now() };
}

export function setPatternInstrument(pattern: Pattern, instrumentId: string): Pattern {
  return { ...pattern, instrumentId, updatedAt: Date.now() };
}

/** Patch shape for catalog metadata mutations on a Pattern. Each key is independently
 *  optional; `undefined` means "leave alone." Use `null` for description/difficulty to
 *  clear those fields explicitly. */
export interface PatternMetadataPatch {
  description?: string | null;
  difficulty?: string | null;
  genres?: string[];
  tags?: string[];
  visibility?: string;
}

/**
 * Apply a metadata patch and manage the `publishedAt` lifecycle:
 *   - private → non-private  ⇒ set publishedAt = now
 *   - non-private → private  ⇒ clear publishedAt
 *   - any other transition   ⇒ leave publishedAt untouched
 *
 * No-op transitions (visibility unchanged) skip the lifecycle entirely.
 */
export function applyPatternMetadata(pattern: Pattern, patch: PatternMetadataPatch): Pattern {
  const now = Date.now();
  const next: Pattern = { ...pattern, updatedAt: now };
  if (patch.description !== undefined) next.description = patch.description;
  if (patch.difficulty !== undefined) next.difficulty = patch.difficulty;
  if (patch.genres !== undefined) next.genres = patch.genres;
  if (patch.tags !== undefined) next.tags = patch.tags;
  if (patch.visibility !== undefined && patch.visibility !== pattern.visibility) {
    next.visibility = patch.visibility;
    if (pattern.visibility === 'private' && patch.visibility !== 'private') {
      next.publishedAt = now;
    } else if (patch.visibility === 'private') {
      next.publishedAt = null;
    }
  }
  return next;
}

export function setPatternDuration(pattern: Pattern, durationTicks: Tick): Pattern {
  return { ...pattern, durationTicks: Math.max(0, durationTicks), updatedAt: Date.now() };
}

/** Fit a pattern's length to its content, rounded UP to the nearest bar with a
 *  one-bar minimum. Grows when notes extend past the end and shrinks when the
 *  last notes are removed — the pattern is always "as long as it needs to be".
 *  Returns the same reference when the duration is already correct (so it's safe
 *  to call on every edit). `updatedAt` is intentionally NOT bumped: this is a
 *  derived recompute, not a user edit. */
export function fitPatternDuration(pattern: Pattern): Pattern {
  const tpb = ticksPerBar(pattern.timeSignature);
  const lastEnd = pattern.events.reduce((m, e) => Math.max(m, e.startTick + e.durationTicks), 0);
  const fitted = Math.max(tpb, Math.ceil(lastEnd / tpb) * tpb);
  return fitted === pattern.durationTicks ? pattern : { ...pattern, durationTicks: fitted };
}

export function setPatternTimeSignature(pattern: Pattern, ts: PatternTimeSignature): Pattern {
  return { ...pattern, timeSignature: { ...ts }, updatedAt: Date.now() };
}

const MIN_BPM = 40;
const MAX_BPM = 240;
const SWING_MIN = 0.5;
const SWING_MAX = 0.95;

function clampBpm(bpm: number): number {
  return Math.max(MIN_BPM, Math.min(MAX_BPM, Math.round(bpm)));
}

function clampGroove(g: GrooveSpec): GrooveSpec {
  return { ...g, swing: Math.max(SWING_MIN, Math.min(SWING_MAX, g.swing)) };
}

export function setPatternSuggestedBpm(pattern: Pattern, bpm: number | null): Pattern {
  return {
    ...pattern,
    suggestedBpm: bpm === null ? null : clampBpm(bpm),
    updatedAt: Date.now(),
  };
}

export function setPatternGroove(pattern: Pattern, groove: GrooveSpec | null): Pattern {
  return {
    ...pattern,
    groove: groove === null ? null : clampGroove(groove),
    updatedAt: Date.now(),
  };
}
