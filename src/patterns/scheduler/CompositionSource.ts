/**
 * CompositionSource — wraps a Composition as an EventStream for the scheduler.
 *
 * Flattens all placements (with their repeats and per-snapshot events) into a single
 * pre-sorted absolute-tick array. For Phase 1 this happens at construction. If
 * compositions ever grow large enough to make construction expensive, swap this for
 * lazy slicing per placement.
 */
import type { Composition } from '../types';
import { flattenComposition, placementEffectiveLength } from '../composition-ops';
import { mergeTies } from '../tie-merge';
import type { EventStream, ScheduledEvent } from './EventScheduler';

export class CompositionSource implements EventStream {
  private _sorted: ScheduledEvent[];
  private _durationTicks: number;
  /** Tick ranges + ids for each placement in this composition. Used by
   *  EventScheduler to detect placement boundary crossings. */
  readonly placementBoundaries: ReadonlyArray<{
    placementId: string;
    startTick: number;
    endTick: number;
  }>;

  constructor(composition: Composition) {
    const flat = flattenComposition(composition);
    // Merge tied chains across placements at the flattened level — a tie
    // that spans a placement boundary is rare in practice but still gets
    // handled correctly by the absolute-tick adjacency check.
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
    let max = 0;
    const boundaries: { placementId: string; startTick: number; endTick: number }[] = [];
    for (const track of composition.tracks ?? []) {
      for (const p of track.placements) {
        const end = p.startTick + placementEffectiveLength(p) * p.repeat;
        if (end > max) max = end;
        boundaries.push({ placementId: p.id, startTick: p.startTick, endTick: end });
      }
    }
    this._durationTicks = max;
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
