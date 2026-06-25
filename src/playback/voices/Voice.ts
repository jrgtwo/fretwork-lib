/**
 * Voice — a configurable `GuitarInstrument` built from a `VoicePreset`.
 *
 * Signal chain (top of file):
 *
 *   synth ─► [bodyFilter] ─► [compressor] ─► [distortion] ─► [chorus] ─►
 *                            [delay] ─► [eq] ─► [autoWah] ─► [cabIR] ─►
 *                                                            volume ─► pan ─► output
 *
 * Bracketed nodes are optional — they are constructed only when their config is
 * present on the preset. `volume` and `pan` are always present so every voice
 * can be balanced individually. `output` connects into the `MasterBus`, which
 * provides global reverb and routes to the audio destination.
 *
 * Mutability: the synth + chain are built once per Voice instance. Almost all
 * parameters can be **mutated in place** via `updateSynthParams()` and
 * `updateEffects()`. Adding or removing a chain node (e.g. enabling the
 * compressor for the first time) triggers a chain rebuild so the new node can
 * be inserted at the correct position.
 */
import * as Tone from 'tone';
import type {
  ADSREnvelope,
  AmpParams,
  AutoWahParams,
  BodyFilterEnvelope,
  BodyFilterParams,
  ChorusParams,
  ChorusType,
  CompressorParams,
  DelayParams,
  DistortionParams,
  EQParams,
  EffectsConfig,
  GraphicEqParams,
  PluckSynthParams,
  FMSynthParams,
  OscillatorType,
  VoiceLayer,
  VoiceLevel,
  VoicePreset,
  VoiceReverbParams,
  VoiceSource,
} from './types';
import { NotesBus } from './NotesBus';
import { getAmpModel } from './amp-models';

/** A rack stage is "in the chain" iff its params object exists AND its
 *  optional `enabled` flag isn't explicitly `false`. Undefined `enabled`
 *  reads as on, so any pre-existing variant or preset that pre-dates the
 *  enabled flag keeps working as before. Set `enabled: false` in the lab
 *  to disable a stage without losing the user's tuned values. */
function isStageEnabled<T extends { enabled?: boolean } | undefined>(
  params: T,
): params is Exclude<T, undefined> {
  return params != null && params.enabled !== false;
}
import { noteTriggered } from '../audio-debug';
import type { GuitarInstrument } from '../types';

export const DEFAULT_VOICE_LEVEL: VoiceLevel = { volumeDb: 0, pan: 0 };

interface ChainNodes {
  bodyFilter?: Tone.Filter;
  /** FrequencyEnvelope driving `bodyFilter.frequency`, triggered per note. Only
   *  present when the body filter has an `envelope` config. */
  bodyFilterEnvelope?: Tone.FrequencyEnvelope;
  compressor?: Tone.Compressor;
  // Pedalboard stage (pre-amp pedals)
  distortion?: Tone.Distortion;
  chorus?: Tone.Chorus;
  delay?: Tone.FeedbackDelay;
  autoWah?: Tone.AutoWah;
  // Graphic EQ stage (8 nodes when present: 7 peaking filters + level gain)
  /** Seven peaking filters at fixed frequencies (100/200/400/800/1.6k/3.2k/6.4k Hz)
   *  modelling a Boss GE-7. Built/disposed as a group with `graphicEqLevel`. */
  graphicEqBands?: readonly Tone.Filter[];
  /** Output trim after the 7 bands — compensates for cuts/boosts changing
   *  apparent loudness. */
  graphicEqLevel?: Tone.Gain;
  // Amp stage (9 nodes when present, all built/disposed together).
  // Topology: input → preGain → split[hpf, lpf] → hpf → preDist → powerDist →
  //           merge ← lpf ← (clean bass bypass) → tone → presence → output.
  // Bass-split before drive keeps the lows clean (cab can't reproduce muddy
  // distorted bass anyway) and lets the saturation work on the harmonically
  // interesting mid+high range. Tone stack runs on the merged signal so
  // bass/mid/treble controls affect the full bandwidth.
  /** Input gain driving signal into the pre-amp section. */
  ampPreGain?: Tone.Gain;
  /** High-pass at ~120 Hz — feeds the saturation chain. Lows bypass. */
  ampBassHpf?: Tone.Filter;
  /** Low-pass at ~120 Hz — clean bass bypass around the saturators. */
  ampBassLpf?: Tone.Filter;
  /** Pre-amp saturation. Asymmetric soft-clip WaveShaper (replaces the old
   *  symmetric Tone.Distortion polynomial — that's the "metallic" sound). */
  ampPreDist?: Tone.WaveShaper;
  /** Power-amp saturation. Same asymmetric WaveShaper algorithm, separate
   *  drive amount. */
  ampPowerDist?: Tone.WaveShaper;
  /** Summing node where the driven highs + clean lows meet. */
  ampBassMerge?: Tone.Gain;
  /** Tone stack — bass/mid/treble shaping. Now operates on the re-merged
   *  signal (was between preDist and powerDist). The bass knob now affects
   *  the clean-bypass low-end as well, which matches how real amp tone
   *  controls feel. */
  ampTone?: Tone.EQ3;
  /** Presence shelf — high-shelf around 3 kHz, modelled on the power-amp's
   *  negative-feedback presence control. */
  ampPresence?: Tone.Filter;
  /** Output trim after all amp stages. */
  ampOutput?: Tone.Gain;
  /** Per-voice spring/plate reverb. Sits between the amp and the cab in
   *  the chain, mimicking a guitar amp's built-in reverb tank. Separate
   *  from the global MasterBus reverb send. */
  voiceReverb?: Tone.JCReverb;
  /** Cabinet IR convolution — last tone-shaping stage before vol/pan.
   *  Loads its IR file asynchronously; passes audio through (uncolored)
   *  until the IR is fetched and decoded. */
  cabIR?: Tone.Convolver;
  /** Makeup gain applied right after the convolver. Compensates for the
   *  loudness shift convolution introduces (some IRs come out hotter than
   *  dry, some quieter; depends on the IR's spectral shape). */
  cabIRMakeup?: Tone.Gain;
  /** Post-cab mastering EQ — final tone-shaping stage before vol/pan. */
  finalEq?: Tone.EQ3;
  // Always present:
  /** Pre-chain input gain — first node after the mixer/synth. Lets the user
   *  attenuate hot samples (or boost quiet sources) before anything else
   *  processes the signal. Always built so the chain has a consistent entry
   *  point regardless of whether the preset specifies inputGainDb. */
  inputGain?: Tone.Gain;
  /** Tap on the inputGain output — measures what's actually entering the
   *  amp/effects chain after the input-gain stage. */
  inputMeter?: Tone.Meter;
  volume?: Tone.Volume;
  panner?: Tone.Panner;
  /** Tap on the panner output — measures the per-voice signal right before
   *  it hits MasterBus. Catches clipping introduced by the saturators / cab
   *  IR / makeup gain / Voice Level. */
  outputMeter?: Tone.Meter;
}

type SynthNode = Tone.PluckSynth | Tone.FMSynth | Tone.Sampler;

