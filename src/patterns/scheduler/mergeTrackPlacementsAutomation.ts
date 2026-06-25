/**
 * Build a single tempo + time-signature automation pair from a Track's
 * placements. Each placement contributes:
 *
 *   1. A leading boundary event at the placement's startTick (per repeat
 *      cycle), drawn from the pattern's *static* tempo / TS values. This
 *      makes "inherit" mode feel correct even when a placed pattern has
 *      no automation tracks: the tempo and meter snap back to the new
 *      pattern's authored values at each boundary.
 *   2. Each event of the pattern's `tempoTrack` / `timeSignatureTrack`,
 *      re-emitted in composition-tick space (offset by the cycle base),
 *      expanded across `placement.repeat`, and dropped past
 *      `placement.lengthTicks` if set.
 *
 * The leading event is suppressed when the pattern's automation already
 * carries an event at `atTick === 0` — that one takes the boundary slot
 * naturally.
 *
 * Used by composition `inherit` mode: instead of the static
 * `composition.tempoTrack`, we synthesize one merged stream from the
 * "tempo lead" lane (today, `tracks[0]`). The result is a flat
 * `TempoEvent[]` / `TimeSignatureEvent[]` suitable for direct hand-off to
 * `applyTempoAutomation` / `applyTimeSignatureAutomation`.
 *
 * Conflict resolution: events arriving at the exact same composition tick
 * keep their input order (Array.prototype.sort is stable in modern JS).
 * Empty input → empty outputs.
 */

import type { Pattern, TempoEvent, TimeSignatureEvent, Track } from '../types';
import { placementEffectiveLength } from '../composition-ops';

export interface MergedAutomation {
  tempoEvents: TempoEvent[];
  tsEvents: TimeSignatureEvent[];
}

function leadingTempoEvent(pat: Pattern, cycleBase: number): TempoEvent | null {
  // If the pattern's tempoTrack already covers atTick=0, that event will
  // be emitted by the normal loop — no need to synthesize a leader.
  const first = pat.tempoTrack?.[0];
  if (first && first.atTick === 0) return null;
  if (pat.suggestedBpm === null) return null;
  return { atTick: cycleBase, bpm: pat.suggestedBpm, interpolation: 'step' };
}

function leadingTsEvent(pat: Pattern, cycleBase: number): TimeSignatureEvent | null {
  const first = pat.timeSignatureTrack?.[0];
  if (first && first.atTick === 0) return null;
  return {
    atTick: cycleBase,
    numerator: pat.timeSignature.numerator,
    denominator: pat.timeSignature.denominator,
  };
}

export function mergeTrackPlacementsAutomation(track: Track): MergedAutomation {
  const tempoEvents: TempoEvent[] = [];
  const tsEvents: TimeSignatureEvent[] = [];

  for (const p of track.placements) {
    const effLen = placementEffectiveLength(p);
    const pat = p.patternSnapshot;
    for (let r = 0; r < p.repeat; r++) {
      const cycleBase = p.startTick + r * effLen;

      const leadTempo = leadingTempoEvent(pat, cycleBase);
      if (leadTempo) tempoEvents.push(leadTempo);
      for (const ev of pat.tempoTrack ?? []) {
        if (ev.atTick >= effLen) continue;
        tempoEvents.push({
          atTick: cycleBase + ev.atTick,
          bpm: ev.bpm,
          interpolation: ev.interpolation,
        });
      }

      const leadTs = leadingTsEvent(pat, cycleBase);
      if (leadTs) tsEvents.push(leadTs);
      for (const ev of pat.timeSignatureTrack ?? []) {
        if (ev.atTick >= effLen) continue;
        tsEvents.push({
          atTick: cycleBase + ev.atTick,
          numerator: ev.numerator,
          denominator: ev.denominator,
        });
      }
    }
  }

  tempoEvents.sort((a, b) => a.atTick - b.atTick);
  tsEvents.sort((a, b) => a.atTick - b.atTick);
  return { tempoEvents, tsEvents };
}
