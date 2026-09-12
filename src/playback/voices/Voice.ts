/**
 * Voice — a configurable `GuitarInstrument` built from a `VoicePreset`.
 *
 * Signal chain — the real order, verified against `wireChain` below:
 *
 *   synth ─► inputGain ─► [bodyFilter] ─► [compressor] ─► [distortion] ─►
 *            [chorus] ─► [delay] ─► [autoWah] ─► [graphicEq…] ─► [ampPreGain]
 *                │
 *                ├─ [ampBassHpf] ─► [ampPreDist] ─► [ampPowerDist] ─┐
 *                └─ [ampBassLpf] ────────────────────────────────────┤
 *                                                    [ampBassMerge] ◄┘
 *                       ─► [ampTone] ─► [ampPresence] ─► [ampOutput] ─►
 *   [voiceReverb] ─► [cabIR] ─► [cabIRMakeup] ─► [finalEq] ─► volume ─► pan ─► output
 *
 * **The tone stack is AFTER both saturators, not between them.** Four comments
 * in this repo said otherwise until AF-01; the wiring has always been the above.
 * The amp's bass split is a parallel branch — lows bypass the saturators and
 * rejoin at `ampBassMerge`, which is a plain `Tone.Gain(1)` and therefore does
 * not compensate for summing two branches (AF-02's problem).
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
 *
 * Samples: every `Tone.Sampler` and the cabinet `Convolver` here are built
 * EMPTY and filled from `sample-store`, because the store is async and
 * `_ensureBuilt` is not. That has consequences a reader has to know about
 * before touching anything below — they are written up at "Sample fills",
 * immediately above the class.
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
import { loadAudioBuffer } from './sample-store';
import { getAmpModel } from './amp-models';
import { getCircuitAmp } from './circuit-amp/registry';
import {
  applyCircuitAmpLite,
  buildCircuitAmpLite,
  disposeCircuitAmpLite,
  type CircuitAmpLiteNodes,
} from './circuit-amp/lite-renderer';

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
import { sourceTrimDb } from './levels';
import { createPeakMeter, readPeakDb } from './peak-meter';
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
  /** The experimental circuit amp — a self-contained sub-graph with its own
   *  entry and exit. Built INSTEAD of every `amp*` node above when
   *  `effects.circuitAmp` is present and enabled: a signal chain has one amp,
   *  and letting both run would be a bug that sounds like a feature.
   *
   *  Its nodes live inside rather than beside these, because a circuit's node
   *  list is a property of the circuit and differs per amp — a Champ has no
   *  phase splitter, a Deluxe has tremolo. See `circuit-amp/types.ts`. */
  circuitAmp?: CircuitAmpLiteNodes;
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
  inputMeter?: Tone.Analyser;
  volume?: Tone.Volume;
  panner?: Tone.Panner;
  /** Tap on the panner output — measures the per-voice signal right before
   *  it hits MasterBus. Catches clipping introduced by the saturators / cab
   *  IR / makeup gain / Voice Level. */
  outputMeter?: Tone.Analyser;
  /** Tap on the ampPreGain output — what the saturators are actually being
   *  fed, which neither of the other two taps can see.
   *
   *  They BRACKET this point: inputMeter sits ahead of preGainDb, the graphic
   *  EQ trim and the whole pedalboard, and outputMeter sits behind the amp,
   *  the cab and the final EQ. And because each curve is normalised at its
   *  endpoint, a saturator hands back an ordinary-looking level however hard
   *  it was hit — so the stage is invisible from both sides. This is the tap
   *  that says whether the drive is being overloaded while the other two look
   *  reasonable. */
  driveMeter?: Tone.Analyser;
  /** Tap on the circuit amp's OUTPUT.
   *
   *  None of the three taps above can see the amp alone: `inputMeter` sits
   *  ahead of the whole pedalboard, `driveMeter` sits in front of the amp, and
   *  `outputMeter` sits on the panner with the cab, the final EQ and the voice
   *  volume already applied.
   *
   *  This is also how a circuit amp reports what it did to level.
   *  `gain-structure.ts` is arithmetic over a preset and a circuit amp's gain
   *  is a product of several stages that moves with playing strength once the
   *  supply sags, so there is no number to derive. Measured instead: the
   *  difference between `driveMeter` and this. */
  circuitAmpMeter?: Tone.Analyser;
}

type SynthNode = Tone.PluckSynth | Tone.FMSynth | Tone.Sampler;

