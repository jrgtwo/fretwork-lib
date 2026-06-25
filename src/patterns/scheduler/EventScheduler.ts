/**
 * EventScheduler — absolute-tick playback scheduler for the Patterns page.
 *
 * Subscribes to Tone.Transport on a 16th-note interval and advances an internal
 * `headTick` per callback. On each slice it queries `eventsInRange(prevHead, newHead)`
 * from the active `EventStream`, schedules each event's audio at its precise audio
 * time, and tracks which events are currently sounding for UI highlighting via
 * `onActiveChange`.
 *
 * Independent of the Practice page's `Playback` class — both can coexist because Tone
 * accepts multiple `scheduleRepeat` callbacks on the same transport. Practice page
 * `Playback` is disabled (via `usePlaybackStore.setEnabled(false)`) while the user
 * is on the Patterns page, so only one of them is producing audio at a time.
 *
 * Designed so `eventsInRange(T, T + lookahead)` queries are cheap — Phase 2 look-ahead
 * UI requires no engine change.
 */
import * as Tone from 'tone';
import type { Metronome } from '../../metronome/Metronome';
import { applySwingToTick } from '../../metronome/types';
import type { GuitarInstrument } from '../../playback/types';
import type { TuningDef } from '../../types';
import { effectiveOpenStrings } from '../../lib/fretboard';
import { audioNow, startAudio } from '../../playback/audio-context';
import { noteAt } from '../../lib/theory';
import { PPQ, secondsPerTick } from '../timebase';
import { MasterBus } from '../../playback/voices/MasterBus';
import { selectIterationEvents, currentIterationOffset, wrapTick } from './loop-region';

export interface ScheduledEvent {
  id: string;
  startTick: number;
  durationTicks: number;
  stringIndex: number;
  fret: number;
  /** Mirrors PatternEvent.hammerOn — the playback engine reduces attack
   *  velocity on these so they sound less like fresh plucks. */
  hammerOn?: boolean;
  /** Mirrors PatternEvent.pullOff — same playback treatment as hammerOn. */
  pullOff?: boolean;
  /** Mirrors PatternEvent.velocity — passed to triggerAttackRelease's 4th
   *  argument when set. Composes multiplicatively with the legato discount
   *  for hammer-on / pull-off destinations. */
  velocity?: number;
  /** Mirrors PatternEvent.vibrato — the scheduler hands it to
   *  `instrument.play()` which modulates a per-voice Vibrato node. */
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
  sourceMeta?: {
    patternId?: string;
    eventId?: string;
    placementId?: string;
  };
}

export interface EventStream {
  /** Total duration in ticks. May be 0 for an empty stream. */
  readonly durationTicks: number;
  /** Events whose startTick is in [fromTick, toTick). Should be cheap for
   *  monotonically-advancing windows; implementations are free to pre-index. */
  eventsInRange(fromTick: number, toTick: number): ScheduledEvent[];
  /** Optional: placement boundaries for composition streams. PatternSource
   *  leaves this undefined (no placements). */
  readonly placementBoundaries?: ReadonlyArray<{
    placementId: string;
    startTick: number;
    endTick: number;
  }>;
}

export interface EventSchedulerOpts {
  metronome: Metronome;
  instrument: GuitarInstrument;
  tuning: TuningDef;
  capo: number;
  /** UI role of this scheduler.
   *   - 'primary' (default): runs the visual playhead rAF loop and calls
   *     MasterBus.cutTails on stop. Owns the user-visible playback head.
   *   - 'follower': schedules audio normally but does NOT run the visual
   *     loop or call cutTails. Use for per-track schedulers in
   *     MultiTrackPlayback where the shared scheduler upstream is the
   *     UI primary. Without this, every per-track scheduler runs its
   *     own rAF and emits a competing tickPos based on ITS stream's
   *     duration — for tracks shorter than the composition, that
   *     produces a playhead that wraps early or jumps unpredictably. */
  role?: 'primary' | 'follower';
  /** Optional constructor-time listeners. Most consumers should use the `onHead`,
   *  `onActive`, `onComplete` subscription methods instead — those support multiple
   *  simultaneous subscribers (e.g. the toolbar, timeline, and fretboard all reading
   *  the same scheduler). The constructor opts are kept for backward compatibility. */
  onActiveChange?(active: readonly ScheduledEvent[]): void;
  onHeadChange?(headTick: number): void;
  onComplete?(): void;
}