export class Voice implements GuitarInstrument {
  private _preset: VoicePreset;
  private _synth: SynthNode | null = null;
  /** Optional second synth for sub-body / harmonic stacking. Triggered alongside
   *  the primary on every note, possibly transposed. */
  private _layerSynth: SynthNode | null = null;
  /** Gain that controls the layer's mix level relative to the primary. */
  private _layerGain: Tone.Gain | null = null;
  /** Sampler-kind voices: one Tone.Sampler per round-robin bank. Voice rotates
   *  between these in play() to humanize repeated-note passages. For non-sampler
   *  voices, null — _synth is the only sound source. */
  private _samplerBanks: Tone.Sampler[] | null = null;
  /** Parallel to `_samplerBanks` — the original URL maps so `_pickBankFor`
   *  can check which banks contain an exact-match sample for a given pitch
   *  (banks with non-uniform coverage are rotated only among those that have
   *  the requested note, avoiding audible pitch-shift from distant neighbors). */
  private _samplerBankUrls: ReadonlyArray<Readonly<Record<string, string>>> | null = null;
  /** Per-pitch index of the last bank played, for random-no-repeat rotation.
   *  Keys are note names ("A3"), values are bank indices. */
  private _lastBankByPitch: Map<string, number> = new Map();
  /** Always-present mixer node so layer + primary feed the same chain entry. */
  private _mixer: Tone.Gain | null = null;
  /** Always-present vibrato node. Depth=0 when idle; `play()` schedules
   *  depth ramps for per-note vibrato. */
  private _vibrato: Tone.Vibrato | null = null;
  /** Always-present pitch-shifter node. Pitch=0 when idle; `play()`
   *  schedules pitch ramps for per-note slides. Monophonic only: notes
   *  overlapping with an active slide will share the pitch shift. */
  private _pitchShift: Tone.PitchShift | null = null;
  /** Always-present low-pass filter for palm-mute timbre. Cutoff sits at
   *  ~20 kHz (inaudible attenuation) when idle; ramps down to ~600 Hz for
   *  the duration of palm-muted notes to deliver the chunky dampened tone. */
  private _palmMuteFilter: Tone.Filter | null = null;
  private _chain: ChainNodes = {};
  private _exit: Tone.ToneAudioNode | null = null;
  private _connectedToMaster = false;
  /** Voices default to auto-connecting their output to the master bus. The
   *  multi-track playback path opts out so it can insert per-track gain
   *  nodes between the voice and master. */
  private _autoConnectToMaster = true;
  /** Set by the multi-track wiring; `_ensureBuilt` connects the chain
   *  exit to this node instead of MasterBus when present. */
  private _customRoutingTarget: Tone.ToneAudioNode | null = null;

  constructor(preset: VoicePreset, options?: { autoConnectToMaster?: boolean }) {
    this._preset = preset;
    if (options?.autoConnectToMaster === false) this._autoConnectToMaster = false;
  }

  get preset(): VoicePreset {
    return this._preset;
  }

  get output(): Tone.ToneAudioNode | undefined {
    return this._exit ?? undefined;
  }

  // ─── Build / tear down ───────────────────────────────────────────────────────

  /** Eagerly construct the synth + audio chain. Normally `play()` does this
   *  lazily on first call, but callers that need the chain ready before the
   *  first note (most importantly MultiTrackPlayback wiring per-track
   *  routing during composition setup) should call this explicitly so any
   *  sample loads begin immediately instead of waiting for the first
   *  triggerAttackRelease — otherwise the first few notes fire into an
   *  unloaded Sampler and play silently. */
  ensureBuilt(): void {
    this._ensureBuilt();
  }

  private _ensureBuilt(): void {
    if (this._synth) return;
    const src = this._preset.source;
    const hasAnyBank =
      src.kind === 'sampler' &&
      src.samples.some((b) => Object.keys(b).length > 0);
    if (hasAnyBank) {
      // Multi-bank sampler: one Tone.Sampler per round-robin take, all
      // connected to the mixer in parallel. play() picks one bank per trigger
      // via random-no-repeat in `_pickBankFor`. _samplerBankUrls stays parallel
      // to _samplerBanks so the picker can check exact-match coverage.
      const samplerSrc = src as VoiceSource & { kind: 'sampler' };
      const nonEmpty = samplerSrc.samples.filter((b) => Object.keys(b).length > 0);
      this._samplerBankUrls = nonEmpty;
      this._samplerBanks = nonEmpty.map((urls) => new Tone.Sampler({
        urls: urls as Record<string, string>,
        release: samplerSrc.release ?? 1,
        // 5 ms fade-in envelope on every trigger. Smooths the BufferSource
        // start so any noise-floor wobble or mp3 encoder-delay edge in the
        // first samples of the decoded buffer doesn't produce an audible
        // click. 5 ms is below the perceptual threshold for "soft attack" —
        // real guitar pluck attacks are 5-20 ms anyway.
        attack: 0.005,
      }));
      this._synth = this._samplerBanks[0];
      this._mixer = new Tone.Gain(1);
      for (const bank of this._samplerBanks) bank.connect(this._mixer);
    } else {
      // Single-synth path: pluck-synth, fm-synth, or sampler with all-empty
      // banks (falls back to a neutral PluckSynth inside `buildSynth`).
      this._synth = buildSynth(src);
      this._samplerBanks = null;
      this._samplerBankUrls = null;
      this._mixer = new Tone.Gain(1);
      this._synth.connect(this._mixer);
    }
    if (this._preset.layer) {
      this._buildLayer(this._preset.layer);
    }
    // Per-note vibrato + pitch-shift nodes — always present, idle when no
    // event carries the flag. Placed immediately after the mixer so they
    // modulate the dry voice signal before any timbral effects (filter,
    // distortion, chorus) shape it. PitchShift uses granular FFT; quality
    // dialed back via `windowSize` for low CPU.
    this._vibrato = new Tone.Vibrato({ frequency: 5.5, depth: 0 });
    this._pitchShift = new Tone.PitchShift({ pitch: 0, windowSize: 0.05 });
    this._palmMuteFilter = new Tone.Filter({ type: 'lowpass', frequency: 20000, Q: 0.7 });
    this._mixer.connect(this._vibrato);
    this._vibrato.connect(this._pitchShift);
    this._pitchShift.connect(this._palmMuteFilter);
    this._chain = buildChain(this._preset);
    this._exit = wireChain(this._palmMuteFilter, this._chain);
    if (this._autoConnectToMaster) {
      NotesBus.connectVoice(this._exit);
      this._connectedToMaster = true;
    } else if (this._customRoutingTarget) {
      // Multi-track playback path: the manager wired up a per-track Gain
      // before the first play() triggered this build. Connect to it now.
      this._exit.connect(this._customRoutingTarget);
    }
  }

  private _buildLayer(layer: VoiceLayer): void {
    if (!this._mixer) return;
    this._layerSynth = buildSynth(layer.source);
    applyLayerDetune(this._layerSynth, layer.detuneCents);
    this._layerGain = new Tone.Gain(dbToGain(layer.gainDb));
    this._layerSynth.connect(this._layerGain);
    this._layerGain.connect(this._mixer);
  }

  private _disposeLayer(): void {
    this._layerSynth?.dispose();
    this._layerGain?.dispose();
    this._layerSynth = null;
    this._layerGain = null;
  }

  // ─── GuitarInstrument ────────────────────────────────────────────────────────

