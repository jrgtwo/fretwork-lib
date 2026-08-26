/**
 * The gain-structure table (AF-01).
 *
 * This is the tripwire for the whole audio-flow pass. `describeGainStructure`
 * reports what a QUIET signal is multiplied by on its way through a voice, and
 * the numbers below are the ones that motivated the pass: the amp's saturators
 * are gain stages disguised as shapers.
 *
 * **Every expectation here is meant to be moved by a later slice, on purpose.**
 * `AF-02` did exactly that: it reshaped the curves, ten assertions failed, and
 * they were rewritten with the new arithmetic behind them. A slice that changes
 * a level and leaves this file untouched has changed something it did not mean
 * to.
 *
 * **Post-AF-02.** Every shaper is now unity at the origin and compresses toward
 * `1/k` at full scale, so the interesting column moved from the small-signal
 * gain (all zero, and asserted to be) to the RESPONSE. The numbers are not
 * copied from the implementation — they are `tanh(0.25k) / k` computed from the
 * shipped `preDrive` / `powerDrive` values in `presets.ts` and the shape
 * coefficients in `amp-models.ts`.
 *
 * For the record, what these same probes read before AF-02 — the measurement
 * that motivated the whole pass:
 *
 *     preset   preDist small-signal   preDist out at 0.25 in   voice in -> out
 *     Clean          +2.7 dB                  0.331                 +4.1 dB
 *     Blues           —                       0.250                +19.3 dB
 *     Crunch    +14.0 / +9.6 dB               0.848                +27.3 dB
 *     Lead      +16.9 / +12.0 dB              0.941                +32.5 dB
 *     Metal         +22.8 dB                  0.998                +40.6 dB
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

describe('describeGainStructure — the saturators are shapes, not gain stages', () => {
  // Output at 0.25 (-12 dBFS) for each amp preset's two shapers. Small-signal
  // gain is 0 dB everywhere now and is asserted separately, below.
  const TABLE: ReadonlyArray<{
    preset: VoicePreset;
    preDistAt025: number;
    powerDistAt025: number;
  }> = [
    { preset: CLEAN_AMP_PRESET, preDistAt025: 0.2442, powerDistAt025: 0.2388 },
    { preset: BLUES_PRESET, preDistAt025: 0.25, powerDistAt025: 0.0905 },
    { preset: CRUNCH_PRESET, preDistAt025: 0.1697, powerDistAt025: 0.2311 },
    { preset: LEAD_PRESET, preDistAt025: 0.1345, powerDistAt025: 0.2117 },
    { preset: METAL_PRESET, preDistAt025: 0.0726, powerDistAt025: 0.16 },
    { preset: SURF_PRESET, preDistAt025: 0.25, powerDistAt025: 0.25 },
    { preset: AMBIENT_PRESET, preDistAt025: 0.2448, powerDistAt025: 0.25 },
  ];

  for (const row of TABLE) {
    it(`${row.preset.name}: both shapers are unity at rest and compress under level`, () => {
      const structure = describeGainStructure(row.preset);
      const pre = stage(structure, 'ampPreDist');
      const power = stage(structure, 'ampPowerDist');

      // Unity at the origin, both halves, every model. This is the AF-02
      // contract; `amp-curves.test.ts` holds it across the whole drive sweep.
      for (const shaper of [pre, power]) {
        expect(Math.abs(shaper.smallSignalDb!.positive)).toBeLessThanOrEqual(0.1);
        expect(Math.abs(shaper.smallSignalDb!.negative)).toBeLessThanOrEqual(0.1);
      }

      // And a -12 dBFS input comes back QUIETER than it went in, or unchanged on
      // an undriven stage. Never louder — that was the bug.
      expect(responseAt(pre, 0.25)).toBeCloseTo(row.preDistAt025, 3);
      expect(responseAt(power, 0.25)).toBeCloseTo(row.powerDistAt025, 3);
      expect(responseAt(pre, 0.25)).toBeLessThanOrEqual(0.25);
      expect(responseAt(power, 0.25)).toBeLessThanOrEqual(0.25);
    });
  }

  it('Metal compresses a -12 dBFS input to 0.073 instead of amplifying it to 0.998', () => {
    // The single number this whole pass turns on, before and after. `1/k` at
    // k = 13.75 is 0.0727, and the stage is at its asymptote by 0.25 — so the
    // compression it was always supposed to provide is now what actually
    // happens, in the same place the square wave used to be.
    const pre = stage(describeGainStructure(METAL_PRESET), 'ampPreDist');
    expect(responseAt(pre, 0.25)).toBeCloseTo(0.0726, 4);
    expect(responseAt(pre, 1)).toBeCloseTo(1 / 13.75, 3);
  });

  it('the asymmetric models no longer clip the two halves differently AT REST', () => {
    // Before AF-02 `asymmetricSoftClip` normalised each half by its own endpoint,
    // so a quiet symmetric input came out lopsided by 4.4 dB — a DC offset at
    // every level, including a whisper. Each half is now normalised by its own
    // SLOPE, so they match at the origin.
    const crunch = stage(describeGainStructure(CRUNCH_PRESET), 'ampPreDist');
    const imbalance = crunch.smallSignalDb!.positive - crunch.smallSignalDb!.negative;
    expect(imbalance).toBeCloseTo(0, 2);
  });

  it('but the two halves still bend differently under drive', () => {
    // The even-harmonic character has to survive the fix. It comes from the lobes
    // saturating at different rates, which they still do — it just no longer
    // happens to signals nowhere near saturation.
    const crunch = stage(describeGainStructure(CRUNCH_PRESET), 'ampPreDist');
    const full = crunch.response!.find((r) => r.input === 1)!;
    expect(full.output).not.toBeCloseTo(full.outputNegative, 3);
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
    // 0 (input) + 9 (preGain) + 0 (preDist) + 0 (powerDist)
    // + 0 (merge) + -2 (output) + 0 (cab makeup) + -4 (volume)
    //
    // Was +40.58 before AF-02, and the 37.6 dB that went missing is the two
    // shapers no longer being gain stages. What is left is the sum of the knobs
    // a person can actually see, which is the point of the exercise.
    expect(structure.smallSignalTotalDb).toBeCloseTo(3, 6);
  });

  it('a clean preset is nowhere near it', () => {
    // Clean: -12 preGain + 0 + 0 + 0 output + 3 cab makeup + 6 volume. Was +4.06.
    expect(describeGainStructure(CLEAN_AMP_PRESET).smallSignalTotalDb).toBeCloseTo(-3, 6);
  });

  it('no stage carries gain the structure does not explain', () => {
    // AF-02's acceptance criterion, as an assertion. Every contribution to the
    // total is now a named linear stage whose dB value came off the preset — no
    // shaper contributes anything at rest, so the whole structure is stated by
    // numbers a person can read rather than by a comment claiming a property.
    for (const preset of [CLEAN_AMP_PRESET, BLUES_PRESET, CRUNCH_PRESET, LEAD_PRESET, METAL_PRESET, SURF_PRESET, AMBIENT_PRESET]) {
      const structure = describeGainStructure(preset);
      const declared = structure.stages
        .filter((s) => s.enabled && s.gainDb !== null)
        .reduce((sum, s) => sum + s.gainDb!, 0);
      expect(structure.smallSignalTotalDb).toBeCloseTo(declared, 6);
    }
  });

  it('names the preset and the amp model it read', () => {
    const structure = describeGainStructure(LEAD_PRESET);
    expect(structure.presetId).toBe('lead-amp');
    expect(structure.presetName).toBe('Lead');
    expect(structure.ampModelId).toBe('marshall-plexi');
  });
});