// ─── Sample fills ───────────────────────────────────────────────────────────
//
// `_ensureBuilt` is SYNCHRONOUS and `sample-store` is not, so every
// `Tone.Sampler` below is constructed EMPTY — `urls: {}`, which Tone skips
// without throwing — and filled with `add()` as buffers arrive. The cabinet
// `Convolver` is built with no `url` and gets its `.buffer` the same way.
//
// That is what buys the store, and therefore "a sample file is fetched once,
// ever". It costs three things, and each one is paid for explicitly here
// because none of them fails loudly:
//
//  1. `Tone.loaded()` stops being true by accident. It drains
//     `ToneAudioBuffer.downloads` and nothing else, and a buffer handed to
//     `Sampler.add()` already decoded never lands there. Nothing on the
//     playback path awaits `Voice.ready()` — `MultiTrackPlayback` and
//     `EventScheduler` call `ensureBuilt()`, and `Metronome.start()` awaits the
//     `onBeforeStart` warms and then `Tone.loaded()`. So `registerDownload` is
//     the thing that keeps the transport from starting against empty samplers.
//     It holds it for at most `SAMPLE_FILL_GATE_MS`, because an unbounded gate
//     against a rate-limiting origin is a Play button that does nothing for a
//     minute and a half.
//  2. An empty Sampler does not fall silent, it REPITCHES. `_findClosest`
//     searches ±96 semitones, so mid-fill an E2 triggered against a lone
//     resident C6 plays at eight octaves of rate — loud, wrong, nothing thrown.
//     `canSound` is what keeps that window silent, which is what a sample the
//     origin refused sounded like before this change. The window is not always
//     a window: a file that never arrives leaves the guard on for good, which
//     is deliberate — silence for one pitch is what that always sounded like.
//  3. A fill outlives the synchronous build that started it, so it can land on
//     a node that has since been disposed. `Sampler.add` on a disposed instance
//     does NOT throw: it decodes quietly into a cleared map and pins the PCM
//     alive. Hence the generation guards, `Voice._guard`.

/** What has actually landed in one Sampler. */
interface SamplerFill {
  /** The notes the bank NAMES — what this Sampler holds once filled. */
  readonly mapped: readonly string[];
  /** `mapped` as MIDI numbers, resolved ONCE here rather than per trigger.
   *  `canSound` runs on the scheduler's lookahead path and `Tone.Frequency`
   *  allocates an object per call; a 45-note bank across four banks was ~180
   *  of them per scheduled note. Keys Tone cannot read as a pitch are dropped,
   *  exactly as the old per-trigger scan skipped them. */
  readonly mappedMidi: readonly number[];
  /** The notes whose buffer has arrived and been added. */
  readonly resident: Set<string>;
  /** `resident` as MIDI numbers — same reason as `mappedMidi`. */
  readonly residentMidi: Set<number>;
}

/** A fill is finished when every note it named is resident. Deliberately NOT a
 *  "the promise settled" flag: a load that FAILED settles too, and a bank that
 *  settled holding one file out of forty-five is precisely the case the guard
 *  below has to keep catching — under the 429 storm this work exists to end,
 *  waving it through repitches every pitch off that one file, for the life of
 *  the voice. The steady state is this one comparison. */
function fillFinished(fill: SamplerFill): boolean {
  return fill.resident.size === fill.mapped.length;
}

/** Keyed on the Sampler rather than held on the Voice, because `buildSynth` is
 *  a free function and the layer path builds one too. Weak so a disposed
 *  Sampler's bookkeeping goes with it. */
const samplerFills = new WeakMap<Tone.Sampler, SamplerFill>();

/**
 * Fill an empty Sampler from the sample store, and make `Tone.loaded()` wait.
 *
 * `isCurrent` is the generation guard — see note 3 above.
 */
function fillSampler(
  sampler: Tone.Sampler,
  urls: Readonly<Record<string, string>>,
  isCurrent: () => boolean,
): void {
  const mapped = Object.keys(urls);
  const mappedMidi: number[] = [];
  for (const note of mapped) {
    const midi = noteToMidi(note);
    if (midi !== null) mappedMidi.push(midi);
  }
  const fill: SamplerFill = {
    mapped,
    mappedMidi,
    resident: new Set<string>(),
    residentMidi: new Set<number>(),
  };
  samplerFills.set(sampler, fill);
  if (mapped.length === 0) return;

  // `allSettled`, not `all`: one rejected load must not abandon the notes that
  // would otherwise have landed, and the gate below is only honest if this
  // settles when the LAST load does rather than when the first one fails.
  const work = Promise.allSettled(
    mapped.map(async (note) => {
      const buffer = await loadAudioBuffer(urls[note]);
      // Checked after the await, so an abandoned fill still FETCHES and DECODES
      // everything it asked for and throws the result away — every load was
      // issued synchronously above, before anything could be disposed. A cost,
      // not a defect: the hazard the guard exists for is the decoded PCM being
      // pinned alive inside a disposed Sampler, and that is closed. Skipping the
      // work itself needs cancellation in the store, which it does not have.
      if (!isCurrent()) return;
      // An empty buffer is what the store resolves to when a load failed. Added,
      // it becomes the NEAREST sample for its neighbours and silences them too;
      // left out, the neighbours cover for it exactly as they cover a pitch the
      // pack never sampled.
      if (!buffer.loaded) return;
      try {
        // `add` types its key as `Note | MidiNote`, both string/number literal
        // unions; a bank's keys are plain strings and Tone validates them at
        // runtime anyway (hence the catch).
        sampler.add(note as Tone.Unit.Note, buffer);
      } catch (err) {
        // `add` asserts the key is a note or a midi number, and a pack with a bad
        // key would otherwise fail here with nothing said. `allSettled` above
        // means the rest of the bank lands either way; this is the report.
        console.warn(`[fretwork] sampler rejected note ${note}`, err);
        return;
      }
      fill.resident.add(note);
      const midi = noteToMidi(note);
      if (midi !== null) fill.residentMidi.add(midi);
    }),
  ).then(() => undefined);

  registerDownload(work);
}