  play(
    noteName: string,
    duration: string | number,
    audioTime: number,
    options?: {
      velocity?: number;
      vibrato?: 'slight' | 'wide';
      durationSec?: number;
      pitchCurve?: Array<{ at: number; semitones: number }>;
      palmMute?: boolean;
    },
  ): void {
    this._ensureBuilt();
    const synth = this._pickBankFor(noteName);
    const velocity = options?.velocity;
    // Audio-thread instrumentation (no-op when window.__FRETWORK_AUDIO_DEBUG
    // is falsy). Track active note count + release-tail estimate so the
    // debug logger can correlate polyphony with audio buffer underruns.
    const durSecForDebug = options?.durationSec ?? (typeof duration === 'number' ? duration : 1);
    const releaseEstimate = this._preset.source.kind === 'sampler' ? (this._preset.source.release ?? 1) : 1;
    noteTriggered(durSecForDebug + releaseEstimate);
    // Sub-cent humanization. Tone.Sampler reproduces every trigger at the
    // exact same pitch, which makes consecutive notes (especially scales
    // and arpeggios) sound mechanical. Real guitarists land microtones off
    // every pluck — ±5 cents is below the conscious-pitch threshold but
    // enough to break the sterile uniformity. We perturb the frequency
    // passed to the trigger (not the Sampler.detune Signal) so each voice
    // gets its own pitch offset without modulating in-flight sustaining
    // voices on the same Sampler.
    const HUMANIZE_RANGE_CENTS = 10; // ±5 cents
    const detuneCents = (Math.random() - 0.5) * HUMANIZE_RANGE_CENTS;
    const triggerFreq =
      Tone.Frequency(noteName).toFrequency() * Math.pow(2, detuneCents / 1200);
    try {
      synth.triggerAttackRelease(triggerFreq, duration, audioTime, velocity);
      // Trigger the body-filter envelope on each note so the cutoff sweeps in
      // sync with the pluck. The envelope's release continues after the synth
      // is silent, which is fine — it only modulates the filter, not the audio.
      this._chain.bodyFilterEnvelope?.triggerAttackRelease(duration, audioTime, velocity);
      // Trigger the layer too, transposed by its octave offset.
      if (this._layerSynth && this._preset.layer) {
        const layerNote = transposeNote(noteName, this._preset.layer.octaveOffset * 12);
        this._layerSynth.triggerAttackRelease(layerNote, duration, audioTime, velocity);
      }
      // Per-note palm-mute. Drop the low-pass filter cutoff to ~600 Hz at
      // note start (instant — palm-mute kicks in immediately) and ramp it
      // back to ~20 kHz (effectively bypassed) right after the note ends.
      // The drop kills the bright pluck transient while the audible
      // duration shortening (done at the scheduler level) gives the chug.
      if (options?.palmMute && options.durationSec != null && this._palmMuteFilter) {
        const dur = Math.max(0.05, options.durationSec);
        const freq = this._palmMuteFilter.frequency;
        freq.cancelScheduledValues(audioTime);
        freq.setValueAtTime(600, audioTime);
        freq.setValueAtTime(600, audioTime + dur);
        // Quick ramp back up after the note so subsequent (non-muted)
        // notes regain their full brightness.
        freq.linearRampToValueAtTime(20000, audioTime + dur + 0.02);
      } else if (this._palmMuteFilter) {
        // Defensively keep the filter open — if a previous palm-mute's
        // ramp hadn't completed when a non-muted note fires, force it.
        this._palmMuteFilter.frequency.cancelScheduledValues(audioTime);
        this._palmMuteFilter.frequency.setValueAtTime(20000, audioTime);
      }
      // Per-note pitch curve (slides + bends share the same mechanism).
      // Tone.PitchShift's `pitch` is a plain JS number property (no Signal
      // API), so we step it manually via setTimeout using audio-clock-
      // relative delays. ~32 Hz step rate is smooth enough for typical
      // durations (200-1500 ms) without burning CPU. Not sample-accurate
      // but well under the audible-jitter threshold for pitch glides.
      if (options?.pitchCurve && options.durationSec != null && this._pitchShift) {
        schedulePitchCurve(
          this._pitchShift,
          audioTime,
          options.durationSec,
          options.pitchCurve,
        );
      }
      // Per-note vibrato. Schedule depth/frequency at the note's start,
      // hold for most of the duration, ramp back to 0 just before release
      // so the next note starts unmodulated. Tone.Vibrato applies pitch
      // wobble via a fractional delay line — works for any source.
      if (options?.vibrato && options.durationSec != null && this._vibrato) {
        const intensity = options.vibrato === 'wide'
          ? { frequency: 4, depth: 0.12 }
          : { frequency: 5.5, depth: 0.04 };
        const start = audioTime;
        const end = audioTime + Math.max(0.05, options.durationSec);
        const attack = Math.min(0.04, options.durationSec * 0.2);
        const release = Math.min(0.05, options.durationSec * 0.2);
        // Cancel any in-flight automations so the next note doesn't inherit
        // depth from a previously-scheduled ramp.
        this._vibrato.depth.cancelScheduledValues(start);
        this._vibrato.frequency.cancelScheduledValues(start);
        this._vibrato.frequency.setValueAtTime(intensity.frequency, start);
        this._vibrato.depth.setValueAtTime(0, start);
        this._vibrato.depth.linearRampToValueAtTime(intensity.depth, start + attack);
        this._vibrato.depth.setValueAtTime(intensity.depth, end - release);
        this._vibrato.depth.linearRampToValueAtTime(0, end);
      }
    } catch {
      // Tone occasionally throws when scheduled too close to the previous trigger.
      // The visual playhead still advances; missing one click is not fatal.
    }
  }

  releaseAll(): void {
    // PluckSynth has natural decay; FMSynth has its own envelope. Nothing to do.
  }

  dispose(): void {
    if (this._connectedToMaster && this._exit) {
      NotesBus.disconnectVoice(this._exit);
      this._connectedToMaster = false;
    }
    if (this._samplerBanks) {
      for (const b of this._samplerBanks) b.dispose();
      this._samplerBanks = null;
    } else {
      this._synth?.dispose();
    }
    this._samplerBankUrls = null;
    this._lastBankByPitch.clear();
    this._disposeLayer();
    this._mixer?.dispose();
    this._vibrato?.dispose();
    this._pitchShift?.dispose();
    this._palmMuteFilter?.dispose();
    disposeChain(this._chain);
    this._synth = null;
    this._mixer = null;
    this._vibrato = null;
    this._pitchShift = null;
    this._palmMuteFilter = null;
    this._chain = {};
    this._exit = null;
  }

  // ─── Live tweaks (Sound Lab) ────────────────────────────────────────────────

  /** Update synth parameters in place. Only valid for the current source kind —
   *  switching between e.g. PluckSynth and FMSynth requires constructing a new Voice. */
  updateSynthParams(params: PluckSynthParams | FMSynthParams): void {
    if (!this._synth) {
      this._preset = updatePresetSynthParams(this._preset, params);
      return;
    }
    if (this._preset.source.kind === 'pluck-synth' && this._synth instanceof Tone.PluckSynth) {
      applyPluckSynth(this._synth, params as PluckSynthParams);
    } else if (this._preset.source.kind === 'fm-synth' && this._synth instanceof Tone.FMSynth) {
      applyFMSynth(this._synth, params as FMSynthParams);
    }
    this._preset = updatePresetSynthParams(this._preset, params);
  }

  /** Update the per-voice level (volume + pan) in place. */
  updateLevel(level: VoiceLevel): void {
    this._preset = { ...this._preset, level };
    if (this._chain.volume) this._chain.volume.volume.rampTo(level.volumeDb, 0.02);
    if (this._chain.panner) this._chain.panner.pan.rampTo(level.pan, 0.02);
  }

