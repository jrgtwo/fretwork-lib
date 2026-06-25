/**
 * MasterBus — singleton audio sink for every Voice.
 *
 * Topology:
 *
 *     voice.output ─► input (Gain) ─► destination          (dry)
 *                                  ╰► reverb ─► destination (wet, controlled by reverb.wet)
 *
 * The gain node is the public connection point — voices call `connectVoice(node)`
 * which wires the node into the bus. Disposing a voice disconnects it.
 *
 * Reverb is a `Tone.Reverb` (impulse-response convolver). The wet/dry mix is
 * controlled by the reverb's own `wet` parameter; toggling `enabled` to false
 * routes the wet leg to silence by setting wet to 0 (cheaper than disconnecting).
 * Decay changes require regenerating the impulse response, which is async — we
 * schedule it but don't await on the caller's behalf.
 *
 * All Tone construction happens lazily on first `ensure()` call so importing this
 * module doesn't require an unlocked AudioContext (matters for SSR / jsdom tests).
 */
import * as Tone from 'tone';
import { DEFAULT_REVERB_SETTINGS, type ReverbSettings } from './types';

/** Master gain range. -80 dB = effectively silent (signal grounded for all
 *  practical purposes). +24 dB = aggressive boost; the limiter underneath
 *  catches peaks so cranking this high doesn't hard-clip. Constants are
 *  exported so UI controls can match the audio engine's actual bounds. */
export const MASTER_GAIN_MIN_DB = -80;
export const MASTER_GAIN_MAX_DB = 24;
/** Master bus compressor — sits before the limiter to even out dynamics so
 *  master gain can push more loudness without the limiter clamping
 *  aggressively. Standard "mastering bus glue" settings: gentle ratio, slow
 *  attack to preserve transients, medium release for smoothness. Hidden
 *  from the UI — set-and-forget. */
const BUS_COMP_THRESHOLD_DB = -32;
const BUS_COMP_RATIO = 6;
const BUS_COMP_ATTACK_S = 0.005;
const BUS_COMP_RELEASE_S = 0.080;
const BUS_COMP_KNEE_DB = 10;
/** Limiter ceiling (dBFS) on the fast-attack compressor stage. -1 dB leaves
 *  headroom for intersample peaks so output stays clean through Bluetooth
 *  codecs and cheap DAC reconstruction filters. Hidden from the UI —
 *  set-and-forget. */
const LIMITER_THRESHOLD_DB = -1;
/** Hard-clip safety ceiling (linear amplitude). Catches anything that
 *  escapes the limiter — e.g. transients ≥20 dB above threshold that the
 *  finite-ratio compressor can't fully tame. dbToGain(-0.5) ≈ 0.944, so
 *  the absolute output ceiling is -0.5 dBFS. This stage SHOULD never
 *  audibly engage; it's a last-resort guarantee that nothing reaches the
 *  DAC at or above 0 dBFS. */
const SAFETY_CLIP_CEILING = Math.pow(10, -0.5 / 20);
/** localStorage key for the user's master gain setting. Single global value;
 *  survives page reloads. */
const MASTER_GAIN_STORAGE_KEY = 'fretwork:master-gain-db';

function clampMasterGainDb(db: number): number {
  if (!Number.isFinite(db)) return 0;
  return Math.max(MASTER_GAIN_MIN_DB, Math.min(MASTER_GAIN_MAX_DB, db));
}

function loadStoredMasterGainDb(): number {
  if (typeof window === 'undefined') return 0;
  try {
    const raw = window.localStorage.getItem(MASTER_GAIN_STORAGE_KEY);
    if (raw == null) return 0;
    const parsed = Number(raw);
    return clampMasterGainDb(parsed);
  } catch {
    return 0;
  }
}

function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

class MasterBusImpl {
  private _input: Tone.Gain | null = null;
  private _reverb: Tone.Reverb | null = null;
  private _busCompressor: Tone.Compressor | null = null;
  private _masterGain: Tone.Gain | null = null;
  private _limiter: Tone.Compressor | null = null;
  private _safetyClip: Tone.WaveShaper | null = null;
  private _meter: Tone.Meter | null = null;
  private _settings: ReverbSettings = DEFAULT_REVERB_SETTINGS;
  /** Persisted master gain (dB). Read from localStorage on first build and
   *  written back on every setter call. Default 0 dB (unity). */
  private _masterGainDb: number = loadStoredMasterGainDb();
  /** Cached resolved promise so callers can await reverb readiness if they care. */
  private _generatePromise: Promise<void> | null = null;

