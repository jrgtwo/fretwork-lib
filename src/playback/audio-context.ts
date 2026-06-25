/**
 * Thin re-exports of Tone.js facilities needed by consumers of the lib that don't
 * (and shouldn't) depend on Tone directly. Keeps Tone as a single dependency owned
 * by `@fretwork/lib`.
 */
import * as Tone from 'tone';

/** Unlock the AudioContext on first user gesture. Idempotent. */
export async function startAudio(): Promise<void> {
  await Tone.start();
}

/** Current Tone audio time. Useful for scheduling notes a tiny offset in the
 *  future to ensure sample-accurate playback. */
export function audioNow(): number {
  return Tone.now();
}

/** Current Tone.Transport tick position, normalized to the project PPQ AND
 *  shifted backward by `AudioContext.outputLatency` so the value reflects
 *  where audio is currently AUDIBLE — not where it's been scheduled.
 *
 *  The audio you hear at performance time T was scheduled at audio time
 *  T - outputLatency. So any visual that reads transport.ticks at performance
 *  time T should display the position that was *scheduled* at T - outputLatency,
 *  i.e. the raw transport.ticks minus outputLatency-in-ticks. Without this
 *  subtraction the playhead and any rAF-driven highlight lead the audio by
 *  exactly outputLatency seconds (40-200ms on most systems, more on Bluetooth).
 *
 *  This is the standard Web Audio sync pattern. See:
 *  https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/outputLatency
 *  https://web.dev/articles/audio-output-latency
 *
 *  Used by UI animation loops (timeline playhead, auto-scroll, active-event
 *  tracking). Returns 0 before the transport has started or if the subtraction
 *  would go negative (e.g. the first few ticks of playback). */
export function getTransportTicks(projectPpq: number): number {
  const transport = Tone.getTransport();
  const transportPpq = transport.PPQ || projectPpq;
  const raw = (transport.ticks * projectPpq) / transportPpq;
  const latencySec = getEffectiveLatencySec();
  const bpm = transport.bpm.value;
  const latencyTicks = latencySec * projectPpq * bpm / 60;
  return Math.max(0, raw - latencyTicks);
}

/** Best-effort read of `AudioContext.outputLatency` in seconds. Returns 0 if
 *  the context isn't built yet or the property isn't supported (Safari < 18.4).
 *  Single source of truth for visual-vs-audio sync compensation across the
 *  scheduler (playhead, active-event highlights) and the metronome (beat dot
 *  flash). */
export function getOutputLatencySec(): number {
  try {
    const ctx = Tone.getContext().rawContext as AudioContext;
    if (typeof ctx.outputLatency === 'number' && Number.isFinite(ctx.outputLatency)) {
      return ctx.outputLatency;
    }
  } catch {
    // No-op: audio context unavailable.
  }
  return 0;
}

// ─── User audio calibration ──────────────────────────────────────────────────
// On systems where Chrome under-reports `outputLatency` (most commonly
// Bluetooth on Windows — the Bluetooth codec + OS mixer can add 150-300ms
// that Web Audio doesn't see), the user can run a tap-along calibration and
// save an extra latency offset per audio device. The offset is ADDED on top
// of outputLatency so we don't double-count what Chrome already reports.

const CAL_STORAGE_PREFIX = 'fretwork:audio-cal:';

/** Cached label of the most recently detected output device. Set by
 *  `refreshOutputDeviceLabel()`. Used to key calibration lookups so a user
 *  who calibrated Bluetooth doesn't have their offset applied when they
 *  plug in wired headphones. Null when the label can't be read (no media
 *  permission yet, browser doesn't support enumeration, etc.). */
let _currentDeviceLabel: string | null = null;

/** Bluetooth indicators we string-match against `MediaDeviceInfo.label`. Case-
 *  insensitive. List leans broad on purpose; false positives are cheap (the
 *  icon shows when it shouldn't), false negatives mean affected users can't
 *  calibrate at all. */
