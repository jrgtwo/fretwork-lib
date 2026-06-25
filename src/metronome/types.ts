/**
 * Metronome public types — all consumer-facing shapes are here.
 */
import type { Sampler, Synth } from 'tone';

/**
 * Subdivisions split each main metronome tick into N sub-ticks. The label is the
 * conventional musical note value at /4 time signatures; in /8 signatures it maps
 * to the same N (e.g. '8ths' = 2 sub-ticks per main tick regardless of the time
 * signature's note value).
 */
export type SubdivisionId = 'off' | '8ths' | 'triplets' | '16ths' | 'sextuplets';

/** How many ticks (including the main beat) make up one beat at this subdivision.
 *  Off=1, 8ths=2, triplets=3, 16ths=4, sextuplets=6. */
export function subdivisionCount(id: SubdivisionId): number {
  switch (id) {
    case 'off':       return 1;
    case '8ths':      return 2;
    case 'triplets':  return 3;
    case '16ths':     return 4;
    case 'sextuplets':return 6;
  }
}

/** Whether the swing slider has any effect for this subdivision. Triplets and
 *  sextuplets group as 3s — swing pairs them awkwardly — so the slider is
 *  ignored. The value is still preserved across changes. */
export function subdivisionSupportsSwing(id: SubdivisionId): boolean {
  return id === '8ths' || id === '16ths';
}

/**
 * Time-warp a tick position by the active swing setting.
 *
 * For supported subdivisions (8ths, 16ths) at swing > 0.5, sub-ticks pair as
 * [down, up]; the down half of each pair stretches to fill `2*s*ticksPerSub`
 * and the up half compresses into the remaining `2*(1-s)*ticksPerSub`. Pairs
 * are anchored at the timeline origin (tick 0).
 *
 * Returns the input unchanged when swing is inactive (subdivision off/triplets/
 * sextuplets, or swing == 0.5). Used by the pattern EventScheduler to apply
 * the same swing feel to pattern notes that the metronome applies to clicks.
 */
export function applySwingToTick(
  tick: number,
  subdivision: SubdivisionId,
  swing: number,
  ticksPerBeat: number,
): number {
  if (!subdivisionSupportsSwing(subdivision)) return tick;
  if (swing <= 0.5) return tick;
  const n = subdivisionCount(subdivision);
  const ticksPerSub = ticksPerBeat / n;
  const pairTicks = 2 * ticksPerSub;
  const pairIndex = Math.floor(tick / pairTicks);
  const positionInPair = tick - pairIndex * pairTicks;
  let swungInPair: number;
  if (positionInPair < ticksPerSub) {
    swungInPair = positionInPair * 2 * swing;
  } else {
    const excess = positionInPair - ticksPerSub;
    swungInPair = 2 * swing * ticksPerSub + excess * 2 * (1 - swing);
  }
  return pairIndex * pairTicks + swungInPair;
}

export interface TimeSignature {
  /** Stable identifier for URL state and dropdowns, e.g. "4/4". */
  readonly id: string;
  /** Pulses per measure. */
  readonly numerator: number;
  /** Note value of one pulse: 4 = quarter, 8 = eighth, 2 = half. */
  readonly denominator: 2 | 4 | 8 | 16;
  /** Default beat indices (0-based) that get accented when no override is provided. */
  readonly defaultAccents: readonly number[];
}

/**
 * Payload delivered to every tick handler. Carries enough information for an external
 * caller (e.g. "change the active scale every 4 measures") to make decisions without
 * tracking its own beat counters.
 */
export interface MetronomeTickEvent {
  /** Beat index within the current measure, 0-based. e.g. 0..3 in 4/4. */
  readonly beat: number;
  /** Cumulative measure count since `start()` was called, 0-based. */
  readonly measure: number;
  /** Cumulative tick count since `start()` was called, 0-based. Useful for modulo math. */
  readonly tickIndex: number;
  /** True when the current beat is in the active accent set. */
  readonly isAccent: boolean;
  /** A snapshot of the current time signature. */
  readonly timeSignature: TimeSignature;
  /** Current tempo in BPM (quarter-note pulses per minute). */
  readonly bpm: number;
  /** AudioContext.currentTime at which this tick was scheduled to fire. */
  readonly audioTime: number;
}

/**
 * Payload delivered to subdivision handlers. Fires between main beats when a
 * subdivision is active.
 */