  /** Update the pre-chain input gain in place. Lets the user attenuate hot
   *  samples (or boost quiet sources) before anything else processes the
   *  signal. */
  updateInputGain(inputGainDb: number | undefined): void {
    this._preset = { ...this._preset, inputGainDb };
    if (this._chain.inputGain) {
      this._chain.inputGain.gain.rampTo(dbToGain(inputGainDb ?? 0), 0.02);
    }
  }

  /** Current peak level (dBFS) at the input tap — after the user's input-gain
   *  knob, before bodyFilter / amp / etc. Returns `-Infinity` if the chain
   *  isn't built yet (no audio flowing). Designed for ~60 fps UI polling. */
  getInputLevelDb(): number {
    if (!this._chain.inputMeter) return -Infinity;
    const v = this._chain.inputMeter.getValue();
    return typeof v === 'number' ? v : v[0] ?? -Infinity;
  }

  /** Current peak level (dBFS) at the output tap — the per-voice signal as it
   *  hits MasterBus. Returns `-Infinity` if the chain isn't built yet. */
  getOutputLevelDb(): number {
    if (!this._chain.outputMeter) return -Infinity;
    const v = this._chain.outputMeter.getValue();
    return typeof v === 'number' ? v : v[0] ?? -Infinity;
  }

  /** Update / add / remove the sub-body layer. Source-kind changes (or
   *  add/remove) rebuild the layer; everything else mutates in place. */
  updateLayer(next: VoiceLayer | undefined): void {
    const prev = this._preset.layer;
    this._preset = { ...this._preset, layer: next };
    if (!this._synth || !this._mixer) return;

    const sourceKindChanged = (prev?.source.kind ?? null) !== (next?.source.kind ?? null);
    if (!!prev !== !!next || sourceKindChanged) {
      this._disposeLayer();
      if (next) this._buildLayer(next);
      return;
    }
    if (next && this._layerSynth && this._layerGain) {
      // Same source kind — just update params.
      if (next.source.kind === 'pluck-synth' && this._layerSynth instanceof Tone.PluckSynth) {
        applyPluckSynth(this._layerSynth, next.source.params);
      } else if (next.source.kind === 'fm-synth' && this._layerSynth instanceof Tone.FMSynth) {
        applyFMSynth(this._layerSynth, next.source.params);
      }
      applyLayerDetune(this._layerSynth, next.detuneCents);
      this._layerGain.gain.rampTo(dbToGain(next.gainDb), 0.02);
    }
  }

  /** Update or remove the body filter. Adding/removing the filter (or its
   *  envelope), or flipping its `enabled` flag, rebuilds the chain;
   *  parameter-only changes mutate in place. */
  updateBodyFilter(next: BodyFilterParams | undefined): void {
    const prev = this._preset.bodyFilter;
    this._preset = { ...this._preset, bodyFilter: next };
    if (!this._synth) return;
    if (isStageEnabled(prev) !== isStageEnabled(next) || !!prev?.envelope !== !!next?.envelope) {
      this._rebuildChain();
      return;
    }
    if (next && this._chain.bodyFilter) {
      applyBodyFilter(this._chain.bodyFilter, next);
    }
    if (next?.envelope && this._chain.bodyFilterEnvelope) {
      applyBodyFilterEnvelope(this._chain.bodyFilterEnvelope, next.envelope);
    }
  }

  /** Update or remove the compressor. Flipping `enabled` rebuilds the chain;
   *  parameter-only changes mutate in place. */
  updateCompressor(next: CompressorParams | undefined): void {
    const prev = this._preset.compressor;
    this._preset = { ...this._preset, compressor: next };
    if (!this._synth) return;
    if (isStageEnabled(prev) !== isStageEnabled(next)) {
      this._rebuildChain();
      return;
    }
    if (next && this._chain.compressor) {
      applyCompressor(this._chain.compressor, next);
    }
  }

  /** Update effects. Same-shape changes mutate in place; add/remove rebuilds. */
  updateEffects(next: EffectsConfig | undefined): void {
    const prev = this._preset.effects;
    this._preset = { ...this._preset, effects: next };
    if (!this._synth) return;
    if (!sameEffectsShape(prev, next)) {
      this._rebuildChain();
      return;
    }
    if (next?.distortion && this._chain.distortion) applyDistortion(this._chain.distortion, next.distortion);
    if (next?.chorus && this._chain.chorus) applyChorus(this._chain.chorus, next.chorus);
    if (next?.delay && this._chain.delay) applyDelay(this._chain.delay, next.delay);
    if (next?.autoWah && this._chain.autoWah) applyAutoWah(this._chain.autoWah, next.autoWah);
    if (next?.graphicEq) applyGraphicEq(this._chain, next.graphicEq);
    if (next?.amp) applyAmp(this._chain, next.amp);
    if (next?.reverb && this._chain.voiceReverb) applyVoiceReverb(this._chain.voiceReverb, next.reverb);
    if (next?.cabIR && this._chain.cabIRMakeup) {
      this._chain.cabIRMakeup.gain.rampTo(dbToGain(next.cabIR.makeupDb ?? 0), 0.02);
    }
    if (next?.finalEq && this._chain.finalEq) applyEQ(this._chain.finalEq, next.finalEq);
  }

  /** Replace the active preset entirely. Same source kind reuses the synth. */
  swapPreset(next: VoicePreset): void {
    if (next.source.kind !== this._preset.source.kind) {
      this.dispose();
      this._preset = next;
      return;
    }
    this.updateSynthParams(extractSynthParams(next.source));
    this.updateLayer(next.layer);
    this.updateInputGain(next.inputGainDb);
    this.updateLevel(next.level);
    this.updateBodyFilter(next.bodyFilter);
    this.updateCompressor(next.compressor);
    this.updateEffects(next.effects);
    this._preset = next;
  }

  // ─── Internal ────────────────────────────────────────────────────────────────

  /** Pick which synth node fires for this note. For non-sampler voices, always
   *  `_synth`. For sampler-kind voices, coverage-aware random-no-repeat:
   *  rotates only among banks whose URL map has an exact-match entry for the
   *  requested pitch (Tone.Sampler pitch-shifts inside a bank when the exact
   *  note is missing — distant shifts sound wrong, so we keep rotation within
   *  the "exact match" pool). Falls back to the full bank pool if no bank has
   *  the pitch (uniform pitch-shift across all banks then). */
  private _pickBankFor(noteName: string): SynthNode {
    if (!this._samplerBanks || !this._samplerBankUrls) return this._synth!;
    const banks = this._samplerBanks;
    const urlMaps = this._samplerBankUrls;
    let pool: number[] = [];
    for (let i = 0; i < urlMaps.length; i++) {
      if (urlMaps[i][noteName] !== undefined) pool.push(i);
    }
    if (pool.length === 0) pool = banks.map((_, i) => i);
    const n = pool.length;
    if (n <= 1) return banks[pool[0]];
    const last = this._lastBankByPitch.get(noteName);
    const lastIdx = last !== undefined ? pool.indexOf(last) : -1;
    let pickedIdx: number;
    if (lastIdx < 0) {
      pickedIdx = Math.floor(Math.random() * n);
    } else {
      // Uniform over n-1 banks in the pool excluding `last`: pick from
      // [0..n-2], shift if ≥ lastIdx.
      pickedIdx = Math.floor(Math.random() * (n - 1));
      if (pickedIdx >= lastIdx) pickedIdx++;
    }
    const picked = pool[pickedIdx];
    this._lastBankByPitch.set(noteName, picked);
    return banks[picked];
  }

