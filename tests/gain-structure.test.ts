/**
 * The gain-structure table (AF-01).
 *
 * This is the tripwire for the whole audio-flow pass. `describeGainStructure`
 * reports what a QUIET signal is multiplied by on its way through a voice, and
 * the numbers below are the ones that motivated the pass: the amp's saturators
 * are gain stages disguised as shapers.
 *
 * **Every expectation here is meant to be moved by a later slice, on purpose.**
 * `AF-02` reshapes the curves and will break the small-signal assertions; that
 * is the point. A slice that changes a level and leaves this file untouched has
 * changed something it did not mean to.
 *
 * The numbers are not copied from the implementation — they are `k / tanh(k)`
 * and `tanh(0.25k) / tanh(k)` computed from the shipped `preDrive` / `powerDrive`
 * values in `presets.ts` and the shape coefficients in `amp-models.ts`.
 */
import { describe, it, expect } from 'vitest';
import {
  describeGainStructure,
  GAIN_STRUCTURE_PROBE_INPUTS,
  type GainStructure,
  type GainStructureStage,
} from '../src/playback/voices/gain-structure';
import {
  CLEAN_AMP_PRESET,
  BLUES_PRESET,
  CRUNCH_PRESET,
  LEAD_PRESET,
  METAL_PRESET,
  SURF_PRESET,
  AMBIENT_PRESET,
} from '../src/playback/voices/presets';
import type { VoicePreset } from '../src/playback/voices/types';

function stage(structure: GainStructure, id: string): GainStructureStage {
  const found = structure.stages.find((s) => s.id === id);
  if (!found) throw new Error(`no stage "${id}" in the table`);
  return found;
}

/** A shaper's output for a positive input of `x`. */
function responseAt(s: GainStructureStage, x: number): number {
  const probe = s.response?.find((r) => r.input === x);
  if (!probe) throw new Error(`stage "${s.id}" has no probe at ${x}`);
  return probe.output;
}

describe('describeGainStructure — the saturators are gain stages', () => {
  // Small-signal gain in dB for each amp preset's two shapers, positive and
  // negative half, plus the positive-going output for a 0.25 (-12 dBFS) input.
  const TABLE: ReadonlyArray<{
    preset: VoicePreset;
    preDistDb: [number, number];
    preDistAt025: number;
    powerDistDb: [number, number];
    powerDistAt025: number;
  }> = [
    { preset: CLEAN_AMP_PRESET, preDistDb: [2.65, 2.65], preDistAt025: 0.3313, powerDistDb: [4.41, 4.41], powerDistAt025: 0.3967 },
    { preset: BLUES_PRESET, preDistDb: [0, 0], preDistAt025: 0.25, powerDistDb: [20.8, 15.53], powerDistAt025: 0.9917 },
    { preset: CRUNCH_PRESET, preDistDb: [13.98, 9.59], preDistAt025: 0.8484, powerDistDb: [6.34, 4.39], powerDistAt025: 0.4794 },
    { preset: LEAD_PRESET, preDistDb: [16.9, 12.05], preDistAt025: 0.9414, powerDistDb: [9.59, 6.34], powerDistAt025: 0.6383 },
    { preset: METAL_PRESET, preDistDb: [22.77, 22.77], preDistAt025: 0.9979, powerDistDb: [14.81, 14.81], powerDistAt025: 0.8799 },
    { preset: SURF_PRESET, preDistDb: [0, 0], preDistAt025: 0.25, powerDistDb: [0, 0], powerDistAt025: 0.25 },
    { preset: AMBIENT_PRESET, preDistDb: [2.42, 2.42], preDistAt025: 0.3236, powerDistDb: [0, 0], powerDistAt025: 0.25 },
  ];

  for (const row of TABLE) {
    it(`${row.preset.name}: reports both shapers' small-signal gain and their response`, () => {
      const structure = describeGainStructure(row.preset);
      const pre = stage(structure, 'ampPreDist');
      const power = stage(structure, 'ampPowerDist');

      expect(pre.smallSignalDb!.positive).toBeCloseTo(row.preDistDb[0], 1);
      expect(pre.smallSignalDb!.negative).toBeCloseTo(row.preDistDb[1], 1);
      expect(responseAt(pre, 0.25)).toBeCloseTo(row.preDistAt025, 3);

      expect(power.smallSignalDb!.positive).toBeCloseTo(row.powerDistDb[0], 1);
      expect(power.smallSignalDb!.negative).toBeCloseTo(row.powerDistDb[1], 1);
      expect(responseAt(power, 0.25)).toBeCloseTo(row.powerDistAt025, 3);
    });
  }

  it('Metal leaves a -12 dBFS input at 0.998 — a square wave — before preGainDb is counted', () => {
    const pre = stage(describeGainStructure(METAL_PRESET), 'ampPreDist');
    expect(pre.smallSignalDb!.positive).toBeCloseTo(22.77, 1);
    expect(responseAt(pre, 0.25)).toBeGreaterThan(0.99);
  });

  it('the asymmetric models clip the two halves with different small-signal gain', () => {
    // Not a rounding artefact: `asymmetricSoftClip` normalises each half by its
    // own endpoint, so a quiet symmetric input comes out lopsided. That is a DC
    // offset at every level, not only when the stage is driven.
    const crunch = stage(describeGainStructure(CRUNCH_PRESET), 'ampPreDist');
    const imbalance = crunch.smallSignalDb!.positive - crunch.smallSignalDb!.negative;
    expect(imbalance).toBeCloseTo(4.39, 1);
  });

  it('a curve at zero drive is identity, not a gain', () => {
    // Surf and Blues ship `preDrive: 0`; the helpers return identity below
    // 0.001. Three of the seven amp presets have a bypassed pre-stage.
    const surf = stage(describeGainStructure(SURF_PRESET), 'ampPreDist');
    expect(surf.smallSignalDb).toEqual({ positive: 0, negative: 0 });
    for (const x of GAIN_STRUCTURE_PROBE_INPUTS) {
      expect(responseAt(surf, x)).toBeCloseTo(x, 6);
    }
  });
});

