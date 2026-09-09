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
  coupledChannelGains,
  brightCapShelfDb,
  pushPullCurve,
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

describe('coupledChannelGains', () => {
  const K = 1; // fully coupled, which is what the amp ships

  // ⚠ THE ONE THAT MATTERS. Both pot wipers tie to ONE node at the next
  // stage's grid, so a pot at zero is a short from that node to ground. It
  // does not merely turn its own channel down — it takes the OTHER channel
  // with it. This is the 5E3 interaction, and a mixer cannot fake it.
  it('collapses the other channel when a pot is turned to zero', () => {
    const alone = coupledChannelGains(0.5, 0.7, K, 400, 4000).bright;
    const shorted = coupledChannelGains(0, 0.7, K, 400, 4000).bright;
    expect(shorted).toBeLessThan(alone / 100);
  });

  // The other end of the same mechanism: a pot at full clamps the node to its
  // own plate and swamps the other channel.
  it('swamps the other channel when a pot is turned to full', () => {
    const alone = coupledChannelGains(0.5, 0.7, K, 400, 4000).bright;
    const clamped = coupledChannelGains(1, 0.7, K, 400, 4000).bright;
    expect(clamped).toBeLessThan(alone / 100);
  });

  // Interference is WEAKEST in the middle, where both source impedances are
  // highest. A monotonic "more rotation = more loading" model — which is what
  // this plan's first draft shipped — gets this exactly backwards.
  it('interferes least at mid rotation', () => {
    const mid = coupledChannelGains(0.5, 0.5, K, 400, 4000);
    const nearZero = coupledChannelGains(0.05, 0.5, K, 400, 4000);
    const nearFull = coupledChannelGains(0.99, 0.5, K, 400, 4000);
    expect(mid.bright).toBeGreaterThan(nearZero.bright);
    expect(mid.bright).toBeGreaterThan(nearFull.bright);
  });

  // The corner follows the node's SOURCE IMPEDANCE, which peaks where the
  // wiper splits the track evenly — a = 0.5. On a 40 dB audio taper that is
  // POSITION 0.85, not mid rotation. So the amp darkens as the volume comes
  // up, bottoms out around 8-9 on the dial, and brightens again at full.
  // Non-monotonic in a way a mixer cannot fake and a linear-pot model gets
  // wrong. Measured: 3567 Hz at 0.05, 1746 at 0.5, 400 at 0.85, 4000 at full.
  it('is darkest high on the dial, not at mid rotation', () => {
    const at = (p: number) => coupledChannelGains(p, p, K, 400, 4000).sharedNodeCornerHz;
    expect(at(0.85)).toBeLessThan(at(0.5));
    expect(at(0.85)).toBeLessThan(at(0.05));
    expect(at(0.85)).toBeLessThan(at(1));
    // and it is genuinely non-monotonic, not just falling
    expect(at(1)).toBeGreaterThan(at(0.95));
  });

  it('is symmetric between the two channels', () => {
    const a = coupledChannelGains(0.3, 0.8, K, 400, 4000);
    const b = coupledChannelGains(0.8, 0.3, K, 400, 4000);
    expect(a.normal).toBeCloseTo(b.bright, 10);
    expect(a.bright).toBeCloseTo(b.normal, 10);
  });

  // loadingStrength 0 is the escape hatch: two independent pots and NO shared
  // node, which is the shape the de-scoped single-channel fallback uses. The
  // corner must go constant too — the first draft's ignored `k` entirely and
  // still swept a corner for a circuit that was not there.
  it('becomes two independent pots at loadingStrength 0', () => {
    for (const [n, b] of [[0, 0.7], [0.5, 0.5], [1, 0.2]] as const) {
      const g = coupledChannelGains(n, b, 0, 400, 4000);
      expect(g.normal).toBeCloseTo(audioTaper(n), 10);
      expect(g.bright).toBeCloseTo(audioTaper(b), 10);
      expect(g.sharedNodeCornerHz).toBeCloseTo(4000, 6);
    }
  });

  it('stays inside the declared corner range and never returns a non-finite gain', () => {
    for (const n of [0, 0.02, 0.25, 0.5, 0.75, 0.98, 1]) {
      for (const b of [0, 0.02, 0.25, 0.5, 0.75, 0.98, 1]) {
        const g = coupledChannelGains(n, b, K, 400, 4000);
        expect(Number.isFinite(g.normal)).toBe(true);
        expect(Number.isFinite(g.bright)).toBe(true);
        expect(g.sharedNodeCornerHz).toBeGreaterThanOrEqual(400);
        expect(g.sharedNodeCornerHz).toBeLessThanOrEqual(4000);
      }
    }
  });
});