  private _rebuildChain(): void {
    if (
      !this._synth ||
      !this._mixer ||
      !this._exit ||
      !this._vibrato ||
      !this._pitchShift ||
      !this._palmMuteFilter
    )
      return;
    if (this._connectedToMaster) {
      NotesBus.disconnectVoice(this._exit);
      this._connectedToMaster = false;
    }
    this._mixer.disconnect();
    this._vibrato.disconnect();
    this._pitchShift.disconnect();
    this._palmMuteFilter.disconnect();
    disposeChain(this._chain);
    this._mixer.connect(this._vibrato);
    this._vibrato.connect(this._pitchShift);
    this._pitchShift.connect(this._palmMuteFilter);
    this._chain = buildChain(this._preset);
    this._exit = wireChain(this._palmMuteFilter, this._chain);
    if (this._autoConnectToMaster) {
      NotesBus.connectVoice(this._exit);
      this._connectedToMaster = true;
    } else if (this._customRoutingTarget) {
      this._exit.connect(this._customRoutingTarget);
    }
  }

  /**
   * Multi-track playback support: connect this voice's output to a custom
   * downstream node (typically a per-track Gain) rather than going through
   * MasterBus directly. Must be called after `_ensureBuilt` has run (via
   * any prior `play()` call) — for the first play we cache the target so
   * `_ensureBuilt` can wire it on construction.
   */
  setRoutingTarget(target: Tone.ToneAudioNode | null): void {
    this._customRoutingTarget = target;
    if (this._exit) {
      this._exit.disconnect();
      if (target) this._exit.connect(target);
    }
  }
}

// ─── Note transposition + dB helpers ──────────────────────────────────────────

/** Transpose a note name by N semitones via Tone's Frequency utility. */
function transposeNote(note: string, semitones: number): string {
  if (semitones === 0) return note;
  return Tone.Frequency(note).transpose(semitones).toNote();
}

/**
 * Step a Tone.PitchShift node's pitch through an arbitrary `(at, semitones)`
 * curve over `durationSec`. Used by both slides (2- or 3-point curves) and
 * bends (typically 3-4 point curves with intermediate hold regions).
 *
 * The curve points are first sorted by `at`. Between two adjacent points,
 * the pitch interpolates linearly. The resampler hits 32 evenly-spaced
 * positions across the note duration — fine enough for a smooth glide,
 * cheap enough to not strain setTimeout.
 *
 * Pitch resets to 0 right after the note ends so subsequent notes start
 * unshifted (matters especially for bend-release and slide-out which
 * leave the pitch off-zero at the end of the curve).
 */
function schedulePitchCurve(
  pitchShift: Tone.PitchShift,
  audioTime: number,
  durationSec: number,
  rawCurve: Array<{ at: number; semitones: number }>,
): void {
  if (rawCurve.length === 0) return;
  const curve = [...rawCurve].sort((a, b) => a.at - b.at);
  const dur = Math.max(0.05, durationSec);
  const stepCount = 32;
  const nowAudioTime = Tone.getContext().currentTime;
  const baseDelayMs = Math.max(0, (audioTime - nowAudioTime) * 1000);

  for (let i = 0; i <= stepCount; i++) {
    const t = i / stepCount;
    const semitones = sampleCurveAt(curve, t);
    const delayMs = baseDelayMs + dur * t * 1000;
    setTimeout(() => {
      if (!pitchShift.disposed) pitchShift.pitch = semitones;
    }, delayMs);
  }
  setTimeout(() => {
    if (!pitchShift.disposed) pitchShift.pitch = 0;
  }, baseDelayMs + dur * 1000);
}

/**
 * Linear interpolation across a sorted `(at, semitones)` curve. Times before
 * the first point clamp to its value; times after the last clamp to its.
 */
function sampleCurveAt(
  curve: Array<{ at: number; semitones: number }>,
  t: number,
): number {
  if (t <= curve[0].at) return curve[0].semitones;
  if (t >= curve[curve.length - 1].at) return curve[curve.length - 1].semitones;
  for (let i = 1; i < curve.length; i++) {
    const a = curve[i - 1];
    const b = curve[i];
    if (t <= b.at) {
      const span = b.at - a.at;
      if (span <= 0) return b.semitones;
      const localT = (t - a.at) / span;
      return a.semitones + (b.semitones - a.semitones) * localT;
    }
  }
  return curve[curve.length - 1].semitones;
}

function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

/** Apply detune (in cents) to whichever synth supports it. PluckSynth has no
 *  detune param so the call is a no-op for it. */
function applyLayerDetune(synth: SynthNode, cents: number): void {
  if (synth instanceof Tone.FMSynth) {
    synth.detune.value = cents;
  }
  // PluckSynth — silently ignored.
}

// ─── Build helpers ─────────────────────────────────────────────────────────────

function buildSynth(source: VoiceSource): SynthNode {
  if (source.kind === 'pluck-synth') {
    const { attackNoise, dampening, resonance, release } = source.params;
    return new Tone.PluckSynth({ attackNoise, dampening, resonance, release });
  }
  if (source.kind === 'fm-synth') {
    const p = source.params;
    const synth = new Tone.FMSynth({
      harmonicity: p.harmonicity,
      modulationIndex: p.modulationIndex,
      detune: p.detune,
      oscillator: { type: p.carrierWaveform },
      modulation: { type: p.modulatorWaveform },
      envelope: { ...p.envelope },
      modulationEnvelope: { ...p.modulationEnvelope },
    });
    return synth;
  }
  // Sampler — single-bank path. Reads bank 0; multi-bank sampler voices go
  // through `buildSamplerBanks` via _ensureBuilt instead. Empty banks fall back
  // to a neutral PluckSynth so the voice still makes sound until samples attach.
  const bank0 = source.samples[0] ?? {};
  if (Object.keys(bank0).length === 0) {
    return new Tone.PluckSynth({ attackNoise: 0.5, dampening: 4000, resonance: 0.85, release: 0.5 });
  }
  return new Tone.Sampler({
    urls: bank0 as Record<string, string>,
    release: source.release ?? 1,
    attack: 0.005,
  });
}