/**
 * How long a fill may hold `Tone.loaded()` before the transport is allowed to
 * start without it.
 *
 * A gate with no deadline is a frozen Play button. The store retries a refused
 * URL four times with backoff (~3.5 s of sleeping) inside a six-wide pool, so a
 * cold 144-file pack against a rate-limiting origin holds `Metronome.start()`
 * for over a minute — and it holds it AFTER `_isRunning = true`, with nothing in
 * the console. Browsing three packs in the voice editor stacks their abandoned
 * fills on the same gate.
 *
 * Giving up is safe in a way that waiting forever is not: `canSound` guarantees
 * a note whose sample has not landed is SKIPPED, so an expired gate degrades to
 * a silent first bar — what a refused sample sounded like before this change —
 * rather than to garbage. The fill keeps running and the notes come in behind it.
 *
 * Generous on purpose: a legitimate cold pack over a slow connection is ~13 MB
 * and must not be cut off, because waiting is the better outcome whenever the
 * loads are actually progressing.
 */
export const SAMPLE_FILL_GATE_MS = 20_000;

const warnedOnce = new Set<string>();
/** One warning per process per cause. Both of these fire on paths that are
 *  otherwise entirely silent, and a silent gate failure is indistinguishable
 *  from a slow network. */
function warnOnce(key: string, message: string): void {
  if (warnedOnce.has(key)) return;
  warnedOnce.add(key);
  console.warn(message);
}

/** `work`, bounded by `SAMPLE_FILL_GATE_MS` and incapable of rejecting. */
function gated(work: Promise<void>): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      warnOnce(
        'gate',
        `[fretwork] samples still loading after ${SAMPLE_FILL_GATE_MS} ms — ` +
          'starting without them; notes with no sample yet are skipped, not repitched',
      );
      resolve();
    }, SAMPLE_FILL_GATE_MS);
    // Under Node a pending timer keeps the process alive, and a test that
    // deliberately leaves a fill outstanding would hold the runner open for the
    // whole gate. No-op in a browser, where `setTimeout` returns a number.
    (timer as unknown as { unref?: () => void }).unref?.();
    const settle = () => {
      clearTimeout(timer);
      resolve();
    };
    void work.then(settle, settle);
  });
}

/**
 * Make `Tone.loaded()` wait for `work`.
 *
 * A deliberate mutation of a Tone global, and it is what keeps every existing
 * await honest without changing an interface. Two rules, both taken from Tone's
 * own `ToneAudioBuffer.load` (`ToneAudioBuffer.js:95-108`):
 *
 *  - it MUST splice itself out in a `finally`. `loaded()` drains with
 *    `while (downloads.length) yield downloads[0]`, so a promise that never
 *    leaves the array makes it spin forever.
 *  - it MUST NOT reject. `Metronome.start()` awaits `Tone.loaded()` AFTER
 *    setting itself running, so a rejection throws inside a started transport.
 *
 * Both are `gated`'s job. Note the TYPE here: `downloads` is a declared Tone
 * static (`ToneAudioBuffer.d.ts:142`), so this must be a plain read and not a
 * cast — a cast would let a rename upstream turn the one load-bearing mechanism
 * in this file into a silent no-op with the build still green. The runtime
 * guard stays for mocked-Tone tests, and says so out loud.
 */
function registerDownload(work: Promise<void>): void {
  const downloads: Promise<void>[] | undefined = Tone.ToneAudioBuffer?.downloads;
  if (!Array.isArray(downloads)) {
    warnOnce(
      'downloads',
      '[fretwork] Tone.ToneAudioBuffer.downloads is missing — sample fills cannot ' +
        'hold Tone.loaded(), so playback may start before samples land',
    );
    return;
  }
  const tracked = gated(work);
  downloads.push(tracked);
  void tracked.finally(() => {
    const at = downloads.indexOf(tracked);
    if (at >= 0) downloads.splice(at, 1);
  });
}

/** MIDI number for a Sampler key or a requested note. Bank keys are note names
 *  ("A3") or MIDI numbers as strings — `Tone.Sampler` accepts both, and the
 *  packs use both. `null` when it is neither. */
function noteToMidi(note: string): number | null {
  const asMidi = Number(note);
  if (note !== '' && Number.isFinite(asMidi)) return asMidi;
  try {
    return Tone.Frequency(note).toMidi();
  } catch {
    return null;
  }
}

