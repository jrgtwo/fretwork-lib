/**
 * Source calibration — what a note is worth before anything shapes it (AF-03).
 *
 * ## The defect
 *
 * A sample file is mastered to -1 dBFS true peak, a note with no dynamics fires
 * at full velocity, and the node they converge on is `Tone.Gain(1)`. So ONE note
 * arrives at the amp at very nearly full scale, and there is nothing left for a
 * second one. Six notes of a chord fire on the same tick and sum coherently —
 * +15.6 dB — which lands them 14 dB past full scale before the amp has done
 * anything at all.
 *
 * ## What this module states
 *
 * A reference level the whole chain is calibrated against, and the source peak
 * it is measured from. The trim is the DIFFERENCE, derived once — not a number
 * typed into two places that can drift apart.
 *
 * ## Why samplers and synths are not the same case
 *
 * The sample packs' mastering level is a documented fact about the files, which
 * is what makes one library-level constant the right shape for it — and why it
 * does NOT belong on a preset, where it would be copied into fourteen of them
 * and every new preset would start broken (the distinction AU-03 settled).
 *
 * A synth has no such fact. What a `Tone.FMSynth` peaks at depends on its
 * modulation index, its harmonicity and its envelope — it is a property of the
 * params, not of the source kind. So synth sources are reported as UNMEASURED
 * and trimmed by nothing, deliberately and visibly, rather than being given a
 * plausible-looking number this module cannot stand behind.
 */
import { describe, it, expect } from 'vitest';
import {
  REFERENCE_LEVEL_DBFS,
  SAMPLE_PACK_PEAK_DBFS,
  sourceTrimDb,
  trimForPeakDb,
  isSourceCalibrated,
} from '../src/playback/voices/levels';
import type { VoiceSource } from '../src/playback/voices/types';

const SAMPLER: VoiceSource = { kind: 'sampler', samples: [{ E2: 'e2.mp3' }] };
const PLUCK: VoiceSource = {
  kind: 'pluck-synth',
  params: { attackNoise: 1.5, dampening: 6000, resonance: 0.85, release: 1 },
};
const FM: VoiceSource = {
  kind: 'fm-synth',
  params: {} as never,
};

describe('the reference level', () => {
  it('is -18 dBFS, the standard digital operating level', () => {
    // Not a preference. It is the only candidate that leaves room for a positive
    // `preGainDb` once a six-note chord (+15.6 dB over a single note) has to stay
    // inside the WaveShaper's ±1 domain: -12 would put a chord at +3.6 dBFS.
    expect(REFERENCE_LEVEL_DBFS).toBe(-18);
  });

  it('leaves a six-note chord below full scale', () => {
    const chordPeak = REFERENCE_LEVEL_DBFS + 20 * Math.log10(6);
    expect(chordPeak).toBeLessThan(0);
  });
});

describe('sourceTrimDb', () => {
  it('brings a sample pack from its mastered peak down to the reference', () => {
    // Derived, not typed. -1 mastered, -18 wanted, so -17 of trim.
    expect(sourceTrimDb(SAMPLER)).toBeCloseTo(REFERENCE_LEVEL_DBFS - SAMPLE_PACK_PEAK_DBFS, 10);
    expect(sourceTrimDb(SAMPLER)).toBeCloseTo(-17, 10);
  });

  it('is the reference minus the peak, for any reference and any peak', () => {
    // The RELATIONSHIP, not the one number it currently produces. With the
    // constants where they are, a hardcoded `-17` and the derived value are
    // indistinguishable — so the derivation is exercised through
    // `trimForPeakDb` with values the constants do not supply.
    expect(trimForPeakDb(-1, -18)).toBeCloseTo(-17, 10);
    expect(trimForPeakDb(-1, -24)).toBeCloseTo(-23, 10);
    expect(trimForPeakDb(-6, -18)).toBeCloseTo(-12, 10);
    expect(trimForPeakDb(0, -18)).toBeCloseTo(-18, 10);
    // A source quieter than the reference is trimmed UPWARD, which is the same
    // rule and not a special case.
    expect(trimForPeakDb(-30, -18)).toBeCloseTo(12, 10);
  });

  // NOT covered, deliberately noted rather than left to be assumed: that
  // `sourceTrimDb` DELEGATES to `trimForPeakDb` instead of returning a literal
  // -17. With the constants where they are the two are indistinguishable at
  // every call site, so no test can tell them apart without making the constants
  // injectable — which would be more machinery than the risk is worth. The
  // derivation itself is proven above; the delegation is a structural choice.

  it('defaults its reference to the library constant', () => {
    expect(trimForPeakDb(SAMPLE_PACK_PEAK_DBFS)).toBeCloseTo(sourceTrimDb(SAMPLER), 10);
  });

  it('leaves synth sources alone, because their peak is a property of their params', () => {
    // Unity, and reported as uncalibrated so the gap is visible rather than
    // looking like a decision. A guessed number here would be indistinguishable
    // from a measured one at the call site, which is how the "normalized" comment
    // in `amp-models.ts` managed to be wrong for months.
    expect(sourceTrimDb(PLUCK)).toBe(0);
    expect(sourceTrimDb(FM)).toBe(0);
  });
});

describe('isSourceCalibrated', () => {
  it('is true only where a measured fact backs the trim', () => {
    expect(isSourceCalibrated(SAMPLER)).toBe(true);
    expect(isSourceCalibrated(PLUCK)).toBe(false);
    expect(isSourceCalibrated(FM)).toBe(false);
  });
});