function buildChain(preset: VoicePreset): ChainNodes {
  const nodes: ChainNodes = {};
  if (isStageEnabled(preset.bodyFilter)) {
    nodes.bodyFilter = new Tone.Filter({
      type: 'lowpass',
      frequency: preset.bodyFilter.cutoff,
      Q: preset.bodyFilter.q,
    });
    if (preset.bodyFilter.envelope) {
      const env = preset.bodyFilter.envelope;
      nodes.bodyFilterEnvelope = new Tone.FrequencyEnvelope({
        attack: env.attack,
        decay: env.decay,
        sustain: env.sustain,
        release: env.release,
        baseFrequency: env.baseFrequency,
        octaves: env.octaves,
      });
      nodes.bodyFilterEnvelope.connect(nodes.bodyFilter.frequency);
    }
  }
  if (isStageEnabled(preset.compressor)) {
    nodes.compressor = new Tone.Compressor({
      threshold: preset.compressor.threshold,
      ratio: preset.compressor.ratio,
      attack: preset.compressor.attack,
      release: preset.compressor.release,
      knee: preset.compressor.knee,
    });
  }
  if (isStageEnabled(preset.effects?.distortion)) {
    nodes.distortion = new Tone.Distortion({
      distortion: preset.effects.distortion.drive,
      wet: preset.effects.distortion.wet,
      oversample: preset.effects.distortion.oversample,
    });
  }
  if (isStageEnabled(preset.effects?.chorus)) {
    nodes.chorus = new Tone.Chorus({
      frequency: preset.effects.chorus.frequency,
      depth: preset.effects.chorus.depth,
      wet: preset.effects.chorus.wet,
      type: preset.effects.chorus.type,
      feedback: preset.effects.chorus.feedback,
      delayTime: preset.effects.chorus.delayTime * 1000, // Tone Chorus delayTime is ms
      spread: preset.effects.chorus.spread,
    });
    nodes.chorus.start();
  }
  if (isStageEnabled(preset.effects?.delay)) {
    nodes.delay = new Tone.FeedbackDelay({
      delayTime: preset.effects.delay.delayTime,
      feedback: preset.effects.delay.feedback,
      wet: preset.effects.delay.wet,
    });
  }
  if (isStageEnabled(preset.effects?.autoWah)) {
    nodes.autoWah = new Tone.AutoWah({
      baseFrequency: preset.effects.autoWah.baseFrequency,
      octaves: preset.effects.autoWah.octaves,
      sensitivity: preset.effects.autoWah.sensitivity,
      Q: preset.effects.autoWah.q,
      gain: preset.effects.autoWah.gain,
      wet: preset.effects.autoWah.wet,
    });
  }
  if (isStageEnabled(preset.effects?.graphicEq)) {
    nodes.graphicEqBands = buildGraphicEqBands(preset.effects.graphicEq);
    nodes.graphicEqLevel = new Tone.Gain(dbToGain(preset.effects.graphicEq.levelDb));
  }
  if (isStageEnabled(preset.effects?.amp)) {
    const a = preset.effects!.amp!;
    // Look up the amp model — defines curve algorithm, tone-stack crossover
    // frequencies, and presence-shelf frequency. Falls back to a default if
    // the modelId is missing or unknown (handled inside getAmpModel).
    const model = getAmpModel(a.modelId);
    nodes.ampPreGain = new Tone.Gain(dbToGain(a.preGainDb));
    // Bass split — lows bypass saturation, highs feed the drive chain.
    // 120 Hz crossover, gentle Butterworth Q. Phase isn't perfectly summed
    // (would need Linkwitz-Riley), but the resulting ~1 dB dip at crossover
    // is well below audible threshold.
    nodes.ampBassHpf = new Tone.Filter({ type: 'highpass', frequency: 120, Q: 0.7 });
    nodes.ampBassLpf = new Tone.Filter({ type: 'lowpass', frequency: 120, Q: 0.7 });
    // Saturator waveshapers. The curve function comes from the model —
    // Twin uses symmetric quadratic, Plexi uses asymmetric linear, AC30
    // uses arctan-compressed, etc. All curves are normalized so peaks ≈
    // unity at any drive value (compresses dynamics without bumping
    // headline level). 4× oversampling keeps aliasing harmonics out of
    // the audible band on both stages. setMap rebuilds the LUT when
    // drive or modelId changes (see applyAmp).
    // 2× oversample on both stages. Was 4× during the amp redesign which
    // sounded cleaner against aliasing artifacts but pushed the audio thread
    // into underrun territory on lower-end machines (audible as constant
    // crackling). 2× is the standard trade-off — modestly more high-end
    // aliasing in exchange for stable buffer fills.
    nodes.ampPreDist = new Tone.WaveShaper(model.curve(a.preDrive), 4096);
    nodes.ampPreDist.oversample = '2x';
    nodes.ampPowerDist = new Tone.WaveShaper(model.curve(a.powerDrive), 4096);
    nodes.ampPowerDist.oversample = '2x';
    nodes.ampBassMerge = new Tone.Gain(1);
    nodes.ampTone = new Tone.EQ3({
      low: a.bass,
      mid: a.mid,
      high: a.treble,
      // Crossover frequencies come from the model — Fender amps run wider
      // (bass shelf around 80 Hz, treble around 4.5 kHz), Marshalls narrower
      // (200/2.2k for the mid-forward voice).
      lowFrequency: model.toneStack.lowFrequency,
      highFrequency: model.toneStack.highFrequency,
    });
    nodes.ampPresence = new Tone.Filter({
      type: 'highshelf',
      // Presence shelf frequency also varies by model — Twin/AC30 sit higher
      // (4.5-5 kHz for air); Marshalls lower (~3 kHz for upper-mid snap).
      frequency: model.presence.frequency,
      gain: a.presence,
    });
    nodes.ampOutput = new Tone.Gain(dbToGain(a.outputDb));
  }
  if (isStageEnabled(preset.effects?.reverb)) {
    // Tone.JCReverb is algorithmic (Schroeder), naturally spring-like.
    // Cheap enough to run one per voice including at multi-track scale.
    nodes.voiceReverb = new Tone.JCReverb({
      roomSize: preset.effects.reverb.roomSize,
      wet: preset.effects.reverb.wet,
    });
  }
  if (isStageEnabled(preset.effects?.cabIR)) {
    // `normalize: false` applies the IR at its native level. Tone's default
    // normalize divides by the IR's RMS, which sounds drastically quieter
    // for cab IRs (which attenuate high-end). The IR packs we ship are
    // recorded for unnormalized use; per-IR variance is handled by the
    // separate `makeupDb` gain immediately after.
    nodes.cabIR = new Tone.Convolver({
      url: preset.effects.cabIR.url,
      normalize: false,
    });
    nodes.cabIRMakeup = new Tone.Gain(dbToGain(preset.effects.cabIR.makeupDb ?? 0));
  }
  if (isStageEnabled(preset.effects?.finalEq)) {
    nodes.finalEq = new Tone.EQ3({
      low: preset.effects.finalEq.low,
      mid: preset.effects.finalEq.mid,
      high: preset.effects.finalEq.high,
      lowFrequency: preset.effects.finalEq.lowFrequency,
      highFrequency: preset.effects.finalEq.highFrequency,
    });
  }
  // Pre-chain input gain — first stage after the mixer. Default 0 dB unity
  // when the preset doesn't specify it. Always present so the chain has a
  // consistent entry-point node we can attenuate at without rebuilding.
  nodes.inputGain = new Tone.Gain(dbToGain(preset.inputGainDb ?? 0));
  // Always present: volume + pan at the end of the chain.
  nodes.volume = new Tone.Volume(preset.level.volumeDb);
  nodes.panner = new Tone.Panner(preset.level.pan);
  // Input + output meters — parallel taps for clip detection in the lab UI.
  // Tone.Meter uses an internal AnalyserNode and adds negligible CPU. Always
  // built; consumers poll getValue() at their own cadence.
  nodes.inputMeter = new Tone.Meter();
  nodes.outputMeter = new Tone.Meter();
  return nodes;
}

