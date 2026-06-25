/**
 * Metronome — the core class. Wraps Tone.js's Transport to provide a sample-accurate
 * clock with configurable time signature, accent beats, and a typed event surface.
 *
 * The class is intentionally headless: no React, no UI. Use `useMetronome` for the
 * React-friendly version, or use this directly in non-React contexts.
 */
import * as Tone from 'tone';
import type {
  ClickSound,
  MetronomeEvents,
  MetronomeOptions,
  MetronomeSubdivisionEvent,
  MetronomeTickEvent,
  SubdivisionId,
  TimeSignature,
} from './types';
import {
  subdivisionCount,
  subdivisionSupportsSwing,
} from './types';
import {
  DEFAULT_TIME_SIGNATURE_ID,
  getTimeSignature,
  tickSubdivision,
} from './time-signatures';
import {
  createDefaultClickVoices,
  normalizeClickSound,
  triggerClick,
  type NormalizedClickVoices,
} from './click-sounds';
import { MasterBus } from '../playback/voices/MasterBus';
import { getEffectiveLatencySec } from '../playback/audio-context';

const MIN_BPM = 40;
const MAX_BPM = 240;

const SWING_MIN = 0.5;
const SWING_MAX = 0.95;

function clampSwing(swing: number): number {
  if (!Number.isFinite(swing)) return SWING_MIN;
  return Math.max(SWING_MIN, Math.min(SWING_MAX, swing));
}

/** Seconds per main metronome tick at the given time-sig denominator and BPM.
 *  /4 → quarter note, /8 → eighth note, /2 → half, /16 → sixteenth.
 *  Generally: tickDuration = (4 / denom) * (60 / bpm). */
function tickDurationSeconds(ts: TimeSignature, bpm: number): number {
  return (4 / ts.denominator) * (60 / bpm);
}

function clampBpm(bpm: number): number {
  return Math.max(MIN_BPM, Math.min(MAX_BPM, bpm));
}

function resolveTimeSignature(input: TimeSignature | string | undefined): TimeSignature {
  if (!input) return getTimeSignature(DEFAULT_TIME_SIGNATURE_ID)!;
  if (typeof input === 'string') {
    const ts = getTimeSignature(input);
    if (!ts) throw new Error(`Unknown time signature id: ${input}`);
    return ts;
  }
  return input;
}

type Handler<K extends keyof MetronomeEvents> = NonNullable<MetronomeEvents[K]>;

export class Metronome {
  private _bpm: number;
  private _timeSignature: TimeSignature;
  private _accents: readonly number[];
  private _accentEnabled: boolean;
  private _volume: number;
  private _muted: boolean;
  private _subdivision: SubdivisionId;
  private _swing: number;
  private _isRunning = false;

  // Counters reset on every start()
  private _tickIndex = 0;

  // Event handlers — Set per event allows multiple subscribers per type.
  private _listeners: { [K in keyof MetronomeEvents]?: Set<Handler<K>> } = {};

  // Tone wiring — created lazily on first start() so constructing a Metronome doesn't
  // require an AudioContext (important for SSR and jsdom-based tests).
  private _voices: NormalizedClickVoices | null = null;
  private _pendingSounds:
    | { accent?: ClickSound; regular?: ClickSound; subdivision?: ClickSound }
    | null = null;
  private _scheduledEventId: number | null = null;
  /** Pending setTimeout handles for sub-tick visual/event dispatch. Cleared on
   *  stop() and dispose() so a stopped metronome doesn't keep firing sub-events. */
  private _pendingSubTimeouts: Set<ReturnType<typeof setTimeout>> = new Set();

  constructor(options: MetronomeOptions = {}) {
    this._bpm = clampBpm(options.bpm ?? 120);
    this._timeSignature = resolveTimeSignature(options.timeSignature);
    this._accents = options.accents ?? this._timeSignature.defaultAccents;
    this._accentEnabled = options.accentEnabled ?? true;
    this._volume = options.volume ?? 0.7;
    this._muted = options.muted ?? false;
    this._subdivision = options.subdivision ?? 'off';
    this._swing = clampSwing(options.swing ?? 0.5);

    if (options.sounds) {
      this._pendingSounds = { ...options.sounds };
    }

    if (options.events) {
      for (const [name, handler] of Object.entries(options.events)) {
        if (handler) this.on(name as keyof MetronomeEvents, handler as never);
      }
    }
  }

