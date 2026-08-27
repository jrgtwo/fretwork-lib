/**
 * What a quiet signal is multiplied by on its way through a voice.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 *
 * The amp's saturators are gain stages disguised as shapers, and nothing in the
 * codebase could see it. Every curve in `amp-models.ts` is normalised at its
 * **endpoint** — `tanh(x·k) / tanh(k)` — which pins output to 1 when input is 1
 * and says nothing whatever about anything quieter. Its slope at the origin is
 * `k / tanh(k)`, which on Metal's pre-stage is +22.8 dB. A -12 dBFS input comes
 * out of that stage at 0.998: a square wave, before the preset's +9 dB of
 * `preGainDb` has even been counted.
 *
 * That is invisible from both of the voice's meters. They bracket the drive
 * stage, and because each curve normalises its own output the stage hands back
 * an ordinary-looking level however hard it was hit. This module is the
 * measurement that replaces inference — pure arithmetic on a preset, no audio
 * graph, so it runs in a test.
 *
 * ── How the shaper numbers are obtained ──────────────────────────────────────
 *
 * By PROBING `model.curve(drive)`, not by re-deriving `k / tanh(k)` per curve
 * family. A second copy of the formula would agree with the first one by
 * construction and prove nothing; probing the real function keeps the table
 * honest when `AF-02` reshapes it, which is the whole point of having it.
 *
 * The two halves are probed separately because `asymmetricSoftClip` normalises
 * the positive and negative lobes by their own endpoints. Crunch's pre-stage is
 * +14.0 dB going up and +9.6 dB going down — a standing DC offset at every
 * level, not something the stage only does when driven.
 *
 * ── What it does not model ───────────────────────────────────────────────────
 *
 * Only the stages that carry a LEVEL: the linear gain nodes and the two
 * saturators. Filters, the tone stack, the compressor, the pedals and the cab
 * convolution all change the signal without a level knob to read, and giving
 * them a plausible-looking dB figure here would be a guess wearing a number.
 * Bringing them in is `AF-04`'s job, and it has to measure them to do it.
 */
import { getAmpModel } from './amp-models';
import { isSourceCalibrated, sourceTrimDb } from './levels';
import type { VoicePreset } from './types';

/** Input magnitudes each shaper is probed at, in linear amplitude.
 *  0.25 is -12 dBFS, the level the epic's table is quoted at. */
export const GAIN_STRUCTURE_PROBE_INPUTS: readonly number[] = [0.1, 0.25, 0.5, 1.0];

/** How far from zero "small signal" is probed. Small enough that every shipped
 *  curve is linear to well past the precision anyone reads off this table, and
 *  large enough to stay clear of double-precision noise. */
const SMALL_SIGNAL_EPSILON = 1e-6;

/** A shaper's output for one input magnitude, both directions. */
export interface ShaperResponse {
  readonly input: number;
  /** Output for `+input`. */
  readonly output: number;
  /** Magnitude of the output for `-input`. Differs from `output` on the
   *  asymmetric models. */
  readonly outputNegative: number;
}

/** Gain at the origin, in dB, per half of the waveform. */
export interface SmallSignalGainDb {
  readonly positive: number;
  readonly negative: number;
}

export interface GainStructureStage {
  /** The `ChainNodes` key this stage is built as in `Voice.ts`. */
  readonly id: string;
  readonly label: string;
  /** False when this preset does not build the stage at all — a disabled
   *  effect block, or a cab with no IR. A disabled stage still appears, with
   *  the value it would have had, and contributes nothing to the total. */
  readonly enabled: boolean;
  /** dB, for a plain gain node. `null` for a shaper. */
  readonly gainDb: number | null;
  /** dB at the origin, for a shaper. `null` for a plain gain node. */
  readonly smallSignalDb: SmallSignalGainDb | null;
  /** The shaper's response at {@link GAIN_STRUCTURE_PROBE_INPUTS}. `null` for
   *  a plain gain node. */
  readonly response: readonly ShaperResponse[] | null;
  /** True where two parallel branches sum into this node. `ampBassMerge` is a
   *  `Tone.Gain(1)` fed by both the driven and the clean-bass branch, so
   *  anything below the 120 Hz crossover is counted twice and the flagged 0 dB
   *  is not the whole story. Fixing that is `AF-02`. */
  readonly sumsBranches: boolean;
}