/** Connect entry node → chain in fixed order. Returns the chain's exit node.
 *  `entry` is the mixer (which receives the primary synth + optional layer).
 *
 *  Chain order:
 *    entry (mixer)
 *      → bodyFilter → compressor                       (pre-pedalboard shaping)
 *      → distortion → chorus → delay → autoWah         (pedalboard stage)
 *      → graphicEq bands → graphicEqLevel              (pre-amp tone shaper)
 *      → ampPreGain → ampPreDist → ampTone
 *        → ampPowerDist → ampPresence → ampOutput      (amp stage)
 *      → voiceReverb                                   (spring/plate)
 *      → cabIR → cabIRMakeup                           (cab stage)
 *      → finalEq                                       (mastering EQ)
 *      → volume → panner                               (output) */
function wireChain(
  entry: Tone.ToneAudioNode,
  c: ChainNodes,
): Tone.ToneAudioNode {
  const order: Tone.ToneAudioNode[] = [entry];
  // Input gain — first stage after the mixer/synth entry, before anything
  // else processes the signal. Always present (default 0 dB unity).
  if (c.inputGain) order.push(c.inputGain);
  if (c.bodyFilter) order.push(c.bodyFilter);
  if (c.compressor) order.push(c.compressor);
  if (c.distortion) order.push(c.distortion);
  if (c.chorus) order.push(c.chorus);
  if (c.delay) order.push(c.delay);
  if (c.autoWah) order.push(c.autoWah);
  if (c.graphicEqBands) {
    for (const band of c.graphicEqBands) order.push(band);
  }
  if (c.graphicEqLevel) order.push(c.graphicEqLevel);
  if (c.ampPreGain) order.push(c.ampPreGain);
  // Amp stage uses a parallel bass-bypass topology that doesn't fit the
  // linear `order` chain. We flush the prefix up to ampPreGain, wire the
  // split-merge structure manually, then resume the linear chain at
  // ampTone with ampBassMerge as the new entry point.
  if (c.ampBassHpf && c.ampBassLpf && c.ampPreDist && c.ampPowerDist && c.ampBassMerge) {
    // Flush the linear prefix into the chain so ampPreGain is connected.
    for (let i = 0; i < order.length - 1; i++) {
      order[i].connect(order[i + 1]);
    }
    const splitIn = order[order.length - 1];
    // Driven branch: split → hpf → preDist → powerDist → merge
    splitIn.connect(c.ampBassHpf);
    c.ampBassHpf.connect(c.ampPreDist);
    c.ampPreDist.connect(c.ampPowerDist);
    c.ampPowerDist.connect(c.ampBassMerge);
    // Clean bass branch: split → lpf → merge
    splitIn.connect(c.ampBassLpf);
    c.ampBassLpf.connect(c.ampBassMerge);
    // Reset the order array — subsequent linear-chain entries pick up at
    // ampBassMerge.
    order.length = 0;
    order.push(c.ampBassMerge);
  }
  if (c.ampTone) order.push(c.ampTone);
  if (c.ampPresence) order.push(c.ampPresence);
  if (c.ampOutput) order.push(c.ampOutput);
  if (c.voiceReverb) order.push(c.voiceReverb);
  if (c.cabIR) order.push(c.cabIR);
  if (c.cabIRMakeup) order.push(c.cabIRMakeup);
  if (c.finalEq) order.push(c.finalEq);
  if (c.volume) order.push(c.volume);
  if (c.panner) order.push(c.panner);
  for (let i = 0; i < order.length - 1; i++) {
    order[i].connect(order[i + 1]);
  }
  // Parallel taps for the input + output level meters. These are sinks (no
  // downstream connection from the meter), so they don't affect the main
  // signal flow. Tap inputMeter on inputGain output (post user attenuation);
  // tap outputMeter on the final per-voice node before MasterBus.
  if (c.inputGain && c.inputMeter) c.inputGain.connect(c.inputMeter);
  if (order.length > 0 && c.outputMeter) order[order.length - 1].connect(c.outputMeter);
  return order[order.length - 1];
}

function disposeChain(c: ChainNodes): void {
  c.bodyFilterEnvelope?.dispose();
  c.bodyFilter?.dispose();
  c.compressor?.dispose();
  c.distortion?.dispose();
  c.chorus?.dispose();
  c.delay?.dispose();
  c.autoWah?.dispose();
  if (c.graphicEqBands) {
    for (const band of c.graphicEqBands) band.dispose();
  }
  c.graphicEqLevel?.dispose();
  c.ampPreGain?.dispose();
  c.ampBassHpf?.dispose();
  c.ampBassLpf?.dispose();
  c.ampPreDist?.dispose();
  c.ampPowerDist?.dispose();
  c.ampBassMerge?.dispose();
  c.ampTone?.dispose();
  c.ampPresence?.dispose();
  c.ampOutput?.dispose();
  c.voiceReverb?.dispose();
  c.cabIR?.dispose();
  c.cabIRMakeup?.dispose();
  c.finalEq?.dispose();
  c.inputGain?.dispose();
  c.inputMeter?.dispose();
  c.volume?.dispose();
  c.outputMeter?.dispose();
  c.panner?.dispose();
}

// ─── Apply helpers (in-place mutation) ─────────────────────────────────────────

function applyPluckSynth(node: Tone.PluckSynth, p: PluckSynthParams): void {
  node.attackNoise = p.attackNoise;
  node.dampening = p.dampening;
  node.resonance = p.resonance;
  node.release = p.release;
}

function applyFMSynth(node: Tone.FMSynth, p: FMSynthParams): void {
  node.harmonicity.value = p.harmonicity;
  node.modulationIndex.value = p.modulationIndex;
  node.detune.value = p.detune;
  setOscillatorType(node.oscillator as unknown as { type: string }, p.carrierWaveform);
  setOscillatorType(node.modulation as unknown as { type: string }, p.modulatorWaveform);
  applyEnvelope(node.envelope as unknown as { attack: number; decay: number; sustain: number; release: number }, p.envelope);
  applyEnvelope(node.modulationEnvelope as unknown as { attack: number; decay: number; sustain: number; release: number }, p.modulationEnvelope);
}

function setOscillatorType(osc: { type: string }, type: OscillatorType): void {
  osc.type = type;
}

function applyEnvelope(
  env: { attack: number; decay: number; sustain: number; release: number },
  p: ADSREnvelope,
): void {
  env.attack = p.attack;
  env.decay = p.decay;
  env.sustain = p.sustain;
  env.release = p.release;
}

function applyBodyFilter(node: Tone.Filter, p: BodyFilterParams): void {
  // When an envelope is driving the cutoff, the static cutoff is ignored — the
  // envelope sets the value at each trigger. Skip the static ramp in that case.
  if (!p.envelope) node.frequency.rampTo(p.cutoff, 0.02);
  node.Q.rampTo(p.q, 0.02);
}

function applyBodyFilterEnvelope(node: Tone.FrequencyEnvelope, p: BodyFilterEnvelope): void {
  node.attack = p.attack;
  node.decay = p.decay;
  node.sustain = p.sustain;
  node.release = p.release;
  node.baseFrequency = p.baseFrequency;
  node.octaves = p.octaves;
}

function applyAutoWah(node: Tone.AutoWah, p: AutoWahParams): void {
  node.baseFrequency = p.baseFrequency;
  node.octaves = p.octaves;
  node.sensitivity = p.sensitivity;
  node.Q.rampTo(p.q, 0.02);
  node.gain.rampTo(p.gain, 0.02);
  node.wet.rampTo(p.wet, 0.02);
}