export interface MetronomeSubdivisionEvent {
  /** Beat index this sub-tick belongs to, 0-based. */
  readonly beat: number;
  /** Cumulative measure count since `start()`. */
  readonly measure: number;
  /** Which sub-tick within the beat (1..N-1; index 0 is the main beat and fires
   *  via `tick`, not `subdivision`). */
  readonly subdivisionIndex: number;
  /** N — total sub-ticks per beat at the current setting (2 for 8ths, 3 for triplets,
   *  4 for 16ths, 6 for sextuplets). */
  readonly subdivisionsPerBeat: number;
  /** A snapshot of the current time signature. */
  readonly timeSignature: TimeSignature;
  /** Current tempo in BPM. */
  readonly bpm: number;
  /** AudioContext.currentTime at which this sub-tick was scheduled to fire. */
  readonly audioTime: number;
}

/**
 * Event handler map. All handlers are optional. Handlers can also be registered
 * dynamically via `metronome.on('tick', cb)` after construction.
 */
export interface MetronomeEvents {
  /** Fires on every beat (every numerator pulse). */
  tick?: (event: MetronomeTickEvent) => void;
  /** Fires only on accent beats — a strict subset of `tick`. */
  accent?: (event: MetronomeTickEvent) => void;
  /** Fires on beat 0 of each measure — a strict subset of `tick`. */
  measure?: (event: MetronomeTickEvent) => void;
  /** Fires on every subdivision sub-tick between main beats (when `subdivision !== 'off'`). */
  subdivision?: (event: MetronomeSubdivisionEvent) => void;
  /** Fires when the metronome transitions from stopped → running. */
  start?: () => void;
  /** Fires when the metronome transitions from running → stopped. */
  stop?: () => void;
  /** Fires when BPM changes (also during runtime via setBpm). */
  bpmChange?: (bpm: number) => void;
  /** Fires when the time signature changes. */
  timeSignatureChange?: (timeSignature: TimeSignature) => void;
  /** Fires when the subdivision setting changes. */
  subdivisionChange?: (subdivision: SubdivisionId) => void;
  /** Fires when the swing amount changes. */
  swingChange?: (swing: number) => void;
}

/**
 * A click sound source. The lib accepts any of these forms and normalizes internally:
 * - A pre-built Tone.Synth (consumer manages its lifecycle)
 * - A pre-built Tone.Sampler
 * - { url } — the lib loads the URL into a Tone.Sampler
 */
export type ClickSound =
  | Synth
  | Sampler
  | { url: string };

export interface MetronomeOptions {
  /** Initial tempo. Default 120. Clamped to 40..240. */
  bpm?: number;
  /**
   * Time signature — pass either a `TimeSignature` object or its `id` (e.g. "4/4").
   * Default: 4/4.
   */
  timeSignature?: TimeSignature | string;
  /**
   * Override the default accent pattern for the chosen time signature. 0-based beat
   * indices. Defaults to the time signature's `defaultAccents`.
   */
  accents?: readonly number[];
  /** 0..1, default 0.7. */
  volume?: number;
  /** When true, the audio output is silenced but events still fire. */
  muted?: boolean;
  /**
   * Whether accent beats sound different from regular beats. When false, every beat
   * uses the regular click voice (event payloads' `isAccent` flag still reflects the
   * configured accent positions — only the audio differentiation is disabled).
   * Default: true.
   */
  accentEnabled?: boolean;
  /** Custom click sounds (otherwise the default Tone.Synth voices are used). */
  sounds?: { accent?: ClickSound; regular?: ClickSound; subdivision?: ClickSound };
  /** Subdivisions split each main tick into N sub-ticks. Default: 'off'. */
  subdivision?: SubdivisionId;
  /** Swing amount in [0.5, 0.75]. 0.5 = straight, 0.67 ≈ triplet/jazz swing,
   *  0.75 = hard shuffle. Only affects '8ths' and '16ths' subdivisions. */
  swing?: number;
  /** Initial event handler map (alternative to `metronome.on(...)`). */
  events?: MetronomeEvents;
}

/** Snapshot of a metronome's state at a moment in time. Consumers usually read these
 * via the `useMetronome` hook rather than the class directly. */
export interface MetronomeState {
  isRunning: boolean;
  bpm: number;
  timeSignature: TimeSignature;
  accents: readonly number[];
  accentEnabled: boolean;
  volume: number;
  muted: boolean;
  /** Last beat that was emitted. -1 before any tick has fired since the last start. */
  currentBeat: number;
  /** Last measure that was emitted. -1 before any tick has fired since the last start. */
  currentMeasure: number;
  /** Current subdivision setting. */
  subdivision: SubdivisionId;
  /** Current swing amount in [0.5, 0.75]. */
  swing: number;
}