export type HeadListener = (headTick: number) => void;
export type ActiveListener = (active: readonly ScheduledEvent[]) => void;
export type CompleteListener = () => void;
export type PlacementChangeListener = (placementId: string | null) => void;


export class EventScheduler {
  private _stream: EventStream | null = null;
  private _loop = true;
  private _headTick = 0;
  /** Absolute tick the next start() should begin scheduling/playback from.
   *  Set via setStartTick before metronome.start; reset to 0 on stop. */
  private _startTick = 0;
  /** Loop region (Wave 2). `null` = loop the whole stream [0, durationTicks)
   *  (the default / Wave 1 behavior). When set + looping, only this tick range
   *  repeats. The caller is responsible for clamping the start cursor into the
   *  region; the scheduler just loops whatever range it's given. */
  private _loopRegion: { start: number; end: number } | null = null;
  private _activeNow = new Map<string, ScheduledEvent>();
  private _scheduledId: number | null = null;
  /** Tone.Transport.scheduleOnce IDs for events pre-scheduled at play start.
   *  Each callback self-removes its own id when it fires. On stop / setStream
   *  / dispose, all remaining ids are transport.clear-cancelled. */
  private _scheduledIds: number[] = [];
  /** rAF handle for the active-events tracking loop (primary scheduler only).
   *  Reads transport.ticks each frame, computes which events should be
   *  highlighted, and emits onActive when the set changes. Replaces the old
   *  per-slice _onTick + _releaseExpired pair. */
  private _activeRafId: number | null = null;
  /** Comparison key for the last emitted active set. Used to dedupe emits. */
  private _activeKey = '';
  private _unsubStart: (() => void) | null = null;
  private _unsubStop: (() => void) | null = null;
  private _tuning: TuningDef;
  private _capo: number;
  private _metronome: Metronome;
  private _instrument: GuitarInstrument;
  private _headListeners = new Set<HeadListener>();
  private _activeListeners = new Set<ActiveListener>();
  private _completeListeners = new Set<CompleteListener>();
  private _placementChangeListeners = new Set<PlacementChangeListener>();
  private _currentPlacementId: string | null = null;
  /** requestAnimationFrame handle for the visual head-position loop. The loop reads
   *  `Tone.Transport.seconds` (the actual audio playback position) and emits head
   *  updates smoothly between scheduler ticks. Audio scheduling stays per-slice in
   *  `_onTick` — this loop only drives the visual playhead. */
  private _visualRafId: number | null = null;
  private _role: 'primary' | 'follower';

