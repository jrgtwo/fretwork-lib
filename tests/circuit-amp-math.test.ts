/**
 * The circuit amp's arithmetic.
 *
 * The rule this file exists to hold is the one `tests/amp-curves.test.ts`
 * exists to hold for the older models: A CURVE SHAPES, IT DOES NOT AMPLIFY.
 * Each stage's real gain is an explicit `Tone.Gain` in the renderer, where
 * `gain-structure.ts` can read it. `amp-models.ts` normalised at the ENDPOINT
 * for months, which left +22.8 dB of small-signal gain inside a function whose
 * comment claimed it left level alone, and no meter in the system could see it.
 */
import { describe, it, expect } from 'vitest';
import {
  triodeCurve,
  powerStageCurve,
  transformerCurve,
  tonePotCutoffHz,
  audioTaper,
} from '../src/playback/voices/circuit-amp/circuit-math';

const EPSILON = 1e-6;

function slopes(curve: (x: number) => number) {
  return { positive: curve(EPSILON) / EPSILON, negative: curve(-EPSILON) / -EPSILON };
}

describe('every circuit-amp curve is unity at small signal', () => {
  const curves: ReadonlyArray<readonly [string, (x: number) => number]> = [
    ...[0, 0.35, 0.45, 1].map((a) => [`triode asym ${a}`, triodeCurve(a)] as const),
    ...[0.2, 0.45, 0.9].map((h) => [`power headroom ${h}`, powerStageCurve(h)] as const),
    ...[0, 0.3, 1].map((s) => [`transformer sat ${s}`, transformerCurve(s)] as const),
  ];

  for (const [name, curve] of curves) {
    it(`${name} has unity slope both directions`, () => {
      const { positive, negative } = slopes(curve);
      expect(positive).toBeCloseTo(1, 4);
      expect(negative).toBeCloseTo(1, 4);
    });
  }
});

describe('triodeCurve', () => {
  it('bends the two halves differently once asymmetry is non-zero', () => {
    const curve = triodeCurve(0.45);
    expect(Math.abs(curve(0.9))).not.toBeCloseTo(Math.abs(curve(-0.9)), 3);
  });

  it('is symmetric when asymmetry is zero', () => {
    const curve = triodeCurve(0);
    expect(curve(0.9)).toBeCloseTo(-curve(-0.9), 8);
  });

  it('compresses — never expands — as input grows', () => {
    const curve = triodeCurve(0.45);
    for (const x of [0.1, 0.3, 0.6, 0.9, 1]) {
      expect(Math.abs(curve(x))).toBeLessThanOrEqual(x + 1e-9);
      expect(Math.abs(curve(-x))).toBeLessThanOrEqual(x + 1e-9);
    }
  });
});

describe('powerStageCurve', () => {
  it('breaks up earlier with less headroom', () => {
    const early = powerStageCurve(0.2);
    const late = powerStageCurve(0.9);
    expect(Math.abs(early(0.5))).toBeLessThan(Math.abs(late(0.5)));
  });
});

describe('tonePotCutoffHz', () => {
  it('sweeps the network between its documented endpoints', () => {
    expect(tonePotCutoffHz(0, 900, 12000)).toBeCloseTo(900, 3);
    expect(tonePotCutoffHz(1, 900, 12000)).toBeCloseTo(12000, 3);
  });

  it('sweeps logarithmically, because hearing does', () => {
    const mid = tonePotCutoffHz(0.5, 900, 12000);
    expect(mid).toBeCloseTo(Math.sqrt(900 * 12000), 0);
  });

  it('clamps a position outside 0..1', () => {
    expect(tonePotCutoffHz(-1, 900, 12000)).toBeCloseTo(900, 3);
    expect(tonePotCutoffHz(2, 900, 12000)).toBeCloseTo(12000, 3);
  });
});

describe('audioTaper', () => {
  it('is silent at 0 and unity at 1', () => {
    expect(audioTaper(0)).toBe(0);
    expect(audioTaper(1)).toBeCloseTo(1, 6);
  });

  it('sits well below half gain at half rotation, like a real audio pot', () => {
    // A log-taper pot passes roughly a tenth of the voltage at half rotation.
    // A LINEAR pot would sit at 0.5 here, which is the thing being ruled out.
    expect(audioTaper(0.5)).toBeLessThan(0.2);
    expect(audioTaper(0.5)).toBeGreaterThan(0.05);
  });

  it('never decreases as the pot turns up', () => {
    let previous = -1;
    for (let p = 0; p <= 1.0001; p += 0.05) {
      const gain = audioTaper(Math.min(p, 1));
      expect(gain).toBeGreaterThanOrEqual(previous);
      previous = gain;
    }
  });
});
