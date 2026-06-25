/**
 * Pure helpers for resolving point-in-time values from a tempo or
 * time-signature automation track.
 *
 *   - `effectiveBpm(track, fallback, atTick)` returns the BPM that should be
 *     audible at `atTick`. When the track is empty, falls back to `fallback`.
 *     When the active event uses `linear` interpolation, the returned value is
 *     ramped between the previous event and the active one.
 *
 *   - `effectiveTimeSignature(track, fallback, atTick)` returns the
 *     numerator/denominator that should be active at `atTick`. TS changes are
 *     always step-interpolated (musical convention — you don't ramp a meter).
 *
 *   - `isAutomated(track)` returns true if the track has more than one event
 *     (a length-1 track that just records the initial value isn't "automation"
 *     for UI purposes — the BPM stepper / TS picker should still be editable).
 *
 * Tracks must be sorted by `atTick` ascending. Both helpers assume this; the
 * import validator guarantees it on data that comes in via the import path,
 * and authoring code should preserve it by construction.
 */

import type {
  PatternTimeSignature,
  TempoEvent,
  TimeSignatureEvent,
  Tick,
} from './types';

export function effectiveBpm(
  track: readonly TempoEvent[],
  fallback: number,
  atTick: Tick,
): number {
  if (track.length === 0) return fallback;

  // Locate the active event = the last event with atTick <= the query point.
  let activeIdx = -1;
  for (let i = 0; i < track.length; i++) {
    if (track[i].atTick <= atTick) activeIdx = i;
    else break;
  }
  if (activeIdx === -1) {
    // Query precedes the first event; use the first event's bpm.
    return track[0].bpm;
  }
  const active = track[activeIdx];
  const next = track[activeIdx + 1];
  // Interpolation lives on the *destination* event: if `next` is linear, ramp
  // from `active.bpm` to `next.bpm` across [active.atTick, next.atTick].
  if (next && next.interpolation === 'linear') {
    const span = next.atTick - active.atTick;
    if (span <= 0) return next.bpm;
    const t = Math.max(0, Math.min(1, (atTick - active.atTick) / span));
    return active.bpm + (next.bpm - active.bpm) * t;
  }
  return active.bpm;
}

export function effectiveTimeSignature(
  track: readonly TimeSignatureEvent[],
  fallback: PatternTimeSignature,
  atTick: Tick,
): PatternTimeSignature {
  if (track.length === 0) return fallback;
  let active: TimeSignatureEvent | null = null;
  for (const ev of track) {
    if (ev.atTick <= atTick) active = ev;
    else break;
  }
  if (active == null) {
    return { numerator: track[0].numerator, denominator: track[0].denominator };
  }
  return { numerator: active.numerator, denominator: active.denominator };
}

export function isAutomated(track: readonly { atTick: Tick }[]): boolean {
  return track.length > 1;
}