  constructor(opts: EventSchedulerOpts) {
    this._metronome = opts.metronome;
    this._instrument = opts.instrument;
    this._tuning = opts.tuning;
    this._capo = opts.capo;
    this._role = opts.role ?? 'primary';
    // Honor constructor-time listeners by adding them to the listener sets.
    if (opts.onHeadChange) this._headListeners.add(opts.onHeadChange);
    if (opts.onActiveChange) this._activeListeners.add(opts.onActiveChange);
    if (opts.onComplete) this._completeListeners.add(opts.onComplete);

    // Reset state when the transport starts. The metronome wraps Tone.Transport.start().
    //
    // Note: we intentionally do NOT start a per-scheduler visual rAF loop here
    // anymore. The store-based headTick flow it fed was removed; consumers
    // (TimelinePlayhead, PatternTimeline, CompositionTimeline auto-scroll,
    // TrackLane placement detection) each run their own self-contained rAF
    // reading Tone.Transport.ticks directly. Starting an orphan loop here
    // would just burn CPU without any subscribers.
    this._unsubStart = this._metronome.on('start', () => {
      this._activeNow.clear();
      this._activeKey = '';
      this._emitActive();
      // Pre-schedule iteration 0, skipping events behind the start cursor so
      // playback can begin mid-stream. When a loop region is active the start
      // is clamped into it; subsequent loop iterations re-schedule themselves
      // (region content) via the boundary callback inside _scheduleAllEvents.
      const region = this._loop
        ? this._resolveRegion()
        : { start: 0, end: this._stream?.durationTicks ?? 0 };
      const start = Math.min(Math.max(this._startTick, region.start), region.end);
      this._headTick = start;
      this._emitHead(start);
      this._scheduleAllEvents(region.start, start - 1, region.start, region.end);
      // Start the active-tracking rAF loop on the primary scheduler only.
      // Followers don't drive UI; their active set has no consumers.
      if (this._role === 'primary') {
        this._startActiveLoop();
      }
    });

    // Clear active state when transport stops.
    this._unsubStop = this._metronome.on('stop', () => {
      this._stopVisualLoop();
      this._stopActiveLoop();
      // Cancel any pre-scheduled events that haven't fired yet. Sample-accurate
      // — eliminates the "previous pattern bleeds into next" symptom.
      const cleanupTransport = Tone.getTransport();
      for (const id of this._scheduledIds) {
        try { cleanupTransport.clear(id); } catch { /* noop */ }
      }
      this._scheduledIds = [];
      // Reset the start cursor so the next plain start() begins at 0 unless a
      // caller explicitly sets it again.
      this._startTick = 0;
      this._activeNow.clear();
      this._activeKey = '';
      this._emitActive();
      this._emitHead(0);
      try {
        this._instrument.releaseAll();
      } catch {
        // No-op: instrument may already be disposed.
      }
      // Briefly mute the master bus to cut decay tails (PluckSynth's natural
      // resonance, layered FMSynth releases). Without this, the previous stream's
      // notes keep ringing into the next start — exactly the "both playing"
      // perception when switching between pattern and composition playback.
      // Only the primary scheduler does this: multiple followers calling
      // cutTails in rapid succession all schedule + cancel each other's
      // ramps on the same shared MasterBus gain node, producing an
      // undefined gain trajectory.
      if (this._role === 'primary') {
        try {
          MasterBus.cutTails();
        } catch {
          // No-op.
        }
      }
      this._currentPlacementId = null;
      for (const l of this._placementChangeListeners) {
        try {
          l(null);
        } catch {
          // No-op.
        }
      }
    });

    // Align Tone.Transport's PPQ with our project PPQ so `transport.ticks`
    // and any tick-time scheduling (`${n}i`) maps 1:1 with our authoring
    // ticks. Without this, transport.ticks-based math is wrong whenever
    // Tone's default PPQ (often 192) differs from ours. Safe to set here:
    // transport is always stopped at scheduler-construction time.
    try {
      const transport = Tone.getTransport();
      if (transport.PPQ !== PPQ) transport.PPQ = PPQ;
    } catch {
      // No-op.
    }
    // NOTE: we no longer register a per-slice scheduleRepeat callback. All
    // events are pre-scheduled at play start via _scheduleAllEvents().
    // Active-events tracking happens via _startActiveLoop()'s rAF.
  }

  // ─── Configuration ─────────────────────────────────────────────────────────

  setStream(stream: EventStream | null): void {
    this._stream = stream;
    this._headTick = 0;
    this._activeNow.clear();
    this._activeKey = '';
    this._emitActive();
    this._currentPlacementId = null;
    // Cancel any pre-scheduled events from the previous stream. Important
    // because the new stream will pre-schedule its own events on the next
    // metronome.start, and we don't want stale audio firing in the meantime.
    const transport = Tone.getTransport();
    for (const id of this._scheduledIds) {
      try { transport.clear(id); } catch { /* noop */ }
    }
    this._scheduledIds = [];
  }

  setLoop(loop: boolean): void {
    this._loop = loop;
  }

  /** Set the loop region (Wave 2 DAW loop brace). Pass `null` to loop the whole
   *  stream. A zero/negative-length or degenerate region also falls back to the
   *  full stream. Takes effect on the next start / loop boundary. */
  setLoopRegion(region: { start: number; end: number } | null): void {
    if (!region || region.end - region.start <= 0) {
      this._loopRegion = null;
      return;
    }
    this._loopRegion = { start: Math.max(0, Math.round(region.start)), end: Math.round(region.end) };
  }

