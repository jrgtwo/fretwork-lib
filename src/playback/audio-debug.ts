/**
 * Audio-thread instrumentation.
 *
 * Tracks live polyphony (active voice count), peak polyphony, note rate, and
 * AudioContext output drift (the canonical signal for buffer underruns).
 *
 * Toggle on at runtime via the browser console:
 *
 *     window.__FRETWORK_AUDIO_DEBUG = true
 *
 * Then play a composition. Every second the module logs a line like:
 *
 *     [audio] voices=24 peak=31 notes/sec=22 drift=0.0ms
 *     [audio] voices=29 peak=31 notes/sec=24 drift=3.2ms ⚠ underrun
 *
 * and, while a composition engine is alive, one line per track (AF-01):
 *
 *     [audio]   Rhythm      in=-14.2  drive=-5.1  out=-9.8  fader=-15.8 dB
 *     [audio]   Lead        in=-11.0  drive=+2.4  out=-8.9  fader=-8.9 dB  ⚠ drive
 *
 * `in`    = the voice's input tap, after `Track.inputGainDb`, before anything
 *           else — the instrument arriving
 * `drive` = what the amp's saturators are being FED, after preGainDb, the
 *           graphic EQ and the pedals. Expect this to be the hottest of the
 *           four on a gain preset, and expect `out` not to follow it: the
 *           curves are normalised at their endpoint, so a saturator hands back
 *           an ordinary level however hard it was hit. That is the whole reason
 *           this tap exists.
 * `out`   = the voice's last node, pre-fader
 * `fader` = the same signal after the track's gain, mute and solo — what
 *           actually reaches the master
 *
 * Every figure is the SAMPLE PEAK over the last second, not an instant and not
 * an average. These were RMS until the peak-meter fix, which is why the levels
 * printed here looked comfortable while the audio clipped audibly — and why
 * `outPeak` on the master line was, for a while, a name for a number that was
 * not a peak. See `voices/peak-meter.ts`.
 *
 * `voices` = active note count (incremented per Voice.play, decremented
 *            after an estimated lifetime expires)
 * `peak`   = highest active count seen since last reset
 * `notes/sec` = note triggers in the last second
 * `drift`  = AudioContext output time lag relative to wall clock. Real
 *            underrun signal — when buffers underrun, the audio thread
 *            falls behind wall time and drift grows. > ~5ms is suspicious.
 *
 * Disable via:
 *     window.__FRETWORK_AUDIO_DEBUG = false
 *
 * Reset peak via:
 *     window.__fretworkAudioDebugResetPeak()
 *
 * Zero overhead when disabled — the noteTriggered hot path bails on the
 * first line.
 */

import * as Tone from 'tone';
import { MasterBus } from './voices/MasterBus';

let activeCount = 0;
let peakCount = 0;
let notesThisSecond = 0;
let peakOutputDbThisSecond = -Infinity;
let peakPreLimiterDbThisSecond = -Infinity;
/** Per-track peaks for the last second, keyed by track id. */
const peakTrackDbThisSecond = new Map<string, TrackLevels>();
let peakMeterInterval: ReturnType<typeof setInterval> | null = null;
let loggerInterval: ReturnType<typeof setInterval> | null = null;

// Drift baseline — captured on first measurement after enable.
let driftBaseline: { contextTime: number; performanceTime: number } | null = null;

/** One track's four taps, in dB. */
export interface TrackLevels {
  readonly trackId: string;
  readonly name: string;
  /** Voice input tap — the instrument arriving. */
  readonly inDb: number;
  /** Amp drive tap — what the saturators are fed. `-Infinity` when the
   *  preset has no amp stage. */
  readonly driveDb: number;
  /** Voice output tap, pre-fader. */
  readonly outDb: number;
  /** Post-fader: the voice output plus the track's gain, mute and solo. */
  readonly faderDb: number;
}

/** Supplies the per-track line. Returns an empty list when no composition
 *  engine is running. */
export type TrackLevelSource = () => readonly TrackLevels[];

let trackLevelSource: TrackLevelSource | null = null;