const BLUETOOTH_LABEL_KEYWORDS = [
  'bluetooth', 'airpods', 'wh-', 'wf-', 'qc', 'jbl', 'beats', 'bose',
  'powerbeats', 'wireless', 'sony wf', 'sony wh', 'galaxy buds', 'pixel buds',
];

/** Read all current audio output devices and return them. Labels are only
 *  populated after media permission has been granted at least once this
 *  session. */
export async function listOutputDevices(): Promise<MediaDeviceInfo[]> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
    return [];
  }
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.filter((d) => d.kind === 'audiooutput');
  } catch {
    return [];
  }
}

/** Best-effort: does the current default output appear to be a Bluetooth
 *  device? Returns false (not "unknown") when labels are unreadable — the
 *  caller treats absence as "no icon shown." */
export async function isOutputBluetooth(): Promise<boolean> {
  const outputs = await listOutputDevices();
  for (const dev of outputs) {
    const label = (dev.label ?? '').toLowerCase();
    if (!label) continue;
    if (BLUETOOTH_LABEL_KEYWORDS.some((kw) => label.includes(kw))) return true;
  }
  return false;
}

/** Re-read the current default audio output label and cache it for
 *  calibration lookups. Call on app init and on `devicechange`. The label
 *  is null until media permission is granted (Chrome strips labels otherwise). */
export async function refreshOutputDeviceLabel(): Promise<string | null> {
  const outputs = await listOutputDevices();
  const def = outputs.find((d) => d.deviceId === 'default') ?? outputs[0];
  _currentDeviceLabel = def?.label?.trim() || null;
  return _currentDeviceLabel;
}

/** One-time prompt for microphone permission, used solely to unlock
 *  `MediaDeviceInfo.label` for audio output devices (Chrome blanks the
 *  labels until any media permission has been granted in the session). The
 *  microphone stream is stopped immediately — we never read from it. */
export async function requestDeviceLabelPermission(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return false;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    return true;
  } catch {
    return false;
  }
}

let _deviceChangeListenerInstalled = false;

/** Install a global `devicechange` listener exactly once. Subsequent calls
 *  are no-ops. When the event fires we refresh the cached output device
 *  label so the next visual-sync read (getCalibrationOffsetMs) picks up the
 *  new device's per-device calibration immediately. Safe to call from
 *  multiple call sites — only the first call actually subscribes. */
export function installDeviceChangeListener(): void {
  if (_deviceChangeListenerInstalled) return;
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.addEventListener) return;
  _deviceChangeListenerInstalled = true;
  navigator.mediaDevices.addEventListener('devicechange', () => {
    void refreshOutputDeviceLabel();
  });
}

/** Current cached output device label, or null if we haven't been able to
 *  read it (no media permission, no devices, browser doesn't support
 *  enumeration). */
export function getCurrentDeviceLabel(): string | null {
  return _currentDeviceLabel;
}

function calKey(label: string | null): string {
  return CAL_STORAGE_PREFIX + (label || 'default');
}

/** Read the saved calibration offset (milliseconds) for a device label, or 0
 *  if none stored. Pass `null` (or omit) to look up the "default" bucket. */
export function getCalibrationOffsetMs(label?: string | null): number {
  if (typeof localStorage === 'undefined') return 0;
  try {
    const raw = localStorage.getItem(calKey(label ?? _currentDeviceLabel));
    if (raw == null) return 0;
    const n = parseFloat(raw);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

/** Save a calibration offset (milliseconds) for a device label. The value is
 *  the EXTRA latency beyond what `outputLatency` reports — when the user
 *  taps along we measure total perceived lag and subtract `outputLatency`
 *  before storing, so the saved value travels correctly between
 *  devices/sessions. */
export function setCalibrationOffsetMs(ms: number, label?: string | null): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(calKey(label ?? _currentDeviceLabel), String(Math.max(0, ms)));
  } catch {
    // No-op (quota / disabled storage).
  }
}

/** Clear the calibration for a device label (or the current default). Used by
 *  a "reset" button in the calibration UI. */
export function clearCalibrationOffset(label?: string | null): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(calKey(label ?? _currentDeviceLabel));
  } catch {
    // No-op.
  }
}