  /** Resolve the active loop window against the current stream. With no region
   *  set (or no stream) this is [0, durationTicks) — identical to Wave 1. */
  private _resolveRegion(): { start: number; end: number } {
    const dur = this._stream?.durationTicks ?? 0;
    const r = this._loopRegion;
    if (!r) return { start: 0, end: dur };
    return { start: Math.min(r.start, dur), end: Math.min(r.end, dur) };
  }

  /** Tick the next start() begins from (the blue cursor). */
  setStartTick(tick: number): void {
    this._startTick = Math.max(0, Math.round(tick));
  }

  get startTick(): number {
    return this._startTick;
  }

  /**
   * Live stream replacement DURING playback. Unlike setStream (which clears the
   * schedule and waits for the next metronome.start to repopulate it), restream
   * reschedules the CURRENT loop iteration from the live playhead forward so
   * audio never drops out. Events at or behind the playhead are skipped this
   * pass — they return on the next loop iteration via the boundary callback,
   * which reads the new stream. If the transport isn't running, falls back to
   * setStream's deferred behavior.
   */
  restream(stream: EventStream | null): void {
    const transport = Tone.getTransport();
    for (const id of this._scheduledIds) {
      try { transport.clear(id); } catch { /* noop */ }
    }
    this._scheduledIds = [];
    this._stream = stream;
    this._activeNow.clear();
    this._activeKey = '';
    this._emitActive();
    if (!stream || stream.durationTicks <= 0) return;
    if (transport.state !== 'started') {
      this._headTick = 0;
      return;
    }
    const now = transport.ticks;
    const region = this._loop
      ? this._resolveRegion()
      : { start: 0, end: stream.durationTicks };
    const offset = currentIterationOffset(now, region.start, region.end);
    this._scheduleAllEvents(offset, now, region.start, region.end);
  }

  setTuning(tuning: TuningDef, capo: number): void {
    this._tuning = tuning;
    this._capo = capo;
  }

  setInstrument(instrument: GuitarInstrument): void {
    if (this._instrument === instrument) return;
    try {
      this._instrument.dispose();
    } catch {
      // Some instruments may already be disposed.
    }
    this._instrument = instrument;
  }

  /** Trigger a single audible note for a fretboard cell using the scheduler's current
   *  instrument, tuning, and capo. Used by the editor for click-to-audition: the user
   *  taps a fret on the fretboard and hears that note immediately, without involving
   *  the metronome transport. Safe to call concurrently with active playback (the note
   *  will overlap whatever the scheduler is already playing). */
  previewCell(stringIndex: number, fret: number, duration: string | number = '2n'): void {
    const openStrings = effectiveOpenStrings(this._tuning, this._capo);
    const openString = openStrings[stringIndex];
    if (!openString) return;
    const note = noteAt(openString, fret);
    // Audio context may be locked on the very first interaction. Kick off startAudio
    // and play once it resolves; ignore failures (instruments may also fail if scheduled
    // too close to a prior trigger).
    startAudio()
      .then(() => {
        try {
          this._instrument.play(note, duration, audioNow());
        } catch {
          // Swallow — preview is best-effort.
        }
      })
      .catch(() => {
        // startAudio rejection is non-fatal for preview.
      });
  }

  // ─── Subscription API ──────────────────────────────────────────────────────

  /** Subscribe to head-tick updates. Multiple subscribers are supported. */
  onHead(listener: HeadListener): () => void {
    this._headListeners.add(listener);
    return () => this._headListeners.delete(listener);
  }

  /** Subscribe to active-events changes. Multiple subscribers are supported. */
  onActive(listener: ActiveListener): () => void {
    this._activeListeners.add(listener);
    return () => this._activeListeners.delete(listener);
  }

  /** Subscribe to non-loop completion. Multiple subscribers are supported. */
  onComplete(listener: CompleteListener): () => void {
    this._completeListeners.add(listener);
    return () => this._completeListeners.delete(listener);
  }

  /** Subscribe to placement-boundary crossings during composition playback.
   *  Fires with the new placement's id whenever the head enters a new
   *  placement, and with `null` when the head is between placements (gaps) or
   *  when the active stream has no placements. */
  onPlacementChange(listener: PlacementChangeListener): () => void {
    this._placementChangeListeners.add(listener);
    return () => this._placementChangeListeners.delete(listener);
  }