/**
 * Register (or clear, with `null`) the source of the per-track debug line.
 *
 * `MasterBus` is a singleton this module can simply import; a composition
 * engine is not — it is constructed and disposed as the user opens and closes
 * a composition, and it owns the voices. So it hands itself in rather than
 * being reached for, and hands in `null` on dispose so a torn-down engine's
 * voices are never polled.
 */
export function registerTrackLevelSource(source: TrackLevelSource | null): void {
  trackLevelSource = source;
  if (source === null) peakTrackDbThisSecond.clear();
}

function isEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return (window as unknown as { __FRETWORK_AUDIO_DEBUG?: boolean }).__FRETWORK_AUDIO_DEBUG === true;
}

/** Called from Voice.play() on every note. estimatedLifetimeSec should be
 *  the note's audible duration including release tail — for samplers this
 *  is roughly `durationSec + release` (default release = 1s). */
export function noteTriggered(estimatedLifetimeSec: number): void {
  if (!isEnabled()) return;
  activeCount++;
  notesThisSecond++;
  if (activeCount > peakCount) peakCount = activeCount;
  const lifetimeMs = Math.max(50, Math.round(estimatedLifetimeSec * 1000));
  setTimeout(() => {
    if (activeCount > 0) activeCount--;
  }, lifetimeMs);
}

function measureDriftMs(): number {
  try {
    const ctx = Tone.getContext().rawContext as AudioContext;
    if (typeof ctx.getOutputTimestamp !== 'function') return 0;
    const ts = ctx.getOutputTimestamp();
    if (typeof ts.contextTime !== 'number' || typeof ts.performanceTime !== 'number') return 0;
    if (!driftBaseline) {
      driftBaseline = { contextTime: ts.contextTime, performanceTime: ts.performanceTime };
      return 0;
    }
    const expectedAudioElapsed = (ts.performanceTime - driftBaseline.performanceTime) / 1000;
    const actualAudioElapsed = ts.contextTime - driftBaseline.contextTime;
    return (expectedAudioElapsed - actualAudioElapsed) * 1000;
  } catch {
    return 0;
  }
}

function tickLogger(): void {
  if (!isEnabled()) {
    notesThisSecond = 0;
    peakOutputDbThisSecond = -Infinity;
    peakPreLimiterDbThisSecond = -Infinity;
    peakTrackDbThisSecond.clear();
    return;
  }
  const drift = measureDriftMs();
  const driftWarn = drift > 5 ? ' ⚠ underrun' : '';
  const peakDb = peakOutputDbThisSecond;
  const peakDbStr = peakDb === -Infinity ? '-inf' : peakDb.toFixed(1);
  const preDb = peakPreLimiterDbThisSecond;
  const preDbStr = preDb === -Infinity ? '-inf' : preDb.toFixed(1);
  // `outPeak` is measured AFTER the limiter and the safety clip, so it is pinned
  // near -0.5 by construction and warning on it catches almost nothing. `inPeak`
  // is what the master is being asked to pass, and it is the number that moves
  // when the bus is being overdriven.
  const clipWarn = preDb > 0 ? ' ⚠ OVERDRIVING MASTER' : peakDb > 0 ? ' ⚠ CLIPPING' : '';
  // eslint-disable-next-line no-console
  console.log(
    `[audio] voices=${activeCount} peak=${peakCount} notes/sec=${notesThisSecond} ` +
      `inPeak=${preDbStr}dB outPeak=${peakDbStr}dB drift=${drift.toFixed(1)}ms${driftWarn}${clipWarn}`,
  );
  logTrackLines();
  notesThisSecond = 0;
  peakOutputDbThisSecond = -Infinity;
  peakPreLimiterDbThisSecond = -Infinity;
}

/** Sample the MasterBus output meter at high frequency so the per-second
 *  log can report the TRUE peak (not just the value at the moment we logged).
 *  20Hz is enough to catch transients without significant overhead. */