/**
 * Whether this synth can sound `noteName` the way a FILLED one would.
 *
 * The test is "has the sample a finished Sampler would have reached for actually
 * landed" — anything further away is a bigger repitch than this voice would ever
 * make once loaded, which is note 2's octaves-out garbage. Skipping the trigger
 * leaves silence instead, which is what a refused sample sounded like before
 * this change.
 *
 * False while a fill is outstanding, and false FOR GOOD for a pitch whose file
 * never arrives. That second case is the one to resist making go away: a bank
 * that finished holding one file out of forty-five has "finished" in the sense
 * that nothing is outstanding, and playing every pitch off that one file is the
 * failure this exists to prevent, not the recovery from it.
 */
function canSound(synth: SynthNode, noteName: string): boolean {
  if (!(synth instanceof Tone.Sampler)) return true;
  const fill = samplerFills.get(synth);
  if (!fill) return true;
  // The steady state, and the only cost a fully loaded voice pays. Also covers
  // the empty bank, which names nothing and therefore holds everything it said
  // it would — `buildSynth` sends those to a PluckSynth anyway.
  if (fillFinished(fill)) return true;
  if (fill.resident.size === 0) return false;
  const midi = noteToMidi(noteName);
  if (midi === null) return true;
  // Two integer scans over numbers parsed at fill time. It runs for as long as
  // a note is missing — which is for good, if its file never arrives — and that
  // is the point: a permanently absent sample must go on being silence rather
  // than becoming a four-octave repitch off whatever did land.
  let nearestMapped = Infinity;
  for (const mappedMidi of fill.mappedMidi) {
    const distance = Math.abs(mappedMidi - midi);
    if (distance < nearestMapped) nearestMapped = distance;
  }
  let nearestResident = Infinity;
  for (const residentMidi of fill.residentMidi) {
    const distance = Math.abs(residentMidi - midi);
    if (distance < nearestResident) nearestResident = distance;
  }
  return nearestResident <= nearestMapped;
}

/** Whether this synth holds `noteName`'s OWN sample — the picker's question,
 *  which is narrower than `canSound`'s and answerable in O(1). Only called for
 *  a note the bank's URL map names, so "mapped but not yet landed" is exactly
 *  the false case. */