  // ─── Read-only state ───────────────────────────────────────────────────────

  get headTick(): number {
    return this._headTick;
  }

  get isLooping(): boolean {
    return this._loop;
  }

  // ─── Cleanup ───────────────────────────────────────────────────────────────

  dispose(): void {
    this._stopVisualLoop();
    this._stopActiveLoop();
    const disposeTransport = Tone.getTransport();
    for (const id of this._scheduledIds) {
      try { disposeTransport.clear(id); } catch { /* noop */ }
    }
    this._scheduledIds = [];
    if (this._scheduledId !== null) {
      try {
        disposeTransport.clear(this._scheduledId);
      } catch {
        // No-op: transport may have been disposed externally.
      }
      this._scheduledId = null;
    }
    this._unsubStart?.();
    this._unsubStart = null;
    this._unsubStop?.();
    this._unsubStop = null;
    try {
      this._instrument.dispose();
    } catch {
      // No-op.
    }
    this._activeNow.clear();
    this._headListeners.clear();
    this._activeListeners.clear();
    this._completeListeners.clear();
    this._placementChangeListeners.clear();
  }

  // ─── Test seam ─────────────────────────────────────────────────────────────

  /** Drive one slice synchronously. Legacy test seam from the slice-based
   *  architecture. Now a no-op — audio scheduling happens via
   *  _scheduleAllEvents at play start, not per-slice. Kept so existing tests
   *  still compile; rewrite those tests to assert on _scheduledIds + the
   *  scheduled callbacks instead. */
  _tickForTest(_audioTime: number): void {
    // no-op
  }

  // ─── Internal ──────────────────────────────────────────────────────────────

  /** Pre-schedule every event in the active stream at its absolute transport
   *  tick. Called from the metronome 'start' handler at play start, and from
   *  the loop-boundary callback at each loop iteration.
   *
   *  `loopOffset` is the absolute transport tick at which the iteration
   *  begins. Iteration 0 has offset 0 (relative ticks == absolute ticks).
   *  Iteration N has offset N * durationTicks. Using ABSOLUTE ticks (not
   *  loop-relative) is the critical fix from the Phase 1B attempt — Tone's
   *  transport.ticks is monotonically increasing and never wraps, so
   *  scheduleOnce('${X}i') only fires correctly if X is in the future
   *  relative to the current transport position.
   *
   *  Each scheduled callback fires `instrument.play(note, dur, audioTime)`
   *  exactly once at its event time. Tone handles the audio scheduling via
   *  AudioContext.currentTime — no per-slice JS work needed during playback. */
  /** Swung absolute transport ticks for one iteration's events, in stream
   *  order (matches `eventsInRange(0, durationTicks)`). Pure read of the
   *  current stream + metronome groove; no transport interaction. */
  private _computeAbsoluteTicks(
    loopOffset: number,
    regionStart = 0,
    regionEnd?: number,
  ): number[] {
    const stream = this._stream;
    if (!stream || stream.durationTicks <= 0) return [];
    const rEnd = regionEnd ?? stream.durationTicks;
    const subdivision = this._metronome.subdivision;
    const swing = this._metronome.swing;
    const out: number[] = [];
    for (const e of stream.eventsInRange(regionStart, rEnd)) {
      const swung = Math.max(0, Math.round(applySwingToTick(e.startTick, subdivision, swing, PPQ)));
      if (swung < regionStart || swung >= rEnd) continue;
      out.push(loopOffset + (swung - regionStart));
    }
    return out;
  }

  /** Test-only seam: the absolute ticks `_scheduleAllEvents` would schedule for
   *  this iteration after applying the `fromTick` floor. No transport interaction. */
  _scheduleForTest(
    loopOffset: number,
    fromTick = -Infinity,
    regionStart = 0,
    regionEnd?: number,
  ): number[] {
    const abs = this._computeAbsoluteTicks(loopOffset, regionStart, regionEnd);
    return selectIterationEvents(abs, fromTick).map((i) => abs[i]);
  }