export interface GainStructure {
  readonly presetId: string;
  readonly presetName: string;
  /** The resolved amp model, or `null` when the preset has no amp stage. */
  readonly ampModelId: string | null;
  /** Chain order, front to back. */
  readonly stages: readonly GainStructureStage[];
  /** Every enabled stage's small-signal gain, summed. What a note quiet enough
   *  to stay on the linear part of every curve is multiplied by, end to end. */
  readonly smallSignalTotalDb: number;
}

/** Overrides the voice is actually run with, which the preset does not carry. */
export interface GainStructureOptions {
  /** `Track.inputGainDb`. OVERRIDES `preset.inputGainDb` rather than stacking
   *  with it — see `Voice.setInputGainDb` and AU-03. */
  readonly inputGainDb?: number;
}

function gainStage(
  id: string,
  label: string,
  enabled: boolean,
  gainDb: number,
  sumsBranches = false,
): GainStructureStage {
  return { id, label, enabled, gainDb, smallSignalDb: null, response: null, sumsBranches };
}

function toDb(gain: number): number {
  return 20 * Math.log10(gain);
}

function shaperStage(
  id: string,
  label: string,
  enabled: boolean,
  curve: (x: number) => number,
): GainStructureStage {
  const e = SMALL_SIGNAL_EPSILON;
  return {
    id,
    label,
    enabled,
    gainDb: null,
    smallSignalDb: {
      positive: toDb(curve(e) / e),
      negative: toDb(curve(-e) / -e),
    },
    response: GAIN_STRUCTURE_PROBE_INPUTS.map((input) => ({
      input,
      output: curve(input),
      outputNegative: -curve(-input),
    })),
    sumsBranches: false,
  };
}

/**
 * The per-stage gain table for one preset.
 *
 * Pure: no `Tone` node is constructed and no audio context is touched, so this
 * runs anywhere. The stage ids match the `ChainNodes` keys in `Voice.ts` so a
 * row can be traced to the node it describes.
 */
export function describeGainStructure(
  preset: VoicePreset,
  options: GainStructureOptions = {},
): GainStructure {
  const amp = preset.effects?.amp;
  const ampOn = amp != null && amp.enabled !== false;
  const graphicEq = preset.effects?.graphicEq;
  const graphicEqOn = graphicEq != null && graphicEq.enabled !== false;
  const cabIR = preset.effects?.cabIR;
  const cabOn = cabIR != null && cabIR.enabled !== false;
  const model = ampOn ? getAmpModel(amp!.modelId) : null;

  const stages: GainStructureStage[] = [
    gainStage(
      'sourceTrim',
      isSourceCalibrated(preset.source)
        ? 'Source calibration'
        : 'Source calibration (source unmeasured)',
      true,
      sourceTrimDb(preset.source),
    ),
    gainStage(
      'inputGain',
      'Input gain',
      true,
      options.inputGainDb ?? preset.inputGainDb ?? 0,
    ),
    gainStage('graphicEqLevel', 'Graphic EQ level', graphicEqOn, graphicEq?.levelDb ?? 0),
    gainStage('ampPreGain', 'Amp pre-gain', ampOn, amp?.preGainDb ?? 0),
    shaperStage(
      'ampPreDist',
      'Amp pre-amp saturation',
      ampOn,
      model ? model.curve(amp!.preDrive) : (x) => x,
    ),
    shaperStage(
      'ampPowerDist',
      'Amp power-amp saturation',
      ampOn,
      model ? model.curve(amp!.powerDrive) : (x) => x,
    ),
    gainStage('ampBassMerge', 'Amp bass-split merge', ampOn, 0, true),
    gainStage('ampOutput', 'Amp output', ampOn, amp?.outputDb ?? 0),
    gainStage('cabIRMakeup', 'Cabinet makeup', cabOn, cabIR?.makeupDb ?? 0),
    gainStage('volume', 'Voice volume', true, preset.level.volumeDb),
  ];

  let smallSignalTotalDb = 0;
  for (const s of stages) {
    if (!s.enabled) continue;
    smallSignalTotalDb += s.gainDb ?? s.smallSignalDb!.positive;
  }

  return {
    presetId: preset.id,
    presetName: preset.name,
    ampModelId: model?.id ?? null,
    stages,
    smallSignalTotalDb,
  };
}