describe('describeGainStructure — the linear stages', () => {
  it('reads every gain node straight off the preset, in chain order', () => {
    const structure = describeGainStructure(METAL_PRESET);
    expect(structure.stages.map((s) => s.id)).toEqual([
      'inputGain',
      'graphicEqLevel',
      'ampPreGain',
      'ampPreDist',
      'ampPowerDist',
      'ampBassMerge',
      'ampOutput',
      'cabIRMakeup',
      'volume',
    ]);
    expect(stage(structure, 'ampPreGain').gainDb).toBe(9);
    expect(stage(structure, 'ampOutput').gainDb).toBe(-2);
    expect(stage(structure, 'volume').gainDb).toBe(-4);
    expect(stage(structure, 'inputGain').gainDb).toBe(0);
  });

  it('a track input gain overrides the preset value rather than stacking with it', () => {
    // `Track.inputGainDb` is applied at `inputGain` and OVERRIDES the preset's
    // own value — AU-03's decision, because two gains at one point is two things
    // to get wrong for one job.
    //
    // No shipped preset sets `inputGainDb`, so this builds one: against a preset
    // of 0 the two behaviours are indistinguishable, and an assertion that
    // cannot tell them apart is not testing the distinction it names.
    const withPresetGain: VoicePreset = { ...METAL_PRESET, inputGainDb: -6 };
    expect(stage(describeGainStructure(withPresetGain), 'inputGain').gainDb).toBe(-6);
    expect(
      stage(describeGainStructure(withPresetGain, { inputGainDb: -9 }), 'inputGain').gainDb,
    ).toBe(-9);
  });

  it('marks a stage its preset does not build as disabled, and leaves it out of the total', () => {
    const noAmp: VoicePreset = {
      ...METAL_PRESET,
      effects: { ...METAL_PRESET.effects, amp: { ...METAL_PRESET.effects!.amp!, enabled: false } },
    };
    const structure = describeGainStructure(noAmp);
    for (const id of ['ampPreGain', 'ampPreDist', 'ampPowerDist', 'ampBassMerge', 'ampOutput']) {
      expect(stage(structure, id).enabled).toBe(false);
    }
    // Only inputGain (0) + volume (-4) remain; the cab makeup is undefined → 0.
    expect(structure.smallSignalTotalDb).toBeCloseTo(-4, 6);
  });

  it('the bass merge sums two branches into a unity gain', () => {
    // `ampBassMerge` is `new Tone.Gain(1)` with the driven and clean branches
    // both feeding it, so a signal below the 120 Hz crossover is counted twice.
    // Recorded here as 0 dB so AF-02 has to change this line when it fixes it.
    const merge = stage(describeGainStructure(METAL_PRESET), 'ampBassMerge');
    expect(merge.gainDb).toBe(0);
    expect(merge.sumsBranches).toBe(true);
  });
});

describe('describeGainStructure — the total', () => {
  it('sums every enabled stage, so a quiet note has one number', () => {
    const structure = describeGainStructure(METAL_PRESET);
    // 0 (input) + 9 (preGain) + 22.77 (preDist) + 14.81 (powerDist)
    // + 0 (merge) + -2 (output) + 0 (cab makeup) + -4 (volume)
    expect(structure.smallSignalTotalDb).toBeCloseTo(40.58, 1);
  });

  it('a clean preset is nowhere near it', () => {
    // Clean: -12 preGain + 2.65 + 4.41 + 0 output + 3 cab makeup + 6 volume.
    expect(describeGainStructure(CLEAN_AMP_PRESET).smallSignalTotalDb).toBeCloseTo(4.06, 1);
  });

  it('names the preset and the amp model it read', () => {
    const structure = describeGainStructure(LEAD_PRESET);
    expect(structure.presetId).toBe('lead-amp');
    expect(structure.presetName).toBe('Lead');
    expect(structure.ampModelId).toBe('marshall-plexi');
  });
});
