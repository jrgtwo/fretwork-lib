/**
 * Pure operations on Composition objects. Like pattern-ops, these never mutate.
 *
 * Placement semantics are snapshot — `addPlacement` deep-copies the source pattern
 * into the placement at the time of placement. Subsequent edits to the source library
 * pattern do not affect the placement, and vice versa.
 */
import type {
  Composition,
  GrooveSpec,
  Pattern,
  PatternTimeSignature,
  Placement,
  Tick,
  Track,
} from './types';
import { MAX_COMPOSITION_TRACKS } from './types';
import { generateId, generateUuid } from './ids';
import { snapshotPatternForPlacement } from './pattern-ops';
import { DEFAULT_INSTRUMENT_ID, getInstrument } from '../lib/instruments';
import { PPQ } from './timebase';

const DEFAULT_FRETBOARD_FRET_COUNT = 22;

const DEFAULT_TS: PatternTimeSignature = { numerator: 4, denominator: 4 };
const DEFAULT_BPM = 120;

export function createEmptyComposition(
  name = 'Untitled composition',
  instrumentId: string = DEFAULT_INSTRUMENT_ID,
): Composition {
  const now = Date.now();
  return {
    // UUID so the same id can be used as the Supabase row id when synced.
    id: generateUuid(),
    name,
    instrumentId,
    bpm: DEFAULT_BPM,
    timeSignature: { ...DEFAULT_TS },
    placements: [],
    tracks: [createEmptyTrack('Track 1', instrumentId)],
    masterVolumeDb: 0,
    loop: false,
    tempoMode: 'global',
    groove: null,
    grooveMode: 'global',
    subdivision: null,
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

export function createEmptyTrack(
  name: string,
  instrumentId: string = DEFAULT_INSTRUMENT_ID,
): Track {
  return {
    id: generateId('trk'),
    name,
    instrumentId,
    volumeDb: 0,
    muted: false,
    soloed: false,
    placements: [],
  };
}

/**
 * One-shot upgrade from the legacy single-track shape to the new tracks-
 * based shape. Idempotent: if `tracks` is already populated, returns the
 * input unchanged. Otherwise creates a single Track named "Track 1"
 * inheriting the composition's instrumentId and holding the entire
 * legacy `placements` array.
 *
 * Used by both the sessionStorage persist migration and the cloud-sync
 * hydrator so a Composition coming from either source emerges with the
 * canonical multi-track shape.
 */
export function migrateCompositionToTracks(comp: Composition): Composition {
  if (comp.tracks && comp.tracks.length > 0) return comp;
  const legacyPlacements = comp.placements ?? [];
  const track = createEmptyTrack('Track 1', comp.instrumentId);
  track.placements = legacyPlacements;
  return {
    ...comp,
    tracks: [track],
    masterVolumeDb: comp.masterVolumeDb ?? 0,
    placements: [],
  };
}

/** Compute where a new placement would start by default: at the end of the
 *  longest track in the composition. */
export function totalDurationTicks(comp: Composition): Tick {
  let max = 0;
  for (const track of comp.tracks ?? []) {
    for (const p of track.placements) {
      const end = p.startTick + p.patternSnapshot.durationTicks * p.repeat;
      if (end > max) max = end;
    }
  }
  return max;
}

/**
 * Locate which track owns a placement. Returns `{ trackIndex, placementIndex }`
 * or null if the id isn't present. Used by the legacy single-arg
 * placement ops (`removePlacement`, etc.) so existing
 * callers don't have to know which track a placement lives in.
 */
export function findPlacement(
  comp: Composition,
  placementId: string,
): { trackIndex: number; placementIndex: number; track: Track; placement: Placement } | null {
  for (let ti = 0; ti < (comp.tracks?.length ?? 0); ti++) {
    const t = comp.tracks[ti];
    for (let pi = 0; pi < t.placements.length; pi++) {
      if (t.placements[pi].id === placementId) {
        return { trackIndex: ti, placementIndex: pi, track: t, placement: t.placements[pi] };
      }
    }
  }
  return null;
}

/**
 * Return a new tracks array with the named track replaced. Returns the same
 * array reference (no mutation) if the trackId isn't found.
 */
function replaceTrack(tracks: Track[], trackId: string, replace: (t: Track) => Track): Track[] {
  return tracks.map((t) => (t.id === trackId ? replace(t) : t));
}

/** Add a placement to a specific track at the given tick. */
export function addPlacementToTrack(
  comp: Composition,
  trackId: string,
  sourcePattern: Pattern,
  atTick?: Tick,
): { composition: Composition; placement: Placement | null } {
  const track = comp.tracks.find((t) => t.id === trackId);
  if (!track) return { composition: comp, placement: null };
  const placement: Placement = {
    id: generateId('pl'),
    patternSnapshot: snapshotPatternForPlacement(sourcePattern),
    startTick: atTick ?? (() => {
      const lastOnTrack = track.placements[track.placements.length - 1];
      return lastOnTrack ? placementEndTick(lastOnTrack) : 0;
    })(),
    repeat: 1,
    transposeSemitones: 0,
    lengthTicks: null,
  };
  // Voice inheritance: a track with no voice of its own adopts the source
  // pattern's voice when its first such pattern is placed. A track that
  // already has an explicit voice is never overwritten.
  const inheritedVoiceRef = track.voiceRef ?? sourcePattern.voiceRef ?? null;
  return {
    composition: {
      ...comp,
      tracks: replaceTrack(comp.tracks, trackId, (t) => ({
        ...t,
        voiceRef: inheritedVoiceRef,
        placements: sortTrackPlacements([...t.placements, placement]),
      })),
      updatedAt: Date.now(),
    },
    placement,
  };
}

/**
 * Legacy single-track API — adds to the first track. Preserved for callers
 * that don't yet have a track id (e.g. existing keyboard shortcuts that
 * append a pattern to the composition's "main" lane). New UI uses
 * `addPlacementToTrack`.
 */
export function addPlacement(
  comp: Composition,
  sourcePattern: Pattern,
  atTick?: Tick,
): { composition: Composition; placement: Placement } {
  const firstTrack = comp.tracks?.[0];
  if (!firstTrack) {
    // Degenerate composition with no tracks — synthesize one to keep the
    // contract alive. Shouldn't happen post-migration but is cheap to handle.
    const seeded = migrateCompositionToTracks(comp);
    return addPlacement(seeded, sourcePattern, atTick) as {
      composition: Composition;
      placement: Placement;
    };
  }
  const result = addPlacementToTrack(comp, firstTrack.id, sourcePattern, atTick);
  // The legacy contract guarantees a placement; the trackId is always valid here.
  return { composition: result.composition, placement: result.placement! };
}

// ─── Track-level ops ────────────────────────────────────────────────────────

export function addTrack(comp: Composition, name?: string, instrumentId?: string): Composition {
  if ((comp.tracks?.length ?? 0) >= MAX_COMPOSITION_TRACKS) return comp;
  const next = createEmptyTrack(
    name ?? `Track ${(comp.tracks?.length ?? 0) + 1}`,
    instrumentId ?? comp.instrumentId,
  );
  return {
    ...comp,
    tracks: [...(comp.tracks ?? []), next],
    updatedAt: Date.now(),
  };
}

export function removeTrack(comp: Composition, trackId: string): Composition {
  if (!comp.tracks?.length) return comp;
  // Never let removeTrack leave the composition with zero tracks — the
  // model invariant is at least one. If the user wants an empty timeline
  // they can just delete the placements within the last track.
  if (comp.tracks.length === 1) return comp;
  const next = comp.tracks.filter((t) => t.id !== trackId);
  if (next.length === comp.tracks.length) return comp;
  return { ...comp, tracks: next, updatedAt: Date.now() };
}

export function setTrackName(comp: Composition, trackId: string, name: string): Composition {
  return {
    ...comp,
    tracks: replaceTrack(comp.tracks, trackId, (t) => ({ ...t, name })),
    updatedAt: Date.now(),
  };
}

export function setTrackInstrument(
  comp: Composition,
  trackId: string,
  instrumentId: string,
): Composition {
  return {
    ...comp,
    // Changing the instrument also clears any per-track voice override —
    // the picked voice may have been for the OLD instrument, so falling
    // back to the new instrument's global default is safer than carrying
    // a now-incompatible variant ref.
    tracks: replaceTrack(comp.tracks, trackId, (t) => ({ ...t, instrumentId, voiceRef: null })),
    updatedAt: Date.now(),
  };
}

/** Set the per-track voice override. Pass `null` to clear (the track will
 *  fall back to the global active variant for its instrument). */
export function setTrackVoiceRef(
  comp: Composition,
  trackId: string,
  voiceRef: unknown | null,
): Composition {
  return {
    ...comp,
    tracks: replaceTrack(comp.tracks, trackId, (t) => ({ ...t, voiceRef })),
    updatedAt: Date.now(),
  };
}

export function setTrackVolumeDb(
  comp: Composition,
  trackId: string,
  volumeDb: number,
): Composition {
  const clamped = Math.max(-60, Math.min(6, volumeDb));
  return {
    ...comp,
    tracks: replaceTrack(comp.tracks, trackId, (t) => ({ ...t, volumeDb: clamped })),
    updatedAt: Date.now(),
  };
}

export function setTrackMuted(comp: Composition, trackId: string, muted: boolean): Composition {
  return {
    ...comp,
    tracks: replaceTrack(comp.tracks, trackId, (t) => ({ ...t, muted })),
    updatedAt: Date.now(),
  };
}

export function setTrackSoloed(comp: Composition, trackId: string, soloed: boolean): Composition {
  return {
    ...comp,
    tracks: replaceTrack(comp.tracks, trackId, (t) => ({ ...t, soloed })),
    updatedAt: Date.now(),
  };
}

export function setMasterVolumeDb(comp: Composition, masterVolumeDb: number): Composition {
  const clamped = Math.max(-60, Math.min(6, masterVolumeDb));
  if (comp.masterVolumeDb === clamped) return comp;
  return { ...comp, masterVolumeDb: clamped, updatedAt: Date.now() };
}

/**
 * Sort a track's placements by ascending startTick. Stable; cheap on
 * already-sorted input. Called by every op that mutates a track's
 * placements array, so the in-array order always matches the playback
 * order. Iteration code (UI, scheduler) can rely on this without
 * re-sorting at call sites.
 */
function sortTrackPlacements(placements: Placement[]): Placement[] {
  return [...placements].sort((a, b) => a.startTick - b.startTick);
}

export function setPlacementRepeat(
  comp: Composition,
  placementId: string,
  repeat: number,
): Composition {
  const clamped = Math.max(1, Math.floor(repeat));
  const found = findPlacement(comp, placementId);
  if (!found) return comp;
  if (found.placement.repeat === clamped) return comp;

  const updatedPlacement: Placement = { ...found.placement, repeat: clamped };
  const updatedEnd = placementEndTick(updatedPlacement);

  const others = found.track.placements.filter((p) => p.id !== placementId);
  const firstRightConflict = others.find(
    (p) => p.startTick >= updatedPlacement.startTick && p.startTick < updatedEnd,
  );
  let pushedOthers = others;
  if (firstRightConflict) {
    const byTicks = updatedEnd - firstRightConflict.startTick;
    pushedOthers = pushPlacementsForward(others, updatedPlacement.startTick, byTicks);
  }

  return {
    ...comp,
    tracks: comp.tracks.map((t) =>
      t.id === found.track.id
        ? {
            ...t,
            placements: sortTrackPlacements([...pushedOthers, updatedPlacement]),
          }
        : t,
    ),
    updatedAt: Date.now(),
  };
}

export function removePlacement(comp: Composition, placementId: string): Composition {
  const found = findPlacement(comp, placementId);
  if (!found) return comp;
  return {
    ...comp,
    tracks: comp.tracks.map((t) =>
      t.id === found.track.id
        ? {
            ...t,
            placements: sortTrackPlacements(t.placements.filter((p) => p.id !== placementId)),
          }
        : t,
    ),
    updatedAt: Date.now(),
  };
}

export function setCompositionName(comp: Composition, name: string): Composition {
  return { ...comp, name, updatedAt: Date.now() };
}

export function setCompositionInstrument(comp: Composition, instrumentId: string): Composition {
  return { ...comp, instrumentId, updatedAt: Date.now() };
}

/** Patch shape for catalog metadata mutations on a Composition. Mirrors the
 *  PatternMetadataPatch shape exactly. */
export interface CompositionMetadataPatch {
  description?: string | null;
  difficulty?: string | null;
  genres?: string[];
  tags?: string[];
  visibility?: string;
}

/** See `applyPatternMetadata` for lifecycle rules — this is the composition analog. */
export function applyCompositionMetadata(
  comp: Composition,
  patch: CompositionMetadataPatch,
): Composition {
  const now = Date.now();
  const next: Composition = { ...comp, updatedAt: now };
  if (patch.description !== undefined) next.description = patch.description;
  if (patch.difficulty !== undefined) next.difficulty = patch.difficulty;
  if (patch.genres !== undefined) next.genres = patch.genres;
  if (patch.tags !== undefined) next.tags = patch.tags;
  if (patch.visibility !== undefined && patch.visibility !== comp.visibility) {
    next.visibility = patch.visibility;
    if (comp.visibility === 'private' && patch.visibility !== 'private') {
      next.publishedAt = now;
    } else if (patch.visibility === 'private') {
      next.publishedAt = null;
    }
  }
  return next;
}

export function setCompositionBpm(comp: Composition, bpm: number): Composition {
  return { ...comp, bpm: Math.max(40, Math.min(240, bpm)), updatedAt: Date.now() };
}

/**
 * Set the composition's static time signature. Idempotent when the value
 * matches. Note: this does NOT clear `timeSignatureTrack` — that's
 * automation data preserved from the source IR. In global tempoMode the
 * playback engine ignores `timeSignatureTrack` and uses only this static
 * value, so the user can override an imported meter cleanly.
 */
export function setCompositionTimeSignature(
  comp: Composition,
  timeSignature: PatternTimeSignature,
): Composition {
  if (
    comp.timeSignature.numerator === timeSignature.numerator &&
    comp.timeSignature.denominator === timeSignature.denominator
  ) {
    return comp;
  }
  return {
    ...comp,
    timeSignature: { ...timeSignature },
    updatedAt: Date.now(),
  };
}

/** Update the placement's snapshot (used when editing the placement's own pattern
 *  via the editor tab). */
export function setPlacementSnapshot(
  comp: Composition,
  placementId: string,
  next: Pattern,
): Composition {
  const found = findPlacement(comp, placementId);
  if (!found) return comp;
  return {
    ...comp,
    tracks: comp.tracks.map((t) =>
      t.id === found.track.id
        ? {
            ...t,
            placements: sortTrackPlacements(
              t.placements.map((p) =>
                p.id === placementId ? { ...p, patternSnapshot: next } : p,
              ),
            ),
          }
        : t,
    ),
    updatedAt: Date.now(),
  };
}

/** Effective length of one repetition of a placement, in ticks. Honors the
 *  optional `lengthTicks` truncation; falls back to the snapshot's full
 *  durationTicks when null. Centralized so call sites (width math, playhead
 *  mapping, flatten) all agree. */
export function placementEffectiveLength(p: Placement): Tick {
  return p.lengthTicks ?? p.patternSnapshot.durationTicks;
}

/** Absolute tick at which a placement ends (exclusive). Centralizes the
 *  `startTick + effectiveLength * repeat` math used by overlap detection,
 *  ruler extent, and the push cascade. */
export function placementEndTick(p: Placement): Tick {
  return p.startTick + placementEffectiveLength(p) * p.repeat;
}

/** Primitive: shift every placement whose `startTick >= fromTick` by
 *  `byTicks`. One-way (rightward only). No-op when `byTicks <= 0`. Used
 *  by every op that may cause overlap (`movePlacement`,
 *  `resizePlacement`, `setPlacementRepeat`) as its conflict-resolution
 *  step. Returns the input array reference when byTicks <= 0 (so callers
 *  can short-circuit cheaply) or a new array otherwise.
 *
 *  Cascade strategy: by uniformly shifting *every* placement past
 *  `fromTick`, any chain of would-be downstream conflicts is resolved in
 *  one pass — provided the caller computes `byTicks` as the maximum
 *  needed shift (typically `movingEnd - firstConflict.startTick`). This
 *  trades minimum-shift granularity for simplicity; the visible result is
 *  that blocks past the moving block all move as a coherent group, which
 *  is also a predictable UX. */
export function pushPlacementsForward(
  placements: Placement[],
  fromTick: Tick,
  byTicks: Tick,
): Placement[] {
  if (byTicks <= 0) return placements;
  return placements.map((p) =>
    p.startTick >= fromTick ? { ...p, startTick: p.startTick + byTicks } : p,
  );
}

/** Find the start tick nearest `desired` at which a block of `span` ticks fits
 *  WITHOUT overlapping any of `existing`. Blocks clamp into the closest free gap
 *  (an open region between occupied placements, or the open space after the
 *  last) — they never overlap or push a neighbour. The region past the last
 *  placement is unbounded, so a valid slot always exists. */
export function clampStartToFreeSlot(
  existing: readonly Placement[],
  desired: Tick,
  span: Tick,
): Tick {
  const want = Math.max(0, Math.round(desired));
  const occ = existing
    .map((p) => [p.startTick, placementEndTick(p)] as [number, number])
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);
  // Free gaps between (merged) occupied intervals, plus the open tail.
  const gaps: [number, number][] = [];
  let cursor = 0;
  for (const [s, e] of occ) {
    if (s > cursor) gaps.push([cursor, s]);
    cursor = Math.max(cursor, e);
  }
  gaps.push([cursor, Infinity]);

  let best = want;
  let bestDist = Infinity;
  for (const [gs, ge] of gaps) {
    if (ge - gs < span) continue; // too small to hold the block
    const hi = ge === Infinity ? Infinity : ge - span;
    const clamped = Math.min(hi, Math.max(gs, want));
    const dist = Math.abs(clamped - want);
    if (dist < bestDist) {
      bestDist = dist;
      best = clamped;
    }
  }
  return best;
}

/**
 * Move a placement to a specific tick on a specific track. Handles three
 * gestures with one op: within-lane drag (destTrackId === sourceTrackId),
 * cross-lane drag (different destTrackId), and free-tick repositioning.
 *
 * Overlap resolution: BLOCK/CLAMP — the moving block snaps to the free slot
 * nearest the requested tick (`clampStartToFreeSlot`). It never overlaps a
 * neighbour and never pushes one aside; gaps are preserved.
 *
 * Returns the same composition reference on no-op (unknown id, unknown
 * destTrackId).
 */
export function movePlacement(
  comp: Composition,
  placementId: string,
  destTrackId: string,
  destStartTick: Tick,
): Composition {
  const found = findPlacement(comp, placementId);
  if (!found) return comp;
  const destTrack = comp.tracks.find((t) => t.id === destTrackId);
  if (!destTrack) return comp;

  // Source-side: remove the moving placement from its source track.
  const sourceWithout = found.track.placements.filter((p) => p.id !== placementId);
  // Destination-side: the list the moving block must coexist with.
  const destExisting = found.track.id === destTrackId ? sourceWithout : destTrack.placements;

  const movingSpan = placementEffectiveLength(found.placement) * found.placement.repeat;
  const adjustedStart = clampStartToFreeSlot(destExisting, destStartTick, movingSpan);
  const movedPlacement: Placement = { ...found.placement, startTick: adjustedStart };
  const sameTrack = found.track.id === destTrackId;

  return {
    ...comp,
    tracks: comp.tracks.map((t) => {
      if (sameTrack && t.id === destTrackId) {
        return { ...t, placements: sortTrackPlacements([...destExisting, movedPlacement]) };
      }
      if (t.id === found.track.id) {
        return { ...t, placements: sortTrackPlacements(sourceWithout) };
      }
      if (t.id === destTrackId) {
        return { ...t, placements: sortTrackPlacements([...destExisting, movedPlacement]) };
      }
      return t;
    }),
    updatedAt: Date.now(),
  };
}

/**
 * Split a placement into two adjacent placements at `atTick`. Both
 * halves share the same `patternSnapshot` reference (non-destructive);
 * the boundary is expressed via each half's `lengthTicks`. Collapses
 * `repeat` to 1 (mirrors `resizePlacement` semantics). Silent no-op if
 * `atTick` is at or outside the placement's range.
 */
export function splitPlacement(
  comp: Composition,
  placementId: string,
  atTick: Tick,
): Composition {
  const found = findPlacement(comp, placementId);
  if (!found) return comp;
  const original = found.placement;
  // The effective length we're splitting is one cycle (lengthTicks or
  // snapshot.durationTicks). Repeat is collapsed to 1 on split.
  const effLen = placementEffectiveLength(original);
  const localTick = atTick - original.startTick;
  if (localTick <= 0 || localTick >= effLen) return comp;

  const leftHalf: Placement = {
    ...original,
    id: generateId('pl'),
    startTick: original.startTick,
    lengthTicks: localTick,
    repeat: 1,
  };
  const rightHalf: Placement = {
    ...original,
    id: generateId('pl'),
    startTick: original.startTick + localTick,
    lengthTicks: effLen - localTick,
    repeat: 1,
  };

  return {
    ...comp,
    tracks: comp.tracks.map((t) => {
      if (t.id !== found.track.id) return t;
      const filtered = t.placements.filter((p) => p.id !== placementId);
      return {
        ...t,
        placements: sortTrackPlacements([...filtered, leftHalf, rightHalf]),
      };
    }),
    updatedAt: Date.now(),
  };
}

/**
 * Clone a set of placements with their startTicks offset by `deltaTicks`.
 * If `destTrackId` is provided, every clone lands in that track;
 * otherwise each clone lands in its source's track. Conflicts on landing
 * are resolved by the push primitive — applied once per clone in the
 * order they're inserted (sorted by destStartTick so earlier clones land
 * first and don't get pushed by their own siblings).
 *
 * Unknown ids in the input are silently skipped; an empty list is a
 * no-op (returns the same reference). Backbone for clipboard paste,
 * `⌘D`, and any future alt-drag-duplicate.
 */
export function duplicatePlacements(
  comp: Composition,
  ids: string[],
  deltaTicks: Tick,
  destTrackId?: string,
): Composition {
  if (ids.length === 0) return comp;

  type Cloneable = {
    sourcePlacement: Placement;
    targetTrackId: string;
    targetStartTick: Tick;
  };
  const cloneables: Cloneable[] = [];
  for (const id of ids) {
    const found = findPlacement(comp, id);
    if (!found) continue;
    cloneables.push({
      sourcePlacement: found.placement,
      targetTrackId: destTrackId ?? found.track.id,
      targetStartTick: Math.max(0, found.placement.startTick + deltaTicks),
    });
  }
  if (cloneables.length === 0) return comp;

  // Insert clones in destStartTick order so cascade pushes don't ricochet
  // sibling clones backwards.
  cloneables.sort((a, b) => a.targetStartTick - b.targetStartTick);

  let next = comp;
  for (const c of cloneables) {
    const cloneId = generateId('pl');
    const clone: Placement = { ...c.sourcePlacement, id: cloneId };
    // Add the clone (initially at sourcePlacement's startTick) to the
    // destination track…
    next = {
      ...next,
      tracks: next.tracks.map((t) =>
        t.id === c.targetTrackId
          ? { ...t, placements: sortTrackPlacements([...t.placements, clone]) }
          : t,
      ),
    };
    // …then move it to its target tick, which fires the push primitive
    // if needed.
    next = movePlacement(next, cloneId, c.targetTrackId, c.targetStartTick);
  }

  return { ...next, updatedAt: Date.now() };
}

/** A single flattened event in absolute-composition-tick space. */
export interface FlattenedEvent {
  /** Stable per-flatten id, useful for React keys in playback UI. */
  id: string;
  /** Absolute startTick within the composition. */
  startTick: Tick;
  durationTicks: Tick;
  stringIndex: number;
  fret: number;
  /** Mirrors PatternEvent.hammerOn — propagated through the flatten so the
   *  scheduler can pass it to the playback engine. */
  hammerOn?: boolean;
  /** Mirrors PatternEvent.pullOff. */
  pullOff?: boolean;
  /** Mirrors PatternEvent.tieToNext. The scheduler's mergeTies step folds
   *  the tied chain into a single sustained note before triggering. */
  tieToNext?: boolean;
  /** Mirrors PatternEvent.velocity — normalized [0, 1] loudness. */
  velocity?: number;
  /** Mirrors PatternEvent.vibrato. */
  vibrato?: 'slight' | 'wide';
  /** Mirrors PatternEvent.slide. */
  slide?: {
    type:
      | 'legato'
      | 'shift'
      | 'slide-in-below'
      | 'slide-in-above'
      | 'slide-out-down'
      | 'slide-out-up';
    toFret?: number;
  };
  /** Mirrors PatternEvent.bend. */
  bend?: {
    type: 'bend' | 'release' | 'pre-bend' | 'bend-release';
    semitones: number;
    points?: Array<{ at: number; semitones: number }>;
  };
  palmMute?: boolean;
  ghost?: boolean;
  dead?: boolean;
  tap?: boolean;
  harmonic?: { type: 'natural' | 'artificial' | 'pinch' | 'tap' | 'semi'; fret?: number };
  sourceMeta: {
    placementId: string;
    patternId: string;
    eventId: string;
    /** Composition Track id this event belongs to. Lets multi-track
     *  schedulers route to the right voice. */
    trackId: string;
    /** Which repeat iteration (0-indexed) this event came from. */
    repeatIndex: number;
  };
}

/** Flatten one track's placements into absolute-composition-tick events.
 *  Used by both `flattenComposition` (union across tracks) and the per-track
 *  scheduler source. */
export function flattenTrack(track: Track): FlattenedEvent[] {
  const out: FlattenedEvent[] = [];
  for (const p of track.placements) {
    const effLen = placementEffectiveLength(p);
    const transpose = p.transposeSemitones ?? 0;
    const fretCount =
      getInstrument(p.patternSnapshot.instrumentId)?.fretCount ?? DEFAULT_FRETBOARD_FRET_COUNT;
    for (let r = 0; r < p.repeat; r++) {
      const baseTick = p.startTick + r * effLen;
      for (const e of p.patternSnapshot.events) {
        if (e.startTick >= effLen) continue;
        const clippedDuration = Math.min(e.durationTicks, effLen - e.startTick);
        const newFret = e.fret + transpose;
        if (newFret < 0 || newFret > fretCount) continue;
        out.push({
          id: `${p.id}:${r}:${e.id}`,
          startTick: baseTick + e.startTick,
          durationTicks: clippedDuration,
          stringIndex: e.stringIndex,
          fret: newFret,
          hammerOn: e.hammerOn,
          pullOff: e.pullOff,
          tieToNext: e.tieToNext,
          velocity: e.velocity,
          vibrato: e.vibrato,
          slide: e.slide,
          bend: e.bend,
          palmMute: e.palmMute,
          ghost: e.ghost,
          dead: e.dead,
          tap: e.tap,
          harmonic: e.harmonic,
          sourceMeta: {
            placementId: p.id,
            patternId: p.patternSnapshot.id,
            eventId: e.id,
            trackId: track.id,
            repeatIndex: r,
          },
        });
      }
    }
  }
  out.sort((a, b) => a.startTick - b.startTick);
  return out;
}

/** Flatten the whole composition into a merged event stream. Each event
 *  carries `sourceMeta.trackId` so consumers that need per-track routing
 *  can re-split. Sorted by absolute tick globally. */
export function flattenComposition(comp: Composition): FlattenedEvent[] {
  const out: FlattenedEvent[] = [];
  for (const track of comp.tracks ?? []) {
    out.push(...flattenTrack(track));
  }
  out.sort((a, b) => a.startTick - b.startTick);
  return out;
}

const SWING_MIN = 0.5;
const SWING_MAX = 0.75;

function clampGroove(g: GrooveSpec): GrooveSpec {
  return { ...g, swing: Math.max(SWING_MIN, Math.min(SWING_MAX, g.swing)) };
}

export function setCompositionTempoMode(
  comp: Composition,
  mode: 'global' | 'inherit',
): Composition {
  return { ...comp, tempoMode: mode, updatedAt: Date.now() };
}

export function setCompositionGroove(
  comp: Composition,
  groove: GrooveSpec | null,
): Composition {
  return {
    ...comp,
    groove: groove === null ? null : clampGroove(groove),
    updatedAt: Date.now(),
  };
}

export function setCompositionGrooveMode(
  comp: Composition,
  mode: 'global' | 'inherit',
): Composition {
  return { ...comp, grooveMode: mode, updatedAt: Date.now() };
}

/** Set transpose offset in semitones for a placement. Clamps to [-24, +24].
 *  Returns the same composition reference when no change. */
export function setPlacementTranspose(
  comp: Composition,
  placementId: string,
  semitones: number,
): Composition {
  const clamped = Math.max(-24, Math.min(24, Math.round(semitones)));
  const found = findPlacement(comp, placementId);
  if (!found) return comp;
  if (found.placement.transposeSemitones === clamped) return comp;
  return {
    ...comp,
    tracks: replaceTrack(comp.tracks, found.track.id, (t) => ({
      ...t,
      placements: t.placements.map((p) =>
        p.id === placementId ? { ...p, transposeSemitones: clamped } : p,
      ),
    })),
    updatedAt: Date.now(),
  };
}

/** Truncate a placement to `lengthTicks` ticks (one cycle). Clamps to
 *  [PPQ, snapshot.durationTicks] — i.e., minimum one beat. If the placement
 *  previously had `repeat > 1`, collapses to `repeat = 1` as part of the same
 *  update (the user accepts losing the repeat grouping the moment they
 *  truncate). Returns same reference when no change. BLOCK/CLAMP: a resize can't
 *  grow past the next placement's start — it stops at the gap edge rather than
 *  pushing the neighbour. */
export function resizePlacement(
  comp: Composition,
  placementId: string,
  lengthTicks: Tick,
): Composition {
  const found = findPlacement(comp, placementId);
  if (!found) return comp;
  const snapshotDur = found.placement.patternSnapshot.durationTicks;
  const start = found.placement.startTick;
  const others = found.track.placements.filter((p) => p.id !== placementId);

  // BLOCK/CLAMP: the block can't grow past the next placement's start — it stops
  // at the gap edge rather than pushing the neighbour. Upper bound is also the
  // snapshot's full length.
  const nextStart = others.reduce(
    (min, p) => (p.startTick >= start ? Math.min(min, p.startTick) : min),
    Infinity,
  );
  const maxLen = nextStart === Infinity ? snapshotDur : Math.min(snapshotDur, nextStart - start);
  const clamped = Math.min(maxLen, Math.max(PPQ, lengthTicks));
  if (clamped === found.placement.lengthTicks && found.placement.repeat === 1) return comp;

  const updatedPlacement: Placement = { ...found.placement, lengthTicks: clamped, repeat: 1 };
  return {
    ...comp,
    tracks: comp.tracks.map((t) =>
      t.id === found.track.id
        ? { ...t, placements: sortTrackPlacements([...others, updatedPlacement]) }
        : t,
    ),
    updatedAt: Date.now(),
  };
}

/** Set the composition's loop flag. Returns same reference when no change. */
export function setCompositionLoop(comp: Composition, loop: boolean): Composition {
  if (comp.loop === loop) return comp;
  return { ...comp, loop, updatedAt: Date.now() };
}
