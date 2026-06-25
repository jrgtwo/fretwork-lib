/**
 * Sample-accurate scheduling of a `TempoEvent[]` onto the Tone.Transport BPM
 * signal. Called once at the start of playback; the returned `cancel` clears
 * all scheduled automations on stop so a fresh play doesn't replay stale
 * changes.
 *
 * Strategy: align Tone.Transport.PPQ to the project's PPQ (480) so the
 * `'<n>i'` tick-time syntax maps 1:1 with our authoring ticks. Each
 * event past index 0 schedules a `setValueAtTime` (step) or
 * `linearRampToValueAtTime` (linear) on Tone.Transport.bpm. The first
 * event is applied immediately (via the `setBpm` callback) before
 * scheduling because Tone.Transport doesn't accept a setValueAtTime at
 * the current cursor reliably. Alongside each scheduled audio-rate
 * change, a transport.scheduleOnce JS callback fires at the same tick
 * so the caller's setter (typically a store action) sees the same value
 * — keeping the UI's BPM display in sync with the actual playing tempo.
 *
 * Source-agnostic: callers pass an event array directly and a setter
 * callback. The setter is responsible for whatever side effects keep
 * the caller's source of truth coherent — typically pushing into a
 * Zustand store so subscribers (UI components + the audio Metronome
 * instance) stay aligned.
 */

import * as Tone from 'tone';
import type { TempoEvent } from '../types';
import { PPQ } from '../timebase';

export type BpmSetter = (bpm: number) => void;

/**
 * Schedule a series of `TempoEvent`s on Tone.Transport.bpm. When the array
 * is empty the setter is called once with `fallbackBpm` and no schedule
 * is registered.
 */
export function applyTempoAutomation(
  events: TempoEvent[],
  fallbackBpm: number,
  setBpm: BpmSetter,
): () => void {
  if (events.length === 0) {
    setBpm(fallbackBpm);
    return () => {};
  }

  // Align Tone's transport tick resolution with the project's. Idempotent.
  const transport = Tone.getTransport();
  try {
    if (transport.PPQ !== PPQ) transport.PPQ = PPQ;
  } catch {
    // Some Tone builds may guard PPQ as readonly when the transport is
    // running. Best-effort — if we can't align, the schedule below uses
    // Tone's default PPQ and tick offsets will be wrong, but at least the
    // initial bpm still applies.
  }

  // Wipe any previously-scheduled automations so a re-play starts clean.
  transport.bpm.cancelScheduledValues(0);

  // Apply the first event immediately so the transport starts at the
  // right tempo from tick 0.
  setBpm(events[0].bpm);

  const scheduleIds: number[] = [];

  for (let i = 1; i < events.length; i++) {
    const event = events[i];
    const tickTime = `${Math.max(0, Math.round(event.atTick))}i`;
    try {
      if (event.interpolation === 'linear') {
        transport.bpm.linearRampToValueAtTime(event.bpm, tickTime);
      } else {
        transport.bpm.setValueAtTime(event.bpm, tickTime);
      }
      // Mirror the change into the caller's setter at the same tick so
      // UI state (and any subscribers downstream) stay in sync with the
      // audio-side BPM. The transport.bpm Signal is sample-accurate; the
      // JS callback runs slightly later on Tone's draw loop, which is
      // imperceptible for UI display purposes.
      const id = transport.scheduleOnce(() => {
        setBpm(event.bpm);
      }, tickTime);
      scheduleIds.push(id);
    } catch {
      // setValueAtTime can throw if Tone considers the time invalid
      // (e.g., past values when scheduling out-of-order). Swallow so one
      // bad event doesn't kill the rest of the schedule.
    }
  }

  return () => {
    try {
      transport.bpm.cancelScheduledValues(0);
    } catch {
      // ignore
    }
    for (const id of scheduleIds) {
      try {
        transport.clear(id);
      } catch {
        // ignore
      }
    }
  };
}