  /** Build the bus on first audio use. Safe to call repeatedly. */
  private _ensure(): { input: Tone.Gain; reverb: Tone.Reverb } {
    if (this._input && this._reverb) {
      return { input: this._input, reverb: this._reverb };
    }
    const input = new Tone.Gain(1);
    const reverb = new Tone.Reverb({
      decay: this._settings.decay,
      preDelay: this._settings.preDelay,
      wet: this._settings.enabled ? this._settings.wet : 0,
    });
    // Reverb impulse generation is async; kick it off but don't block. The dry
    // path remains audible while the IR loads.
    this._generatePromise = reverb.generate().then(() => undefined);

    // Bus compressor — "mastering glue" stage. Gentle ratio + slow-ish
    // attack preserves transients while pulling the sustain up. This lets
    // master gain drive a denser signal so we get loudness without slamming
    // the limiter.
    const busCompressor = new Tone.Compressor({
      threshold: BUS_COMP_THRESHOLD_DB,
      ratio: BUS_COMP_RATIO,
      attack: BUS_COMP_ATTACK_S,
      release: BUS_COMP_RELEASE_S,
      knee: BUS_COMP_KNEE_DB,
    });

    // Master gain feeds the limiter. The user adjusts gain via the UI; the
    // limiter underneath catches peaks so cranking it doesn't hard-clip the
    // output.
    const masterGain = new Tone.Gain(dbToGain(this._masterGainDb));

    // Brick-wall-ish limiter. We use Tone.Compressor directly (not
    // Tone.Limiter) because the latter ships with a 3 ms attack that lets
    // transients escape — for true peak protection we need sample-accurate
    // detection. Attack 0.1 ms + ratio 20 + zero knee gets us as close to
    // brick-wall as the Web Audio DynamicsCompressor allows.
    const limiter = new Tone.Compressor({
      threshold: LIMITER_THRESHOLD_DB,
      ratio: 20,
      attack: 0.0001,
      release: 0.05,
      knee: 0,
    });

    // Hard-clip safety net. The compressor's finite ratio (20:1) can't fully
    // catch transients ≥20 dB above threshold. A WaveShaper hard-clip at
    // SAFETY_CLIP_CEILING absolutely guarantees no signal reaches the DAC
    // ≥0 dBFS. SHOULD never audibly engage in normal use; only fires when
    // upstream stages produce extreme peaks the limiter can't catch.
    const safetyClip = new Tone.WaveShaper(
      (x) => Math.max(-SAFETY_CLIP_CEILING, Math.min(SAFETY_CLIP_CEILING, x)),
      2048,
    );

    // Signal flow:
    //   input → reverb → busCompressor → masterGain → limiter → safetyClip → dest
    // Reverb tails feed the compressor (smoother decay), the compressor
    // glues dynamics, masterGain pushes the denser signal toward streaming
    // loudness, the limiter catches transient peaks, and the safety clip
    // is the last-resort backstop.
    input.connect(reverb);
    reverb.connect(busCompressor);
    busCompressor.connect(masterGain);
    masterGain.connect(limiter);
    limiter.connect(safetyClip);
    safetyClip.toDestination();

    // Diagnostic meter on the FINAL output — taps the safety clip so the
    // reading reflects what's actually leaving the bus (post-everything).
    // Used by audio-debug.ts and the lab clip indicator.
    const meter = new Tone.Meter({ smoothing: 0 });
    safetyClip.connect(meter);

    this._input = input;
    this._reverb = reverb;
    this._busCompressor = busCompressor;
    this._masterGain = masterGain;
    this._limiter = limiter;
    this._safetyClip = safetyClip;
    this._meter = meter;
    return { input, reverb };
  }

  /** Current master gain in dB. Range [MASTER_GAIN_MIN_DB, MASTER_GAIN_MAX_DB]. */
  getMasterGainDb(): number {
    return this._masterGainDb;
  }