/** Effective sync compensation in seconds = `outputLatency` + saved
 *  per-device calibration offset. This is the single number every visual
 *  sync path should use (getTransportTicks for the playhead, the metronome's
 *  tick dispatch setTimeout). */
export function getEffectiveLatencySec(): number {
  return getOutputLatencySec() + getCalibrationOffsetMs() / 1000;
}

/** Schedule a short triangle-wave blip on the active AudioContext at the
 *  given audio time. Used by the calibration UI to measure perceived audio
 *  latency — must run on the same context as production audio so the
 *  reported `outputLatency` we subtract from the measured tap delta is the
 *  one in effect at playback time. */
export function scheduleCalibrationClick(atAudioTime: number): void {
  let ctx: AudioContext;
  try {
    ctx = Tone.getContext().rawContext as AudioContext;
  } catch {
    return;
  }
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = 1000;
    gain.gain.setValueAtTime(0, atAudioTime);
    gain.gain.linearRampToValueAtTime(0.4, atAudioTime + 0.001);
    gain.gain.exponentialRampToValueAtTime(0.0001, atAudioTime + 0.06);
    osc.connect(gain).connect(ctx.destination);
    osc.start(atAudioTime);
    osc.stop(atAudioTime + 0.08);
  } catch {
    // No-op.
  }
}

/** Schedule a callback at a specific tick on the Tone.Transport timeline.
 *  Useful for composition-level "auto-stop at end" or other tick-aligned
 *  one-shots. Ticks are interpreted in the transport's PPQ; we accept a
 *  projectPpq for symmetry with getTransportTicks. Returns the schedule id
 *  for later cancellation via clearTransportSchedule. */
export function scheduleAtTransportTick(
  callback: () => void,
  ticks: number,
  projectPpq: number,
): number {
  const transport = Tone.getTransport();
  const transportPpq = transport.PPQ || projectPpq;
  const transportTicks = Math.round((ticks * transportPpq) / projectPpq);
  return transport.scheduleOnce(() => callback(), `${transportTicks}i`);
}

/** Cancel a previously-scheduled tick callback. Safe to call with a
 *  null/undefined id. */
export function clearTransportSchedule(id: number | null | undefined): void {
  if (id == null) return;
  Tone.getTransport().clear(id);
}

/** Force Tone.js's AudioContext to use a specific sample rate, ignoring
 *  whatever the OS audio device reports. Must be called BEFORE any other
 *  Tone audio code runs (i.e. as the very first import in the app entry
 *  point). Eliminates the 4x CPU overhead on systems with 192kHz output
 *  devices — every audio operation runs at the chosen rate instead of the
 *  device's native rate; the browser resamples once at output. */
export function forceSampleRate(sampleRate: number): void {
  try {
    // Tone.Context's options shape doesn't expose sampleRate directly; we
    // construct a raw AudioContext at the desired rate and wrap it. The
    // browser handles the final resample to whatever the OS device wants.
    const RawCtx =
      typeof window !== 'undefined'
        ? ((window as unknown as { AudioContext?: typeof AudioContext }).AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
        : undefined;
    if (!RawCtx) return;
    // latencyHint: 'playback' requests the largest, most glitch-resistant
    // output buffer instead of the default 'interactive' (smallest, ~128
    // samples / 2.67ms at 48kHz). The tiny default buffer underruns on mobile
    // (e.g. Pixel 5) — every note crackles even at trivial polyphony, while the
    // render thread keeps up (drift stays ~0). The bigger buffer trades output
    // latency for stability; the visual sync auto-compensates because it reads
    // AudioContext.outputLatency live every tick (see getEffectiveLatencySec).
    const raw = new RawCtx({ sampleRate, latencyHint: 'playback' });
    Tone.setContext(new Tone.Context(raw));
  } catch (e) {
    // If a context already exists we can't change it. Log so we know the
    // workaround failed to apply.
    // eslint-disable-next-line no-console
    console.warn(`[audio-context] could not force ${sampleRate}Hz:`, e);
  }
}