function hasResidentSample(synth: SynthNode, noteName: string): boolean {
  if (!(synth instanceof Tone.Sampler)) return true;
  const fill = samplerFills.get(synth);
  if (!fill) return true;
  return fill.resident.has(noteName);
}

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
  /** Source calibration trim (AF-03) — brings the primary source down to the
   *  reference level before anything else sees it. Its own node, not folded into
   *  `_mixer`, because the layer feeds the mixer too and calibrates separately.
   *  See `levels.ts`. */
  private _sourceTrim: Tone.Gain | null = null;
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
  /** Monotonic build counters — one per group of nodes that is disposed
   *  independently. A sample fill outlives the synchronous build that started
   *  it, so every `add()` and every `.buffer =` is gated on the counter its
   *  build ran under, and a fill whose target has been torn down stops there.
   *
   *  THREE rather than one, and that is not tidiness. A single counter
   *  over-aborts: `updateEffects` rebuilding the chain would cancel the primary
   *  sampler's fill even though the samplers survive a chain rebuild, leaving a
   *  live voice permanently half-loaded — silent notes, the exact failure this
   *  work exists to end. `source` is bumped by `dispose()`, `layer` by
   *  `_disposeLayer()`, `chain` by `_rebuildChain()` and `dispose()`. */
  private _generations = { source: 0, layer: 0, chain: 0 };

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
   *  routing during composition setup) should call this explicitly so the
   *  sample fills start immediately instead of waiting for the first
   *  triggerAttackRelease.
   *
   *  It returns as soon as the graph EXISTS; the samplers are built empty and
   *  fill behind it. A note triggered inside that window is SKIPPED rather than
   *  repitched from whatever landed first — see `canSound` — so the cost of not
   *  waiting is a dropped note, not a wrong one. Anything that does want to
   *  wait can: the fills gate `Tone.loaded()`, for up to `SAMPLE_FILL_GATE_MS`. */
  ensureBuilt(): void {
    this._ensureBuilt();
  }

  /**
   * Build the graph and resolve once this voice can actually make a sound.
   *
   * `ensureBuilt()` only *starts* the fills: the samplers are constructed empty and
   * each buffer is `add()`ed as `sample-store` resolves it. This awaits them.
   *
   * **This is not what gates playback, and it never was.** Its only two callers are
   * editor auditions in the app's `playbackService`, which run outside the transport
   * and so have no gate of their own. The playback path calls `ensureBuilt()`
   * (`MultiTrackPlayback`, `EventScheduler`) and is held by `Metronome.start()`
   * awaiting every `onBeforeStart` warm and then `Tone.loaded()`. That await is the
   * whole "no silent first bar" mechanism, and it still covers the fills only because
   * each one is registered on `ToneAudioBuffer.downloads` — the one thing
   * `Tone.loaded()` drains. See `registerDownload`; do not remove it on the grounds
   * that `ready()` exists.
   *
   * Two caveats, and neither is a defect to be fixed here:
   *
   * `Tone.loaded()` is global. It resolves when *every* pending buffer is decoded,
   * not only this voice's, so a second voice loading concurrently will delay it.
   * That is the same guarantee `Metronome.start()` relies on, and Tone exposes no
   * per-instrument equivalent.
   *
   * And it is BOUNDED. A fill releases the gate after `SAMPLE_FILL_GATE_MS` whether
   * or not it landed, so this resolving does not prove the samples arrived — only
   * that they stopped being worth waiting for. What it does still promise is that
   * nothing plays wrong: a note with no sample resident is skipped (`canSound`).
   */
  async ready(): Promise<void> {
    this._ensureBuilt();
    await Tone.loaded();
  }

  /** A guard for fills queued against nodes built now — false once whatever
   *  built them has been disposed. */
  private _guard(target: 'source' | 'layer' | 'chain'): () => boolean {
    const builtAt = this._generations[target];
    return () => this._generations[target] === builtAt;
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
      const sourceGuard = this._guard('source');
      this._samplerBanks = nonEmpty.map((urls) => {
        // Built EMPTY and filled from the store — see "Sample fills". The URL
        // map still goes on `_samplerBankUrls` for the picker, but it is now a
        // statement of what this bank WILL hold, which is why `_pickBankFor`
        // also checks what has actually landed.
        const sampler = new Tone.Sampler({
          urls: {},
          release: samplerSrc.release ?? 1,
          // 5 ms fade-in envelope on every trigger. Smooths the BufferSource
          // start so any noise-floor wobble or mp3 encoder-delay edge in the
          // first samples of the decoded buffer doesn't produce an audible
          // click. 5 ms is below the perceptual threshold for "soft attack" —
          // real guitar pluck attacks are 5-20 ms anyway.
          attack: 0.005,
        });
        fillSampler(sampler, urls, sourceGuard);
        return sampler;
      });
      this._synth = this._samplerBanks[0];
      this._mixer = new Tone.Gain(1);
      // Source calibration (AF-03) — see `levels.ts`. The trim goes on a node of
      // its own between the source and the mixer rather than on the mixer,
      // because the LAYER also feeds the mixer and may be a different source
      // kind: a synth layer under a sampled primary must not inherit the sample
      // packs' mastering trim. The layer carries its own, folded into
      // `_layerGain` in `_buildLayer`.
      this._sourceTrim = new Tone.Gain(dbToGain(sourceTrimDb(src)));
      for (const bank of this._samplerBanks) bank.connect(this._sourceTrim);
      this._sourceTrim.connect(this._mixer);
    } else {
      // Single-synth path: pluck-synth, fm-synth, or sampler with all-empty
      // banks (falls back to a neutral PluckSynth inside `buildSynth`).
      this._synth = buildSynth(src, this._guard('source'));
      this._samplerBanks = null;
      this._samplerBankUrls = null;
      this._mixer = new Tone.Gain(1);
      this._sourceTrim = new Tone.Gain(dbToGain(sourceTrimDb(src)));
      this._synth.connect(this._sourceTrim);
      this._sourceTrim.connect(this._mixer);
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
    this._chain = buildChain(this._preset, this._guard('chain'));
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
    this._layerSynth = buildSynth(layer.source, this._guard('layer'));
    applyLayerDetune(this._layerSynth, layer.detuneCents);
    // The layer's own source calibration, folded in rather than given a node —
    // `gainDb` is a MIX level relative to the primary and the trim is a fact
    // about the layer's own source, so they add. Two gains at one point would be
    // two things to get wrong for one job.
    this._layerGain = new Tone.Gain(dbToGain(layer.gainDb + sourceTrimDb(layer.source)));
    this._layerSynth.connect(this._layerGain);
    this._layerGain.connect(this._mixer);
  }

  private _disposeLayer(): void {
    // A layer sampler's fill is still in flight; the Sampler it was filling is
    // about to be a disposed instance. Only the LAYER counter moves — the
    // primary's fill is untouched by a layer change.
    this._generations.layer++;
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
    // Mid-fill this bank may hold nothing near this pitch yet. Dropping the note
    // is right: an empty Sampler repitches from whatever landed first rather
    // than falling silent, and silence is what this sounded like before the
    // store. Not counted by `noteTriggered` below either — nothing is playing.
    if (!canSound(synth, noteName)) return;
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
        // Guarded separately, and not only for the layer's own sake: an unfilled
        // sampler layer THROWS out of `triggerAttackRelease`, and the catch at
        // the end of this block would then swallow palm-mute, the pitch curve
        // and vibrato for a note whose primary sounded fine.
        if (canSound(this._layerSynth, layerNote)) {
          this._layerSynth.triggerAttackRelease(layerNote, duration, audioTime, velocity);
        }
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
    // Before anything is torn down: every node below is about to become a
    // dangling target for a fill still in flight. `Sampler.add` on a disposed
    // instance does not throw — it decodes into a cleared map and pins ~100 MB
    // of PCM alive — so the counters move FIRST.
    this._generations.source++;
    this._generations.layer++;
    this._generations.chain++;
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
    this._sourceTrim?.dispose();
    this._mixer?.dispose();
    this._vibrato?.dispose();
    this._pitchShift?.dispose();
    this._palmMuteFilter?.dispose();
    disposeChain(this._chain);
    this._synth = null;
    this._sourceTrim = null;
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
    return readPeakDb(this._chain.inputMeter);
  }

  /** Current peak level (dBFS) at the output tap — the per-voice signal as it
   *  hits MasterBus. Returns `-Infinity` if the chain isn't built yet. */
  getOutputLevelDb(): number {
    return readPeakDb(this._chain.outputMeter);
  }

  /** Current peak level (dBFS) at the amp's drive tap — after `preGainDb`,
   *  the graphic EQ and the pedals, immediately before the bass split and the
   *  saturators. Returns `-Infinity` when the chain isn't built or the preset
   *  has no amp stage, which is the same reading as silence on purpose: there
   *  is no drive stage to report on either way.
   *
   *  **Expect this to read HIGHER than both other taps on the gain presets**,
   *  and expect the output tap not to move much when it does. That is the
   *  endpoint normalisation being visible for the first time, not a fault in
   *  the tap. */
  getDriveLevelDb(): number {
    return readPeakDb(this._chain.driveMeter);
  }

  /** Sample peak at the CIRCUIT amp's output, in dBFS. `-Infinity` when this
   *  voice has no circuit amp, which reads the same as silence on purpose:
   *  there is no amp to report on either way.
   *
   *  Subtract {@link getDriveLevelDb} from this and you have what the amp did
   *  to the level. For a circuit amp that subtraction is the ONLY way to get
   *  the figure — `describeGainStructure` reads gain nodes and probes shaper
   *  curves, and a circuit's gain is a product of several stages that moves
   *  with playing strength once the supply sags. Measured, not derived. */
  getCircuitAmpLevelDb(): number {
    return readPeakDb(this._chain.circuitAmpMeter);
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
    // Without this a circuit amp's knobs are stored on the preset and reach
    // nothing: the stage was wired into `buildChain` and never into the update
    // path, so every retune was silent and only a source change -- which
    // rebuilds the whole graph -- ever moved it.
    if (next?.circuitAmp && this._chain.circuitAmp) {
      applyCircuitAmpLite(
        this._chain.circuitAmp,
        next.circuitAmp,
        getCircuitAmp(next.circuitAmp.ampId),
      );
    }
    if (next?.reverb && this._chain.voiceReverb) applyVoiceReverb(this._chain.voiceReverb, next.reverb);
    if (next?.cabIR && this._chain.cabIRMakeup) {
      this._chain.cabIRMakeup.gain.rampTo(dbToGain(next.cabIR.makeupDb ?? 0), 0.02);
    }
    if (next?.finalEq && this._chain.finalEq) applyEQ(this._chain.finalEq, next.finalEq);
  }

  /** Replace the active preset entirely. Same source kind reuses the synth. */
  swapPreset(next: VoicePreset): void {
    // A change to the SOURCE cannot be applied in place: the synth (or the set of
    // Tone.Samplers) is constructed once in `_ensureBuilt` and everything below only
    // retunes existing nodes. So tear the graph down and rebuild it.
    //
    // `dispose()` leaves this instance reusable — it nulls every node and empties the
    // chain, and `_ensureBuilt` reconnects to NotesBus (or the custom routing target)
    // on the way back up. Rebuilding eagerly, rather than waiting for the next
    // `play()`, so a sampler starts fetching immediately instead of dropping the first
    // note; `_ensureBuilt` is idempotent, so play() is still safe.
    //
    // Only rebuild if it was already built: an untouched voice has nothing to tear
    // down, and building here would construct an audio graph for a voice that has
    // never made a sound.
    if (!sameSource(this._preset.source, next.source)) {
      const wasBuilt = this._synth !== null;
      this.dispose();
      this._preset = next;
      if (wasBuilt) this._ensureBuilt();
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
   *  requested pitch AND has actually received that sample (Tone.Sampler
   *  pitch-shifts inside a bank when the exact note is missing — distant shifts
   *  sound wrong, so we keep rotation within the "exact match" pool). Falls back
   *  to the full bank pool if no bank has the pitch (uniform pitch-shift across
   *  all banks then), and `play()` decides whether that fallback can sound.
   *
   *  The residency half matters only mid-fill, and it matters: `_samplerBankUrls`
   *  says what a bank will hold once its fill finishes, so trusting it alone
   *  routes the note to a bank holding nothing while a sibling already has the
   *  sample. */
  private _pickBankFor(noteName: string): SynthNode {
    if (!this._samplerBanks || !this._samplerBankUrls) return this._synth!;
    const banks = this._samplerBanks;
    const urlMaps = this._samplerBankUrls;
    let pool: number[] = [];
    for (let i = 0; i < urlMaps.length; i++) {
      if (urlMaps[i][noteName] !== undefined && hasResidentSample(banks[i], noteName)) pool.push(i);
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
    // A cab IR still resolving was started against the chain being disposed
    // here; without this it would land on the Convolver built below.
    this._generations.chain++;
    disposeChain(this._chain);
    this._mixer.connect(this._vibrato);
    this._vibrato.connect(this._pitchShift);
    this._pitchShift.connect(this._palmMuteFilter);
    // Re-arms the cab IR fill under the new generation. It has to be re-armed
    // rather than reused: `buildChain` is where the fill is registered on
    // `ToneAudioBuffer.downloads`, so skipping it would let `Tone.loaded()`
    // resolve early after a retune.
    this._chain = buildChain(this._preset, this._guard('chain'));
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

/** `guard` gates the sample fill when this builds a Sampler — see
 *  "Sample fills". Required rather than optional so a new call site cannot
 *  quietly get an unguarded fill. */
function buildSynth(source: VoiceSource, guard: () => boolean): SynthNode {
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
  // Empty, then filled from the store. Reached by the single-bank primary path
  // AND by `_buildLayer`, so a sampler LAYER fills the same way.
  const sampler = new Tone.Sampler({
    urls: {},
    release: source.release ?? 1,
    attack: 0.005,
  });
  fillSampler(sampler, bank0, guard);
  return sampler;
}


/** `guard` gates the cabinet IR's fill — see "Sample fills". */
function buildChain(preset: VoicePreset, guard: () => boolean): ChainNodes {
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
  // One amp or the other. The circuit amp takes the amp's slot when it is
  // present and enabled, and the classic stage is not built at all.
  const circuitAmpParams = preset.effects?.circuitAmp;
  const useCircuitAmp = isStageEnabled(circuitAmpParams);
  if (useCircuitAmp && circuitAmpParams) {
    nodes.circuitAmp = buildCircuitAmpLite(
      circuitAmpParams,
      getCircuitAmp(circuitAmpParams.ampId),
    );
    nodes.circuitAmpMeter = createPeakMeter();
  }
  if (!useCircuitAmp && isStageEnabled(preset.effects?.amp)) {
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
    // uses arctan-compressed, etc.
    //
    // These curves are normalized AT THE ENDPOINT ONLY, which is not what this
    // comment claimed until AF-01: "peaks ≈ unity … without bumping headline
    // level" is true of a signal already at full scale and false of everything
    // below it. The slope at the origin is `k / tanh(k)` — +22.8 dB on Metal's
    // pre-stage, where a -12 dBFS input comes out at 0.998. These are gain
    // stages. `describeGainStructure` in `gain-structure.ts` prints the table,
    // and `driveMeter` below measures what they are actually fed. AF-02
    // reshapes them; do not "fix" the level anywhere else in the meantime.
    //
    // setMap rebuilds the LUT when drive or modelId changes (see applyAmp).
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
    // Built with NO url; the buffer is assigned when the store resolves it.
    // `Convolver`'s `url` is genuinely optional and its `buffer` setter is real
    // (`Convolver.js:70-85`).
    //
    // `normalize: false` applies the IR at its native level. Tone's default
    // normalize divides by the IR's RMS, which sounds drastically quieter
    // for cab IRs (which attenuate high-end). The IR packs we ship are
    // recorded for unnormalized use; per-IR variance is handled by the
    // separate `makeupDb` gain immediately after.
    //
    // Keep the buffer assignment below a FIRST assignment. The setter recreates the native
    // ConvolverNode when a buffer is already present and does not re-apply
    // `normalize`, so swapping an IR in place would silently switch
    // normalisation back on. An IR change rebuilds the chain instead
    // (`sameEffectsShape` compares `cabIR.url`).
    const cabIR = new Tone.Convolver({ normalize: false });
    nodes.cabIR = cabIR;
    const cabIRUrl = preset.effects.cabIR.url;
    // Checked BEFORE the load starts as well as after it lands, so a caller
    // holding a guard that is already false never reaches the network at all —
    // see `buildChainNodesForTest`.
    if (guard()) {
      registerDownload(
        loadAudioBuffer(cabIRUrl).then((buffer) => {
          // A slow IR easily outlives the chain it was started for.
          if (!guard()) return;
          // The store resolves to an empty buffer on failure, and assigning one
          // hands the ConvolverNode a null buffer — the cab stage then passes
          // nothing at all rather than passing the signal through undarkened.
          if (!buffer.loaded) return;
          cabIR.buffer = buffer;
        }),
      );
    }
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
  // Input + output taps. SAMPLE PEAK, not RMS — see `peak-meter.ts` for why
  // that distinction cost a day of diagnosis, and for why it is sample peak
  // rather than true peak. Always built; consumers poll at their own cadence
  // and do their own peak-holding.
  nodes.inputMeter = createPeakMeter();
  nodes.outputMeter = createPeakMeter();
  // Third tap, at the amp's drive stage. Built unconditionally like the other
  // two; it is only CONNECTED when the preset builds an amp, so a voice with no
  // amp reads -Infinity rather than a misleading zero.
  nodes.driveMeter = createPeakMeter();
  return nodes;
}

/** Build a preset's chain nodes without a Voice or an audio graph. Exported
 *  for tests only: the chain's SHAPE rules — one amp or the other, which
 *  meters exist — are worth holding and are otherwise reachable only through a
 *  full `play()`. */
export function buildChainNodesForTest(preset: VoicePreset): ChainNodes {
  // Already-stale guard, which is what keeps this helper OFF THE NETWORK: there
  // is no Voice here to own a cabinet IR's fill, and `tests/circuit-amp-chain`
  // mocks `tone` without mocking `sample-store`, so a preset with a `cabIR`
  // would otherwise fire a real fetch out of vitest and push onto the real
  // `ToneAudioBuffer.downloads`. Every other node is built exactly as it ships.
  return buildChain(preset, () => false);
}

/** Connect entry node → chain in fixed order. Returns the chain's exit node.
 *  `entry` is the mixer (which receives the primary synth + optional layer).
 *
 *  Chain order:
 *    entry (mixer)
 *      → bodyFilter → compressor                       (pre-pedalboard shaping)
 *      → distortion → chorus → delay → autoWah         (pedalboard stage)
 *      → graphicEq bands → graphicEqLevel              (pre-amp tone shaper)
 *      → ampPreGain                                    (amp input trim)
 *        ├→ ampBassHpf → ampPreDist → ampPowerDist ─┐   (driven branch)
 *        └→ ampBassLpf ─────────────────────────────┤   (clean lows, 120 Hz)
 *                                     ampBassMerge ←┘
 *        → ampTone → ampPresence → ampOutput           (amp stage)
 *
 *      The tone stack is AFTER both saturators. This diagram said "between"
 *      until AF-01; the code below has always done the above.
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
  // The circuit amp is a self-contained sub-graph with its own entry and exit,
  // so it does not fit the linear `order` array — the same problem the bass
  // split has below, solved the same way. Flush the prefix so the amp's entry
  // is connected, then resume the linear chain from its exit.
  //
  // Do NOT push entry and exit as two consecutive members instead: the loop
  // would add an `entry -> exit` connection on top of the one the renderer
  // already made internally, and a duplicated Web Audio connection SUMS the
  // signal with itself — a silent +6 dB.
  if (c.circuitAmp) {
    order.push(c.circuitAmp.entry);
    for (let i = 0; i < order.length - 1; i++) {
      order[i].connect(order[i + 1]);
    }
    order.length = 0;
    order.push(c.circuitAmp.exit);
  }
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
  // Drive tap — ampPreGain's output, which is the node the bass split and both
  // saturators are fed from. Taken here rather than off ampPreDist because what
  // this exists to show is what the shaper RECEIVES; the shaper's own output is
  // normalised and says nothing.
  if (c.ampPreGain && c.driveMeter) c.ampPreGain.connect(c.driveMeter);
  // The same two taps for a circuit amp. `driveMeter` keeps its meaning —
  // what the amp is being FED — which for a circuit amp is its input gain's
  // output; `circuitAmpMeter` is what came back out.
  if (c.circuitAmp && c.driveMeter) c.circuitAmp.inputGain.connect(c.driveMeter);
  if (c.circuitAmp && c.circuitAmpMeter) c.circuitAmp.exit.connect(c.circuitAmpMeter);
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
  c.driveMeter?.dispose();
  if (c.circuitAmp) disposeCircuitAmpLite(c.circuitAmp);
  c.circuitAmpMeter?.dispose();
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
    isStageEnabled(a?.circuitAmp) === isStageEnabled(b?.circuitAmp) &&
    // A different circuit is a different node graph -- how many stages there
    // are, what each one is and what its component values were are all read off
    // the amp's DEFINITION at build time. So changing the amp is a rebuild, not
    // a retune, for the same reason `cabIR.url` below is.
    a?.circuitAmp?.ampId === b?.circuitAmp?.ampId &&
    isStageEnabled(a?.reverb) === isStageEnabled(b?.reverb) &&
    isStageEnabled(a?.cabIR) === isStageEnabled(b?.cabIR) &&
    isStageEnabled(a?.finalEq) === isStageEnabled(b?.finalEq) &&
    // URL change also requires a rebuild — Tone.Convolver loads its IR in
    // the constructor and doesn't support swapping URLs in place. Makeup
    // gain changes go through the in-place path below.
    a?.cabIR?.url === b?.cabIR?.url
  );
}

/**
 * Whether two sources can share one built graph.
 *
 * Not just a `kind` check. For a **sampler** the banks are baked into the constructed
 * `Tone.Sampler`s, so a different pack — or a different `release` — needs new ones;
 * comparing only the kind meant a pack switch was accepted as "in place" and then
 * applied to nothing, leaving the previous samples sounding with no error anywhere.
 *
 * For synth sources the params are genuinely live (`updateSynthParams` writes them onto
 * the existing node), so kind alone is the right test.
 */
function sameSource(a: VoiceSource, b: VoiceSource): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind !== 'sampler' || b.kind !== 'sampler') return true;
  if ((a.release ?? 1) !== (b.release ?? 1)) return false;
  if (a.samples.length !== b.samples.length) return false;
  return a.samples.every((bank, i) => {
    const other = b.samples[i];
    const keys = Object.keys(bank);
    if (keys.length !== Object.keys(other).length) return false;
    return keys.every((note) => bank[note] === other[note]);
  });
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