  /** Lazily build the Tone voices on first audio use. */
  private _ensureVoices(): NormalizedClickVoices {
    if (this._voices) return this._voices;
    this._voices = createDefaultClickVoices();
    if (this._pendingSounds?.accent) {
      this._voices.accent = normalizeClickSound(this._pendingSounds.accent, this._voices.accent, this._voices.ownedVoices);
    }
    if (this._pendingSounds?.regular) {
      this._voices.regular = normalizeClickSound(this._pendingSounds.regular, this._voices.regular, this._voices.ownedVoices);
    }
    if (this._pendingSounds?.subdivision) {
      this._voices.subdivision = normalizeClickSound(this._pendingSounds.subdivision, this._voices.subdivision, this._voices.ownedVoices);
    }
    this._pendingSounds = null;
    return this._voices;
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────────

  /** Eagerly unlock the AudioContext, build the click voices, and wait for
   *  any in-flight Tone.Buffer loads (most commonly Tone.Sampler sample
   *  downloads). Safe to call multiple times — every step is idempotent.
   *  Use this to pre-pay the cold-start cost during a visible setup window
   *  (e.g. while a pre-roll countdown plays) so the actual `start()` call
   *  later has minimal latency to contend with. */
  async preWarm(): Promise<void> {
    await Tone.start();
    this._ensureVoices();
    // Build the MasterBus and wait for its reverb IR to render. Track audio
    // routes through MasterBus → reverb → destination, so until the convolver
    // has its impulse response, every track note is silent (click voices
    // bypass MasterBus, which is why this only affects content audio).
    await MasterBus.warmup();
    await Tone.loaded();
  }

  async start(startTick = 0): Promise<void> {
    if (this._isRunning) return;
    // Reserve the running slot immediately so a concurrent call to start()
    // that arrives while we await Tone.start() is rejected by the guard
    // above. Without this, two concurrent callers both pass the guard,
    // each register their own scheduleRepeat for _dispatchTick, and the
    // second call's ID overwrites _scheduledEventId — leaking the first
    // callback permanently and producing a double-click on every subsequent
    // start.
    this._isRunning = true;
    try {
      // Tone.start() unlocks the AudioContext on first user interaction.
      await Tone.start();

      // Build voices now that AudioContext is alive.
      this._ensureVoices();

      // Wait for the MasterBus reverb IR to render. Track audio routes
      // through MasterBus → reverb → destination, so without a ready IR the
      // convolver eats every track note. Click voices bypass MasterBus, so
      // the symptom is "click plays but content silent" for the first
      // ~300-700ms of playback.
      await MasterBus.warmup();

      // Wait for any pending Tone.Buffer loads (e.g. Tone.Sampler samples
      // still downloading). Without this, transport.start() fires before
      // the first BufferSource exists, so the first triggerAttackRelease
      // is silently dropped — the "missing first beat" symptom.
      await Tone.loaded();

      const transport = Tone.getTransport();
      transport.bpm.value = this._bpm;
      // Begin at the requested content tick (the blue cursor); 0 = the start.
      // Setting ticks (not position) keeps us in our PPQ-aligned tick domain.
      transport.ticks = Math.max(0, Math.round(startTick));
      this._tickIndex = 0;

      const interval = tickSubdivision(this._timeSignature);
      this._scheduledEventId = transport.scheduleRepeat((audioTime) => {
        this._dispatchTick(audioTime);
      }, interval, 0);

      // Schedule transport.start() one lookAhead window in the future so
      // Tone's scheduler has runway to prep the first-tick callbacks before
      // their audio time arrives. Without this, the first callback fires
      // with audioTime already in the past (because the scheduler worker
      // hasn't tick'd yet), producing a degraded or dropped first event.
      // Cost: a fixed ~100ms latency from start() call to first audible
      // note — but every event after is sample-accurate.
      const lookAhead = Tone.getContext().lookAhead;
      transport.start(Tone.now() + lookAhead);
      this._fire('start');
    } catch (err) {
      // AudioContext unlock or transport start failed. Roll back the
      // reservation so a subsequent play attempt can retry cleanly.
      this._isRunning = false;
      throw err;
    }
  }

  stop(): void {
    if (!this._isRunning) return;
    const transport = Tone.getTransport();
    if (this._scheduledEventId != null) {
      transport.clear(this._scheduledEventId);
      this._scheduledEventId = null;
    }
    transport.stop();
    this._isRunning = false;
    this._tickIndex = 0;
    this._cancelPendingSubTimeouts();
    this._fire('stop');
  }

  async toggle(): Promise<boolean> {
    if (this._isRunning) {
      this.stop();
    } else {
      await this.start();
    }
    return this._isRunning;
  }

  // ─── Configuration ────────────────────────────────────────────────────────────

  setBpm(bpm: number): void {
    const clamped = clampBpm(bpm);
    if (clamped === this._bpm) return;
    this._bpm = clamped;
    Tone.getTransport().bpm.value = clamped;
    this._fire('bpmChange', clamped);
  }

  setTimeSignature(input: TimeSignature | string): void {
    const ts = resolveTimeSignature(input);
    if (ts.id === this._timeSignature.id) return;
    this._timeSignature = ts;
    this._accents = ts.defaultAccents;
    // If running, re-schedule with the new subdivision.
    if (this._isRunning) {
      const transport = Tone.getTransport();
      if (this._scheduledEventId != null) {
        transport.clear(this._scheduledEventId);
      }
      this._tickIndex = 0;
      this._scheduledEventId = transport.scheduleRepeat((audioTime) => {
        this._dispatchTick(audioTime);
      }, tickSubdivision(ts), 0);
    }
    this._fire('timeSignatureChange', ts);
  }

  setAccents(beatIndices: readonly number[]): void {
    this._accents = [...beatIndices];
  }

  setAccentEnabled(enabled: boolean): void {
    this._accentEnabled = enabled;
  }

  setVolume(value: number): void {
    this._volume = Math.max(0, Math.min(1, value));
  }

  setMuted(muted: boolean): void {
    this._muted = muted;
  }

  setSubdivision(id: SubdivisionId): void {
    if (id === this._subdivision) return;
    this._subdivision = id;
    this._fire('subdivisionChange', id);
  }

  setSwing(swing: number): void {
    const clamped = clampSwing(swing);
    if (clamped === this._swing) return;
    this._swing = clamped;
    this._fire('swingChange', clamped);
  }

  setSounds(sounds: { accent?: ClickSound; regular?: ClickSound; subdivision?: ClickSound }): void {
    if (!this._voices) {
      // Defer until voices exist (i.e. until first start()).
      this._pendingSounds = { ...this._pendingSounds, ...sounds };
      return;
    }
    if (sounds.accent) {
      this._voices.accent = normalizeClickSound(sounds.accent, this._voices.accent, this._voices.ownedVoices);
    }
    if (sounds.regular) {
      this._voices.regular = normalizeClickSound(sounds.regular, this._voices.regular, this._voices.ownedVoices);
    }
    if (sounds.subdivision) {
      this._voices.subdivision = normalizeClickSound(sounds.subdivision, this._voices.subdivision, this._voices.ownedVoices);
    }
  }

  // ─── Events ───────────────────────────────────────────────────────────────────

  on<K extends keyof MetronomeEvents>(event: K, handler: Handler<K>): () => void {
    let set = this._listeners[event] as Set<Handler<K>> | undefined;
    if (!set) {
      set = new Set<Handler<K>>();
      this._listeners[event] = set as never;
    }
    set.add(handler);
    return () => this.off(event, handler);
  }

  off<K extends keyof MetronomeEvents>(event: K, handler: Handler<K>): void {
    const set = this._listeners[event] as Set<Handler<K>> | undefined;
    if (set) set.delete(handler);
  }

  // ─── Read-only state ─────────────────────────────────────────────────────────

  get isRunning(): boolean { return this._isRunning; }
  get bpm(): number { return this._bpm; }
  get timeSignature(): TimeSignature { return this._timeSignature; }
  get accents(): readonly number[] { return this._accents; }
  get accentEnabled(): boolean { return this._accentEnabled; }
  get volume(): number { return this._volume; }
  get muted(): boolean { return this._muted; }
  get subdivision(): SubdivisionId { return this._subdivision; }
  get swing(): number { return this._swing; }

  // ─── Cleanup ─────────────────────────────────────────────────────────────────

  dispose(): void {
    this.stop();
    this._cancelPendingSubTimeouts();
    if (this._voices) {
      for (const voice of this._voices.ownedVoices) {
        voice.dispose();
      }
      this._voices.ownedVoices.clear();
      this._voices = null;
    }
    this._listeners = {};
  }

  // ─── Internal ────────────────────────────────────────────────────────────────

  /**
   * Called by Tone.Transport on each scheduled tick. Computes beat/measure/accent
   * from the cumulative tick index and dispatches all relevant events.
   */
  private _dispatchTick(audioTime: number): void {
    const numerator = this._timeSignature.numerator;
    const tickIndex = this._tickIndex++;
    const beat = tickIndex % numerator;
    const measure = Math.floor(tickIndex / numerator);
    const isAccent = this._accents.includes(beat);
    // shouldSoundAccent gates the *audio* differentiation. The event payload's
    // `isAccent` always reflects the configured accent set (so consumers driving UI
    // markers like the accent ring stay aware of accent positions even when the audio
    // toggle is off).
    const shouldSoundAccent = isAccent && this._accentEnabled;

    // Audio first, so the click is sample-accurate (Tone schedules on its own clock).
    if (!this._muted && this._voices) {
      const voice = shouldSoundAccent ? this._voices.accent : this._voices.regular;
      const role = shouldSoundAccent ? 'accent' : 'regular';
      try {
        triggerClick(voice, audioTime, this._volume, role);
      } catch {
        // A custom voice may have its own latency (e.g. Sampler not yet loaded).
        // Silently swallow click failures — the tick events still fire so UI stays in sync.
      }
    }

    const event: MetronomeTickEvent = {
      beat,
      measure,
      tickIndex,
      isAccent,
      timeSignature: this._timeSignature,
      bpm: this._bpm,
      audioTime,
    };

    // Defer UI dispatch to when the audio is actually audible.
    // Tone fires the scheduler callback up to ~lookAhead seconds AHEAD of
    // audioTime, and the audio itself isn't heard until audioTime + the
    // AudioContext's outputLatency (which on Bluetooth can be 100-200ms).
    // setTimeout aligned to (audioTime + outputLatency − Tone.now()) makes
    // beat dots flash with the audible click instead of with the scheduling
    // callback. Standard Web Audio sync pattern — see audio-context.ts and
    // https://web.dev/articles/audio-output-latency.
    const visualDelayMs = this._visualDelayMs(audioTime);
    const tickHandle = setTimeout(() => {
      this._pendingSubTimeouts.delete(tickHandle);
      if (!this._isRunning) return;
      this._fire('tick', event);
      if (isAccent) this._fire('accent', event);
      if (beat === 0) this._fire('measure', event);
    }, visualDelayMs);
    this._pendingSubTimeouts.add(tickHandle);

    // Schedule sub-ticks for this beat (no-op when subdivision is 'off').
    this._scheduleSubTicks(beat, measure, audioTime);
  }

  /** Milliseconds to wait before firing a UI event so it lines up with the
   *  audible output. Uses `AudioContext.outputLatency` as the compensation —
   *  the single source of truth shared with the playhead's tick read in
   *  `getTransportTicks`. Clamped at 0 (never schedule visuals in the past). */
  private _visualDelayMs(audioTime: number): number {
    const latencyMs = getEffectiveLatencySec() * 1000;
    return Math.max(0, (audioTime - Tone.now()) * 1000 + latencyMs);
  }

  /**
   * Schedule sub-tick audio + visual/event dispatch between this main beat and the
   * next.
   *
   * Layout: a main beat has duration D = (4/denominator) * (60/bpm). N sub-ticks per
   * beat (1 = off, 2 = 8ths, 3 = triplets, 4 = 16ths, 6 = sextuplets). The main beat
   * is sub-tick index 0 and is fired by `_dispatchTick` itself — this method schedules
   * indices 1..N-1.
   *
   * Swing (only when N is even and the subdivision supports swing): sub-ticks pair as
   * [down, up]. The `down` tick of each pair fires at its straight time; the `up`
   * tick shifts to `downStart + 2 * swing * (D/N)`. At swing = 0.5 this collapses to
   * the straight midpoint; at 0.75 the up sits three-quarters of the way through the
   * pair.
   *
   * Why audio + setTimeout (instead of Tone.Transport.schedule): Transport.schedule's
   * `time` argument is in transport-relative time, not AudioContext time — passing
   * AudioContext time leaves the callback parked far in the future and it never fires.
   * The synth itself accepts an absolute AudioContext time on `triggerAttackRelease`,
   * so audio is sample-accurate via Tone's own scheduler. Visual/event dispatch uses
   * setTimeout, which has the same ~5–10ms visual-leads-audio tradeoff as the main
   * tick's synchronous dispatch (see `_dispatchTick`).
   */
  private _scheduleSubTicks(beat: number, measure: number, beatAudioTime: number): void {
    const n = subdivisionCount(this._subdivision);
    if (n <= 1) return;

    const D = tickDurationSeconds(this._timeSignature, this._bpm);
    const stepStraight = D / n;
    const swingActive = subdivisionSupportsSwing(this._subdivision) && this._swing > 0.5;

    for (let i = 1; i < n; i++) {
      let offset: number;
      if (swingActive) {
        // Pair index within the beat: 0, 1, 2, ... where each pair owns sub-ticks
        // (2k, 2k+1). The "up" tick (odd `i`) shifts; the "down" tick (even `i`) stays.
        const pairIndex = Math.floor(i / 2);
        const isUp = i % 2 === 1;
        if (isUp) {
          // up = pairStart + 2 * swing * stepStraight
          offset = pairIndex * 2 * stepStraight + 2 * this._swing * stepStraight;
        } else {
          offset = i * stepStraight; // even-index "down" ticks stay at their straight position
        }
      } else {
        offset = i * stepStraight;
      }

      const subAudioTime = beatAudioTime + offset;
      const subdivisionIndex = i;
      const subdivisionsPerBeat = n;

      // Audio: schedule at the future audio time directly. Tone's synth handles the
      // sample-accurate scheduling.
      if (!this._muted && this._voices) {
        try {
          triggerClick(this._voices.subdivision, subAudioTime, this._volume, 'subdivision');
        } catch {
          // A custom voice may have its own latency (e.g. Sampler not yet loaded).
          // Silently swallow click failures.
        }
      }

      // Visual/event: fire when the audio actually hits the user. Uses the
      // same outputLatency-anchored math as the main tick so sub-dots and
      // main dots stay in lockstep with the audible click.
      const delayMs = this._visualDelayMs(subAudioTime);
      const handle = setTimeout(() => {
        this._pendingSubTimeouts.delete(handle);
        if (!this._isRunning) return;
        this._dispatchSubTickEvent(
          beat,
          measure,
          subAudioTime,
          subdivisionIndex,
          subdivisionsPerBeat,
        );
      }, delayMs);
      this._pendingSubTimeouts.add(handle);
    }
  }

  private _dispatchSubTickEvent(
    beat: number,
    measure: number,
    audioTime: number,
    subdivisionIndex: number,
    subdivisionsPerBeat: number,
  ): void {
    const event: MetronomeSubdivisionEvent = {
      beat,
      measure,
      subdivisionIndex,
      subdivisionsPerBeat,
      timeSignature: this._timeSignature,
      bpm: this._bpm,
      audioTime,
    };
    this._fire('subdivision', event);
  }

  private _cancelPendingSubTimeouts(): void {
    for (const handle of this._pendingSubTimeouts) clearTimeout(handle);
    this._pendingSubTimeouts.clear();
  }

  private _fire<K extends keyof MetronomeEvents>(event: K, ...args: Parameters<Handler<K>>): void {
    const set = this._listeners[event] as Set<Handler<K>> | undefined;
    if (!set) return;
    for (const handler of set) {
      try {
        (handler as (...a: Parameters<Handler<K>>) => void)(...args);
      } catch (err) {
        // Don't let one buggy handler kill the metronome loop.
        // eslint-disable-next-line no-console
        console.error('Metronome handler threw:', err);
      }
    }
  }
}