  /** Set master gain in dB. Clamps to [MIN, MAX]. Ramps smoothly to avoid
   *  pops; writes to localStorage so the value survives page reloads. Safe
   *  to call before the bus is built — the value will be applied when
   *  audio nodes initialise on first connectVoice(). */
  setMasterGainDb(db: number): void {
    const next = clampMasterGainDb(db);
    this._masterGainDb = next;
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(MASTER_GAIN_STORAGE_KEY, String(next));
      } catch {
        // localStorage quota / disabled — silently degrade. Audio still
        // updates this session; the setting just won't persist.
      }
    }
    if (this._masterGain) {
      this._masterGain.gain.rampTo(dbToGain(next), 0.02);
    }
  }

  /** Current peak output level in dBFS. > 0 = clipping. Returns -Infinity
   *  when the bus hasn't been built yet. Used by audio-debug.ts. */
  getOutputPeakDb(): number {
    if (!this._meter) return -Infinity;
    const v = this._meter.getValue();
    return typeof v === 'number' ? v : Array.isArray(v) ? Math.max(...v) : -Infinity;
  }

  /** Diagnostic: bypass the reverb at runtime. Useful for A/B testing whether
   *  the reverb convolver is the source of audio artifacts. Implemented by
   *  setting reverb.wet to 0 (dry-only). Call via the browser console:
   *
   *      window.__fretworkMasterBus.setReverbBypassed(true)
   *
   *  Restore with `false`. Doesn't disconnect/reconnect nodes so the audio
   *  graph stays stable; just routes the wet leg to silence. */
  setReverbBypassed(bypassed: boolean): void {
    if (!this._reverb) return;
    try {
      this._reverb.wet.rampTo(bypassed ? 0 : (this._settings.enabled ? this._settings.wet : 0), 0.05);
    } catch {
      // No-op.
    }
  }

  /** Proactively build the master bus. Useful as a "first user gesture" warm-up
   *  so the reverb's IR has time to render before the user clicks an audition
   *  button. Returns a promise that resolves once the IR is ready. */
  async warmup(): Promise<void> {
    this._ensure();
    await this._generatePromise;
  }

  /** Connect a voice's output node into the master bus. */
  connectVoice(node: Tone.ToneAudioNode): void {
    const { input } = this._ensure();
    node.connect(input);
  }

  /** Disconnect a voice's output node from the master bus. Safe to call even if
   *  the node was never connected. */
  disconnectVoice(node: Tone.ToneAudioNode): void {
    if (!this._input) return;
    try {
      node.disconnect(this._input);
    } catch {
      // Already disconnected — fine.
    }
  }

  /** Update reverb settings. Decay change rebuilds the IR (async); enabled / wet
   *  are immediate parameter ramps.
   *
   *  This method is safe to call BEFORE any user gesture — if the bus hasn't been
   *  built yet (i.e. no Voice has connected), the new settings are simply stored
   *  and applied when the bus initialises on first `connectVoice()`. We don't
   *  call `_ensure()` here because that would construct Tone nodes against a
   *  suspended AudioContext and produce browser warnings. */
  setReverbSettings(next: ReverbSettings): void {
    const prev = this._settings;
    this._settings = next;

    // No live nodes yet → nothing to push. Settings will take effect on build.
    if (!this._reverb) return;

    if (prev.decay !== next.decay || prev.preDelay !== next.preDelay) {
      this._reverb.decay = next.decay;
      this._reverb.preDelay = next.preDelay;
      this._generatePromise = this._reverb.generate().then(() => undefined);
    }

    const targetWet = next.enabled ? next.wet : 0;
    this._reverb.wet.rampTo(targetWet, 0.05);
  }

  /** Briefly silence the bus to cut decay tails (e.g. PluckSynth resonance) when
   *  switching streams or stopping playback. Ramps gain to 0 over ~30ms, then back
   *  to 1 after a short hold, so subsequent notes are immediately audible.
   *
   *  Implemented entirely on the input gain node so it works regardless of which
   *  synth backend produced the tails. */
  cutTails(): void {
    if (!this._input) return;
    const ctx = Tone.getContext();
    const now = ctx.currentTime;
    const ramp = 0.03;
    const hold = 0.005;
    try {
      this._input.gain.cancelScheduledValues(now);
      this._input.gain.setValueAtTime(this._input.gain.value, now);
      this._input.gain.linearRampToValueAtTime(0, now + ramp);
      this._input.gain.setValueAtTime(0, now + ramp + hold);
      this._input.gain.linearRampToValueAtTime(1, now + ramp + hold + 0.01);
    } catch {
      // No-op: AudioParam scheduling can throw in edge cases (suspended context);
      // a missed mute briefly is better than a thrown error.
    }
  }

  /** Current reverb settings. */
  get settings(): ReverbSettings {
    return this._settings;
  }

  /** Promise that resolves when the most recent IR generation finishes. Useful in
   *  tests to wait for the reverb to be audible. */
  get reverbReady(): Promise<void> {
    return this._generatePromise ?? Promise.resolve();
  }

  /** Tear down the bus. Currently only used in tests. */
  dispose(): void {
    this._input?.dispose();
    this._reverb?.dispose();
    this._busCompressor?.dispose();
    this._masterGain?.dispose();
    this._limiter?.dispose();
    this._safetyClip?.dispose();
    this._input = null;
    this._reverb = null;
    this._busCompressor = null;
    this._masterGain = null;
    this._limiter = null;
    this._safetyClip = null;
    this._generatePromise = null;
    this._settings = DEFAULT_REVERB_SETTINGS;
  }
}

export const MasterBus = new MasterBusImpl();

/** Test-only helper. Resets the singleton so each test starts with fresh nodes. */
export function _resetMasterBusForTests(): void {
  MasterBus.dispose();
}