  private _scheduleAllEvents(
    loopOffset: number,
    fromTick: number = -Infinity,
    regionStart: number = 0,
    regionEnd?: number,
  ): void {
    const stream = this._stream;
    if (!stream || stream.durationTicks <= 0) return;
    const rEnd = regionEnd ?? stream.durationTicks;
    const regionLen = rEnd - regionStart;

    const transport = Tone.getTransport();
    const sec = secondsPerTick(this._metronome.bpm);
    const subdivision = this._metronome.subdivision;
    const swing = this._metronome.swing;
    const openStrings = effectiveOpenStrings(this._tuning, this._capo);

    const events = stream.eventsInRange(regionStart, rEnd);
    for (const e of events) {
      const openString = openStrings[e.stringIndex];
      if (!openString) continue;

      const harmonicSemitones = e.harmonic ? 12 : 0;
      const note = noteAt(openString, e.fret + harmonicSemitones);
      const swungStart = applySwingToTick(e.startTick, subdivision, swing, PPQ);
      const swungEnd = applySwingToTick(e.startTick + e.durationTicks, subdivision, swing, PPQ);
      const rawDurationSec = Math.max(0, swungEnd - swungStart) * sec;
      const durationSec = e.dead
        ? Math.max(0.04, rawDurationSec * 0.12)
        : e.palmMute
          ? Math.max(0.05, rawDurationSec * 0.3)
          : rawDurationSec;

      const isLegato = e.hammerOn || e.pullOff || e.tap;
      let velocityMultiplier = 1.0;
      if (isLegato) velocityMultiplier *= 0.4;
      if (e.ghost) velocityMultiplier *= 0.5;
      if (e.dead) velocityMultiplier *= 0.3;
      const baseVelocity = e.velocity ?? 1.0;
      const finalVelocity = baseVelocity * velocityMultiplier;
      const velocity = finalVelocity < 1.0 ? finalVelocity : undefined;

      const pitchCurve = resolvePitchCurve(e);
      const playOpts = {
        velocity,
        vibrato: e.vibrato,
        durationSec,
        pitchCurve,
        palmMute: e.palmMute,
      };

      // Absolute transport tick at which this event should fire. Tone's
      // tick-time syntax ('${N}i') uses transport.PPQ which we aligned to
      // our PPQ in the constructor.
      const swung = Math.max(0, Math.round(swungStart));
      // Skip events outside the loop region (swing can nudge one past an edge).
      if (swung < regionStart || swung >= rEnd) continue;
      // Region-relative placement: event at region position (swung - regionStart)
      // fires at loopOffset + that offset. With the default full region
      // (regionStart=0) this is just loopOffset + swung — i.e. Wave 1 behavior.
      const absoluteTick = loopOffset + (swung - regionStart);
      // Live-reschedule guard: events at or behind the playhead were already
      // played this pass — skip them (they return on the next loop iteration).
      if (absoluteTick <= fromTick) continue;
      try {
        const id = transport.scheduleOnce((audioTime) => {
          // Self-remove our id from the tracking array so stop()'s cleanup
          // doesn't waste time clearing already-fired schedules.
          const idx = this._scheduledIds.indexOf(id);
          if (idx >= 0) this._scheduledIds.splice(idx, 1);
          try {
            this._instrument.play(note, durationSec, audioTime, playOpts);
          } catch {
            // One bad note shouldn't kill anything else.
          }
        }, `${absoluteTick}i`);
        this._scheduledIds.push(id);
      } catch {
        // One bad schedule shouldn't break the rest.
      }
    }

    // Loop boundary: when transport reaches the end of this iteration,
    // schedule the next iteration's events. Tone fires this callback with
    // its standard lookahead so the next iteration's events have time to be
    // registered before they need to play.
    if (this._loop) {
      const boundary = loopOffset + regionLen;
      // Fire the reschedule callback slightly BEFORE the boundary. The next
      // iteration's first events land exactly on `boundary`; scheduling them
      // from a callback that fires AT `boundary` is too late (Tone only fires
      // events strictly in the future, so the loop's first note(s) get dropped
      // every repeat). A small lead gives those events runway to register.
      const lead = Math.min(PPQ, Math.max(1, Math.floor(regionLen / 2)));
      const rescheduleAt = boundary - lead;
      try {
        const id = transport.scheduleOnce(() => {
          const idx = this._scheduledIds.indexOf(id);
          if (idx >= 0) this._scheduledIds.splice(idx, 1);
          // Re-resolve the region so a live brace edit takes effect on the next
          // loop (the boundary chain must NOT reuse captured region params).
          // Phase-align the new iteration to `boundary` so audio + the head wrap
          // agree. For an unchanged region this reduces to the prior behavior.
          const r = this._resolveRegion();
          const offset = currentIterationOffset(boundary, r.start, r.end);
          this._scheduleAllEvents(offset, boundary - 1, r.start, r.end);
        }, `${rescheduleAt}i`);
        this._scheduledIds.push(id);
      } catch {
        // No-op.
      }
    } else {
      // Non-looping: notify completion at the end of the iteration.
      const end = loopOffset + regionLen;
      try {
        const id = transport.scheduleOnce(() => {
          const idx = this._scheduledIds.indexOf(id);
          if (idx >= 0) this._scheduledIds.splice(idx, 1);
          this._emitComplete();
        }, `${end}i`);
        this._scheduledIds.push(id);
      } catch {
        // No-op.
      }
    }
  }

