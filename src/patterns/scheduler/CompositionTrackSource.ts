/**
 * CompositionTrackSource — exposes a single composition Track's placements
 * as an EventStream for one EventScheduler. Used by the multi-track
 * playback engine: every Track gets its own scheduler reading its own
 * source, all driven by the shared metronome.
 *
 * The implementation mirrors the legacy `CompositionSource` but scopes to
 * one track's placements + their absolute tick offsets. Tie merging runs
 * per-track since ties never span tracks (different strings entirely).
 */
import type { Composition, Track } from '../types';
import { flattenTrack, placementEffectiveLength } from '../composition-ops';
import { mergeTies } from '../tie-merge';
import type { EventStream, ScheduledEvent } from './EventScheduler';

export class CompositionTrackSource implements EventStream {
  private _sorted: ScheduledEvent[];
  private _durationTicks: number;
  /** Placement boundaries for THIS track only. */
  readonly placementBoundaries: ReadonlyArray<{
    placementId: string;
    startTick: number;
    endTick: number;
  }>;

  /**
   * @param composition Composition to read this track's placements from.
   * @param trackId Track to scope to.
   * @param loopBoundaryTicks Optional override for `durationTicks` — used by
   *   MultiTrackPlayback so every per-track scheduler loops at the
   *   composition's total duration rather than each track's per-track max
   *   end. Without this, tracks of unequal lengths drift out of sync because
   *   each loops at its own boundary.
   */
  constructor(
    composition: Composition,
    public readonly trackId: string,
    loopBoundaryTicks?: number,
  ) {
    const track = composition.tracks.find((t) => t.id === trackId);
    if (!track) {
      this._sorted = [];
      this._durationTicks = loopBoundaryTicks ?? 0;
      this.placementBoundaries = [];
      return;
    }
    const flat = flattenTrack(track);
    const merged = mergeTies(flat);
    this._sorted = merged.map((e) => ({
      id: e.id,
      startTick: e.startTick,
      durationTicks: e.durationTicks,
      stringIndex: e.stringIndex,
      fret: e.fret,
      hammerOn: e.hammerOn,
      pullOff: e.pullOff,
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
        patternId: e.sourceMeta.patternId,
        eventId: e.sourceMeta.eventId,
        placementId: e.sourceMeta.placementId,
      },
    }));
    let trackMax = 0;
    const boundaries: { placementId: string; startTick: number; endTick: number }[] = [];
    for (const p of track.placements) {
      const end = p.startTick + placementEffectiveLength(p) * p.repeat;
      if (end > trackMax) trackMax = end;
      boundaries.push({ placementId: p.id, startTick: p.startTick, endTick: end });
    }
    // Honor explicit loop-boundary override (composition-wide loop point).
    this._durationTicks = loopBoundaryTicks ?? trackMax;
    boundaries.sort((a, b) => a.startTick - b.startTick);
    this.placementBoundaries = boundaries;
  }

  get durationTicks(): number {
    return this._durationTicks;
  }

  eventsInRange(fromTick: number, toTick: number): ScheduledEvent[] {
    const out: ScheduledEvent[] = [];
    for (const e of this._sorted) {
      if (e.startTick >= toTick) break;
      if (e.startTick >= fromTick) out.push(e);
    }
    return out;
  }
}

/** Convenience: build one CompositionTrackSource per track. */
export function buildTrackSources(composition: Composition): Map<string, CompositionTrackSource> {
  const out = new Map<string, CompositionTrackSource>();
  for (const track of composition.tracks ?? []) {
    out.set(track.id, new CompositionTrackSource(composition, track.id));
  }
  return out;
}

/** Re-exported for callers that want the Track type alongside. */
export type { Track };
