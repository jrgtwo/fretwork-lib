/**
 * Tick/beat/second conversion helpers.
 *
 * One quarter note = PPQ ticks. PPQ is fixed at 480 — high enough to express
 * triplets, sixteenths, and 32nd-note dotted variants without rounding.
 */
import type { PatternTimeSignature, StepLength, Tick } from './types';

export const PPQ = 480;

/** How many ticks one step of the given step length spans. */
export function stepLengthToTicks(step: StepLength): Tick {
  switch (step) {
    case 'quarter':
      return PPQ;
    case 'eighth':
      return PPQ / 2;
    case 'sixteenth':
      return PPQ / 4;
  }
}

/** Ticks per bar at the given time signature. */
export function ticksPerBar(ts: PatternTimeSignature): Tick {
  // numerator beats, each beat = (4 / denominator) quarter notes.
  return ts.numerator * (PPQ * 4 / ts.denominator);
}

/** Ticks per beat at the given time signature. */
export function ticksPerBeat(ts: PatternTimeSignature): Tick {
  return PPQ * 4 / ts.denominator;
}

/** Seconds per tick at the given BPM (using quarter-note BPM as the convention). */
export function secondsPerTick(bpm: number): number {
  return 60 / bpm / PPQ;
}

/** Seconds elapsed between two ticks at the given BPM. */
export function ticksToSeconds(ticks: Tick, bpm: number): number {
  return ticks * secondsPerTick(bpm);
}

/** Default Pattern duration when a new pattern is created (4 bars at the given TS). */
export function defaultPatternDurationTicks(ts: PatternTimeSignature): Tick {
  return 4 * ticksPerBar(ts);
}

/** Snap a tick value to the nearest grid line of `gridTicks`. Defaults to 16th-note grid. */
export function snapTick(tick: Tick, gridTicks: Tick = PPQ / 4): Tick {
  if (gridTicks <= 0) return tick;
  return Math.round(tick / gridTicks) * gridTicks;
}