  /** Per-frame active-events tracking. Runs on the primary scheduler only
   *  (followers in MultiTrackPlayback have no UI subscribers). Reads
   *  transport.ticks each frame and computes the set of events that are
   *  currently within their (startTick, startTick+duration) window. Emits
   *  onActive whenever the set actually changes (deduped via _activeKey).
   *  Also drives onPlacementChange notifications.
   *
   *  Cost is O(events) per frame — for typical stream sizes (<500 events)
   *  this is sub-millisecond. */
  private _startActiveLoop(): void {
    if (this._activeRafId !== null) return;
    if (typeof requestAnimationFrame === 'undefined') return;
    const loop = () => {
      if (!this._metronome.isRunning) {
        this._activeRafId = null;
        return;
      }
      const stream = this._stream;
      if (!stream || stream.durationTicks <= 0) {
        this._activeRafId = requestAnimationFrame(loop);
        return;
      }
      const transport = Tone.getTransport();
      const transportPpq = transport.PPQ || PPQ;
      let tickPos = (transport.ticks * PPQ) / transportPpq;
      if (this._loop) {
        const region = this._resolveRegion();
        tickPos = wrapTick(tickPos, region.start, region.end);
      }

      // Compute active set + a comparison key in one pass.
      let newKey = '';
      const newActive = new Map<string, ScheduledEvent>();
      const events = stream.eventsInRange(0, stream.durationTicks);
      for (const e of events) {
        const end = e.startTick + e.durationTicks;
        if (e.startTick <= tickPos && tickPos < end) {
          newActive.set(e.id, e);
          newKey += e.id + ',';
        }
      }

      if (newKey !== this._activeKey) {
        this._activeKey = newKey;
        this._activeNow = newActive;
        this._emitActive();
      }

      // Placement-change tracking (cheap; _emitPlacementChange dedupes).
      this._emitPlacementChange(this._placementAtTick(tickPos));

      this._activeRafId = requestAnimationFrame(loop);
    };
    this._activeRafId = requestAnimationFrame(loop);
  }

  private _stopActiveLoop(): void {
    if (this._activeRafId !== null) {
      cancelAnimationFrame(this._activeRafId);
      this._activeRafId = null;
    }
  }

  private _stopVisualLoop(): void {
    if (this._visualRafId !== null) {
      cancelAnimationFrame(this._visualRafId);
      this._visualRafId = null;
    }
  }

  private _emitPlacementChange(id: string | null): void {
    if (id === this._currentPlacementId) return;
    this._currentPlacementId = id;
    for (const l of this._placementChangeListeners) {
      try {
        l(id);
      } catch {
        // No-op.
      }
    }
  }

  private _placementAtTick(tick: number): string | null {
    const stream = this._stream;
    if (!stream?.placementBoundaries) return null;
    for (const b of stream.placementBoundaries) {
      if (tick >= b.startTick && tick < b.endTick) return b.placementId;
    }
    return null;
  }