function startPeakSampling(): void {
  if (peakMeterInterval) return;
  if (typeof window === 'undefined') return;
  peakMeterInterval = setInterval(() => {
    if (!isEnabled()) return;
    const db = MasterBus.getOutputPeakDb();
    if (db > peakOutputDbThisSecond) peakOutputDbThisSecond = db;
    const pre = MasterBus.getPreLimiterPeakDb();
    if (pre > peakPreLimiterDbThisSecond) peakPreLimiterDbThisSecond = pre;
    sampleTrackPeaks();
  }, 50);
}

function sampleTrackPeaks(): void {
  if (!trackLevelSource) return;
  let levels: readonly TrackLevels[];
  try {
    levels = trackLevelSource();
  } catch {
    // A half-disposed engine. A debug line must never be the thing that takes
    // playback down.
    return;
  }
  for (const level of levels) {
    const held = peakTrackDbThisSecond.get(level.trackId);
    peakTrackDbThisSecond.set(
      level.trackId,
      held === undefined
        ? level
        : {
            trackId: level.trackId,
            name: level.name,
            inDb: Math.max(held.inDb, level.inDb),
            driveDb: Math.max(held.driveDb, level.driveDb),
            outDb: Math.max(held.outDb, level.outDb),
            faderDb: Math.max(held.faderDb, level.faderDb),
          },
    );
  }
}

function formatDb(db: number): string {
  if (!Number.isFinite(db)) return '  -inf';
  return (db >= 0 ? '+' : '') + db.toFixed(1);
}

function logTrackLines(): void {
  for (const level of peakTrackDbThisSecond.values()) {
    // The drive tap is the one worth flagging. 0 dBFS at the shaper's input is
    // the WaveShaper's ±1 domain edge — past it the curve stops being a curve
    // and becomes a hard chop, which is what the artifacting report describes.
    const driveWarn = level.driveDb > 0 ? '  ⚠ drive' : '';
    // eslint-disable-next-line no-console
    console.log(
      `[audio]   ${level.name.slice(0, 12).padEnd(12)}` +
        `in=${formatDb(level.inDb).padStart(6)}  ` +
        `drive=${formatDb(level.driveDb).padStart(6)}  ` +
        `out=${formatDb(level.outDb).padStart(6)}  ` +
        `fader=${formatDb(level.faderDb).padStart(6)} dB${driveWarn}`,
    );
  }
  peakTrackDbThisSecond.clear();
}

/** Reset peak polyphony tracking to the current count. Call between test
 *  runs to measure peak for a specific playback. */
export function resetAudioDebugPeak(): void {
  peakCount = activeCount;
}

/** Start the per-second logger. Called at module init; the logger checks
 *  `window.__FRETWORK_AUDIO_DEBUG` each tick so it stays silent when off. */
/** Dump AudioContext latency stats. Call from console:
 *
 *      window.__fretworkAudioStats()
 *
 *  baseLatency = audio buffer size in seconds (typically 0.005-0.02s).
 *               Smaller = lower latency but more vulnerable to glitches.
 *  outputLatency = total output latency including driver/OS buffers.
 *               If this grows during dense passages, the system is straining.
 *  state = 'running' | 'suspended' | 'closed' */
function dumpAudioStats(): void {
  try {
    const ctx = Tone.getContext().rawContext as AudioContext;
    // eslint-disable-next-line no-console
    console.log('[audio stats]', {
      baseLatency: ctx.baseLatency,
      outputLatency: ctx.outputLatency,
      sampleRate: ctx.sampleRate,
      state: ctx.state,
      currentTime: ctx.currentTime,
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[audio stats] failed:', e);
  }
}

function ensureLogger(): void {
  if (loggerInterval) return;
  if (typeof window === 'undefined') return;
  loggerInterval = setInterval(tickLogger, 1000);
  startPeakSampling();
  const win = window as unknown as {
    __fretworkAudioDebugResetPeak?: () => void;
    __fretworkAudioStats?: () => void;
    __fretworkMasterBus?: { setReverbBypassed: (b: boolean) => void };
  };
  win.__fretworkAudioDebugResetPeak = resetAudioDebugPeak;
  win.__fretworkAudioStats = dumpAudioStats;
  win.__fretworkMasterBus = {
    setReverbBypassed: (b: boolean) => MasterBus.setReverbBypassed(b),
  };
}

ensureLogger();
