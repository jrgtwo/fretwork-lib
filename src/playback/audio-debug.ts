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
let peakMeterInterval: ReturnType<typeof setInterval> | null = null;
let loggerInterval: ReturnType<typeof setInterval> | null = null;

// Drift baseline — captured on first measurement after enable.
let driftBaseline: { contextTime: number; performanceTime: number } | null = null;

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
    return;
  }
  const drift = measureDriftMs();
  const driftWarn = drift > 5 ? ' ⚠ underrun' : '';
  const peakDb = peakOutputDbThisSecond;
  const peakDbStr = peakDb === -Infinity ? '-inf' : peakDb.toFixed(1);
  const clipWarn = peakDb > 0 ? ' ⚠ CLIPPING' : '';
  // eslint-disable-next-line no-console
  console.log(
    `[audio] voices=${activeCount} peak=${peakCount} notes/sec=${notesThisSecond} ` +
      `outPeak=${peakDbStr}dB drift=${drift.toFixed(1)}ms${driftWarn}${clipWarn}`,
  );
  notesThisSecond = 0;
  peakOutputDbThisSecond = -Infinity;
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
  }, 50);
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