  private _emitHead(t: number): void {
    if (this._headListeners.size === 0) return;
    for (const l of this._headListeners) {
      try {
        l(t);
      } catch {
        // No-op: don't let a buggy listener kill the loop.
      }
    }
  }

  private _emitActive(): void {
    // Skip allocation entirely when nobody's listening. Per-track schedulers
    // in MultiTrackPlayback have no active subscribers (only the shared
    // scheduler does), and they fire _emitActive on every slice — every
    // skipped allocation is reduced GC pressure on the audio main thread.
    if (this._activeListeners.size === 0) return;
    const snapshot = Array.from(this._activeNow.values());
    for (const l of this._activeListeners) {
      try {
        l(snapshot);
      } catch {
        // No-op.
      }
    }
  }

  private _emitComplete(): void {
    for (const l of this._completeListeners) {
      try {
        l();
      } catch {
        // No-op.
      }
    }
  }
}

/**
 * Translate `ScheduledEvent.slide` or `.bend` into a unified pitch curve
 * (array of `{at, semitones}` points the instrument steps a PitchShift
 * node through). Bend takes priority when both are present — composing
 * the two on a single PitchShift node would distort the bend's intent.
 *
 * Slide shapes (3-point):
 *   - 'legato' / 'shift'        — [{0,0}, {1, toFret-fret}]
 *   - 'slide-in-below' / 'above' — [{0, ∓2}, {0.15, 0}, {1, 0}]
 *   - 'slide-out-down' / 'up'    — [{0, 0}, {0.85, 0}, {1, ∓3}]
 *
 * Bend shapes use IR-provided points when available, else synthesize from
 * type + semitones:
 *   - 'bend'         — [{0, 0}, {1, semitones}]
 *   - 'release'      — [{0, semitones}, {1, 0}]
 *   - 'pre-bend'     — [{0, semitones}, {1, semitones}]
 *   - 'bend-release' — [{0, 0}, {0.5, semitones}, {1, 0}]
 */
function resolvePitchCurve(
  e: ScheduledEvent,
): Array<{ at: number; semitones: number }> | undefined {
  if (e.bend) return curveFromBend(e.bend);
  if (e.slide) return curveFromSlide(e.slide, e.fret);
  return undefined;
}

function curveFromBend(
  bend: NonNullable<ScheduledEvent['bend']>,
): Array<{ at: number; semitones: number }> {
  if (bend.points && bend.points.length >= 2) return bend.points.slice();
  switch (bend.type) {
    case 'bend':
      return [{ at: 0, semitones: 0 }, { at: 1, semitones: bend.semitones }];
    case 'release':
      return [{ at: 0, semitones: bend.semitones }, { at: 1, semitones: 0 }];
    case 'pre-bend':
      return [{ at: 0, semitones: bend.semitones }, { at: 1, semitones: bend.semitones }];
    case 'bend-release':
      return [
        { at: 0, semitones: 0 },
        { at: 0.5, semitones: bend.semitones },
        { at: 1, semitones: 0 },
      ];
    default:
      return [{ at: 0, semitones: 0 }, { at: 1, semitones: 0 }];
  }
}

function curveFromSlide(
  slide: NonNullable<ScheduledEvent['slide']>,
  fret: number,
): Array<{ at: number; semitones: number }> | undefined {
  switch (slide.type) {
    case 'legato':
    case 'shift':
      if (slide.toFret == null) return undefined;
      return [{ at: 0, semitones: 0 }, { at: 1, semitones: slide.toFret - fret }];
    case 'slide-in-below':
      return [{ at: 0, semitones: -2 }, { at: 0.15, semitones: 0 }, { at: 1, semitones: 0 }];
    case 'slide-in-above':
      return [{ at: 0, semitones: 2 }, { at: 0.15, semitones: 0 }, { at: 1, semitones: 0 }];
    case 'slide-out-down':
      return [{ at: 0, semitones: 0 }, { at: 0.85, semitones: 0 }, { at: 1, semitones: -3 }];
    case 'slide-out-up':
      return [{ at: 0, semitones: 0 }, { at: 0.85, semitones: 0 }, { at: 1, semitones: 3 }];
    default:
      return undefined;
  }
}