/** Update all amp stage nodes in place. Caller has already verified that the
 *  amp config is still PRESENT (a present→absent transition triggers a chain
 *  rebuild via sameEffectsShape). When `modelId` changes (or when the drive
 *  values change), the curve function from the model is reapplied via
 *  WaveShaper.setMap. Tone-stack crossover frequencies + presence frequency
 *  also re-derive from the model on each call so changing models retunes
 *  those instantly. All gain / EQ params ramp to avoid clicks. */
function applyAmp(c: ChainNodes, p: AmpParams): void {
  const model = getAmpModel(p.modelId);
  if (c.ampPreGain) c.ampPreGain.gain.rampTo(dbToGain(p.preGainDb), 0.02);
  if (c.ampPreDist) c.ampPreDist.setMap(model.curve(p.preDrive), 4096);
  if (c.ampTone) {
    c.ampTone.low.rampTo(p.bass, 0.02);
    c.ampTone.mid.rampTo(p.mid, 0.02);
    c.ampTone.high.rampTo(p.treble, 0.02);
    // EQ3.lowFrequency + highFrequency are Tone.Signals (frequency type), so
    // they can ramp like the gain controls. Switching amp models retunes the
    // tone stack without a chain rebuild.
    c.ampTone.lowFrequency.rampTo(model.toneStack.lowFrequency, 0.02);
    c.ampTone.highFrequency.rampTo(model.toneStack.highFrequency, 0.02);
  }
  if (c.ampPowerDist) c.ampPowerDist.setMap(model.curve(p.powerDrive), 4096);
  if (c.ampPresence) {
    c.ampPresence.gain.rampTo(p.presence, 0.02);
    c.ampPresence.frequency.rampTo(model.presence.frequency, 0.02);
  }
  if (c.ampOutput) c.ampOutput.gain.rampTo(dbToGain(p.outputDb), 0.02);
}

function applyVoiceReverb(node: Tone.JCReverb, p: VoiceReverbParams): void {
  node.roomSize.rampTo(p.roomSize, 0.02);
  node.wet.rampTo(p.wet, 0.02);
}

/** Center frequencies for the 7-band graphic EQ, matching the Boss GE-7. */
const GRAPHIC_EQ_FREQS = [100, 200, 400, 800, 1600, 3200, 6400] as const;
const GRAPHIC_EQ_Q = 1.4;

function graphicEqBandValues(p: GraphicEqParams): readonly number[] {
  return [
    p.band100Hz,
    p.band200Hz,
    p.band400Hz,
    p.band800Hz,
    p.band1_6kHz,
    p.band3_2kHz,
    p.band6_4kHz,
  ];
}

function buildGraphicEqBands(p: GraphicEqParams): Tone.Filter[] {
  const values = graphicEqBandValues(p);
  return GRAPHIC_EQ_FREQS.map((freq, i) =>
    new Tone.Filter({
      type: 'peaking',
      frequency: freq,
      Q: GRAPHIC_EQ_Q,
      gain: values[i],
    }),
  );
}

/** Update the 7 band gains + level gain in place. Caller has already
 *  verified that graphicEq config is still present (a presence transition
 *  triggers a chain rebuild via sameEffectsShape). */
function applyGraphicEq(c: ChainNodes, p: GraphicEqParams): void {
  if (c.graphicEqBands) {
    const values = graphicEqBandValues(p);
    for (let i = 0; i < c.graphicEqBands.length; i++) {
      c.graphicEqBands[i].gain.rampTo(values[i], 0.02);
    }
  }
  if (c.graphicEqLevel) {
    c.graphicEqLevel.gain.rampTo(dbToGain(p.levelDb), 0.02);
  }
}

function applyCompressor(node: Tone.Compressor, p: CompressorParams): void {
  node.threshold.rampTo(p.threshold, 0.02);
  node.ratio.rampTo(p.ratio, 0.02);
  node.attack.rampTo(p.attack, 0.02);
  node.release.rampTo(p.release, 0.02);
  node.knee.rampTo(p.knee, 0.02);
}

function applyDistortion(node: Tone.Distortion, p: DistortionParams): void {
  node.distortion = p.drive;
  node.oversample = p.oversample;
  node.wet.rampTo(p.wet, 0.02);
}

function applyChorus(node: Tone.Chorus, p: ChorusParams): void {
  node.frequency.value = p.frequency;
  node.depth = p.depth;
  setChorusType(node, p.type);
  node.feedback.rampTo(p.feedback, 0.02);
  node.delayTime = p.delayTime * 1000; // ms
  node.spread = p.spread;
  node.wet.rampTo(p.wet, 0.02);
}

function setChorusType(node: Tone.Chorus, type: ChorusType): void {
  // Tone exposes the LFO type via `.type` on Chorus.
  (node as unknown as { type: string }).type = type;
}

function applyDelay(node: Tone.FeedbackDelay, p: DelayParams): void {
  node.delayTime.rampTo(p.delayTime, 0.02);
  node.feedback.rampTo(p.feedback, 0.02);
  node.wet.rampTo(p.wet, 0.02);
}

function applyEQ(node: Tone.EQ3, p: EQParams): void {
  node.low.rampTo(p.low, 0.02);
  node.mid.rampTo(p.mid, 0.02);
  node.high.rampTo(p.high, 0.02);
  node.lowFrequency.rampTo(p.lowFrequency, 0.02);
  node.highFrequency.rampTo(p.highFrequency, 0.02);
}

function sameEffectsShape(a: EffectsConfig | undefined, b: EffectsConfig | undefined): boolean {
  // Each stage's "shape" is whether it's actually present in the chain — i.e.
  // params exist AND enabled !== false. A toggle-off (enabled true → false)
  // must trigger a chain rebuild so the node is removed from the signal flow;
  // toggle-on rebuilds to re-insert it.
  return (
    isStageEnabled(a?.distortion) === isStageEnabled(b?.distortion) &&
    isStageEnabled(a?.chorus) === isStageEnabled(b?.chorus) &&
    isStageEnabled(a?.delay) === isStageEnabled(b?.delay) &&
    isStageEnabled(a?.autoWah) === isStageEnabled(b?.autoWah) &&
    isStageEnabled(a?.graphicEq) === isStageEnabled(b?.graphicEq) &&
    isStageEnabled(a?.amp) === isStageEnabled(b?.amp) &&
    isStageEnabled(a?.reverb) === isStageEnabled(b?.reverb) &&
    isStageEnabled(a?.cabIR) === isStageEnabled(b?.cabIR) &&
    isStageEnabled(a?.finalEq) === isStageEnabled(b?.finalEq) &&
    // URL change also requires a rebuild — Tone.Convolver loads its IR in
    // the constructor and doesn't support swapping URLs in place. Makeup
    // gain changes go through the in-place path below.
    a?.cabIR?.url === b?.cabIR?.url
  );
}

function extractSynthParams(source: VoiceSource): PluckSynthParams | FMSynthParams {
  if (source.kind === 'pluck-synth') return source.params;
  if (source.kind === 'fm-synth') return source.params;
  return { attackNoise: 0.5, dampening: 4000, resonance: 0.85, release: 0.5 };
}

function updatePresetSynthParams(
  preset: VoicePreset,
  params: PluckSynthParams | FMSynthParams,
): VoicePreset {
  if (preset.source.kind === 'pluck-synth') {
    return { ...preset, source: { kind: 'pluck-synth', params: params as PluckSynthParams } };
  }
  if (preset.source.kind === 'fm-synth') {
    return { ...preset, source: { kind: 'fm-synth', params: params as FMSynthParams } };
  }
  return preset;
}