describe('brightCapShelfDb', () => {
  // A cap across the volume pot bypasses the pot at treble frequencies. Its
  // effect is strongest when the pot is DOWN — most of the signal is being
  // dropped and the cap is the only path around it — and is exactly nothing at
  // full rotation, where the wiper is at the top and there is nothing to
  // bypass.
  it('is strongest at low volume and exactly zero at full', () => {
    expect(brightCapShelfDb(0.1, 0.8)).toBeGreaterThan(brightCapShelfDb(0.5, 0.8));
    expect(brightCapShelfDb(0.5, 0.8)).toBeGreaterThan(brightCapShelfDb(1, 0.8));
    expect(brightCapShelfDb(1, 0.8)).toBe(0);
  });

  // ⚠ THE ONE THAT IS NOT A RESTATEMENT OF THE FORMULA. The cap bypasses the
  // pot, so the lift must track the ATTENUATION the pot is applying — which
  // follows the audio taper, not the rotation. A lift linear in position (the
  // first draft) decays out of step with what it is bypassing: at half
  // rotation an audio pot is already 20 dB down while a linear lift has only
  // given up half its range.
  it('tracks the pot attenuation it is bypassing, not the rotation', () => {
    const halfRotation = brightCapShelfDb(0.5, 1);
    const full = brightCapShelfDb(0, 1);
    // audioTaper(0.5) is 0.1 — the pot is 20 dB down at half rotation, so the
    // cap is still doing 90% of its work there (10.8 dB of 12). A lift linear
    // in POSITION would have given up half its range by now (6.0 dB), so this
    // threshold separates the two models.
    expect(halfRotation).toBeGreaterThan(full * 0.75);
  });

  it('is silent everywhere at depth 0', () => {
    for (const p of [0, 0.25, 0.5, 0.75, 1]) expect(brightCapShelfDb(p, 0)).toBe(0);
  });

  it('never cuts', () => {
    for (const p of [0, 0.25, 0.5, 0.75, 1]) {
      expect(brightCapShelfDb(p, 1)).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('pushPullCurve', () => {
  // Magnitude of the nth harmonic. BOTH quadratures — for any memoryless `f`
  // driven by `A·sin(t)` the output satisfies `g(π−t) = g(t)`, which forces
  // every even harmonic's SINE coefficient to zero. A sine-only bin is
  // therefore blind to exactly the harmonics this describe block is about:
  // it reads 3.1e-17 on `x => x*x`, whose true h2 is 0.32.
  const harmonic = (f: (x: number) => number, n: number): number => {
    const N = 4096;
    let re = 0;
    let im = 0;
    for (let i = 0; i < N; i++) {
      const t = (2 * Math.PI * i) / N;
      const y = f(0.8 * Math.sin(t));
      re += y * Math.cos(n * t);
      im += y * Math.sin(n * t);
    }
    return Math.hypot((2 * re) / N, (2 * im) / N);
  };

  // The reason a push-pull amp does not sound like a Champ: a matched pair
  // cancels the EVEN harmonics and leaves the odd ones.
  it('cancels even harmonics when the pair is matched', () => {
    const matched = pushPullCurve(0.45, 0.5, 0);
    expect(harmonic(matched, 2)).toBeLessThan(1e-9);
    expect(harmonic(matched, 3)).toBeGreaterThan(1e-3);
  });

  it('brings even harmonics back as the pair goes unmatched', () => {
    const matched = pushPullCurve(0.45, 0.5, 0);
    const unmatched = pushPullCurve(0.45, 0.5, 0.3);
    expect(harmonic(unmatched, 2)).toBeGreaterThan(1e-6);
    expect(harmonic(unmatched, 2)).toBeGreaterThan(harmonic(matched, 2) * 1e6);
  });

  // ⚠ THE RULE THIS WHOLE FILE KEEPS. A curve shapes; it does not amplify.
  // `amp-models.ts` normalised at the ENDPOINT and hid +22.8 dB of
  // small-signal gain inside a function documented as leaving level alone.
  //
  // The implementation normalises by the ANALYTIC slope, k·(1+m), so this
  // numeric check is independent of it and can actually fail. Normalising by a
  // numerically measured slope and then measuring it the same way would be a
  // tautology that passes for any curve at all.
  it('has unity slope at the origin', () => {
    for (const imbalance of [0, 0.15, 0.3, 1]) {
      for (const headroom of [0.05, 0.5, 1]) {
        const f = pushPullCurve(0.45, headroom, imbalance);
        const h = 1e-7;
        expect((f(h) - f(-h)) / (2 * h)).toBeCloseTo(1, 5);
      }
    }
  });

  it('is odd-symmetric when matched', () => {
    const f = pushPullCurve(0.45, 0.5, 0);
    for (const x of [0.1, 0.4, 0.9]) expect(f(-x)).toBeCloseTo(-f(x), 10);
  });

  // Nothing may reach a WaveShaper past ±1 — Web Audio clamps there and a
  // soft-clip past unity is a flat chop. The curve itself must at least never
  // expand.
  it('never expands', () => {
    const f = pushPullCurve(0.45, 0.5, 0.08);
    for (const x of [0.1, 0.5, 1, 2, 4]) expect(Math.abs(f(x))).toBeLessThanOrEqual(x);
  });
});
