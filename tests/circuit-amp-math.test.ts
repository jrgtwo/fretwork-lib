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
import { harmonic } from './harmonic';
import {
  triodeCurve,
  powerStageCurve,
  transformerCurve,
  tonePotCutoffHz,
  audioTaper,
  sharedNodeResponse,
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

/**
 * The 5E3's volume/tone node, from the 1957 Deluxe schematic.
 *
 * Both volume pots are 1 MΩ audio, the tone pot 1 MΩ audio, the tone cap
 * .005 µF and the bright cap .0005 µF. V1 is a 12AY7 into a 100 kΩ plate load,
 * so each channel's source impedance is r_p ‖ R_L, about 20 kΩ.
 */
const NODE_5E3 = {
  volumePotOhms: 1_000_000,
  plateSourceOhms: 20_000,
  tonePotOhms: 1_000_000,
  toneCapFarads: 5e-9,
  brightCapFarads: 5e-10,
} as const;

describe('sharedNodeResponse', () => {
  // ⚠ THE ONE THAT MATTERS, AND IT IS THE REVERSE OF A CONVENTIONAL POT.
  // A 5E3's volume pots ARE V2A's grid leak: the track runs from the grid node
  // to ground and the channel's signal arrives at the WIPER. So a pot at zero
  // grounds its own wiper — that channel goes silent — and presents its FULL
  // 1 MΩ track to the shared node, which is a light load. It does NOT drag the
  // other channel down with it. A conventional divider model says it shorts
  // the node, and that is the model this file used to hold.
  it('silences its own channel and leaves the other almost untouched at zero', () => {
    const r = sharedNodeResponse(1, 0, 0.5, NODE_5E3);
    expect(r.bright).toBe(0);
    expect(r.normal).toBeGreaterThan(0.9); // measures 0.9615
  });

  // The real interaction, and it runs the other way: turning a channel UP is
  // what steals from the other. At full the wiper sits at the grid end, so
  // V1's ~20 kΩ plate impedance clamps the node and swallows whatever the
  // other channel is contributing through its far higher impedance.
  it('swamps the other channel when a pot is turned up, not down', () => {
    const closed = sharedNodeResponse(1, 0, 0.5, NODE_5E3).normal;
    const open = sharedNodeResponse(1, 1, 0.5, NODE_5E3).normal;
    expect(open).toBeLessThan(closed * 0.6); // 0.4902 against 0.9615
  });

  // ⚠ MONOTONIC, and a conventional-pot model gets this wrong in both
  // directions. The node's source impedance falls steadily as the volumes come
  // up — 500 kΩ with both closed down to about 10 kΩ with both wide open — so
  // the amp gets BRIGHTER as it is turned up. There is no darkest point
  // mid-dial and no brightening again at the top.
  it('drops its node impedance monotonically as the volumes come up', () => {
    const at = (p: number) => sharedNodeResponse(p, p, 0.5, NODE_5E3).nodeOhms;
    expect(at(0)).toBeGreaterThan(at(0.5));
    expect(at(0.5)).toBeGreaterThan(at(0.85));
    expect(at(0.85)).toBeGreaterThan(at(1));
  });

  // The same fact heard rather than measured: a lower node impedance hands the
  // tone cap a higher corner. 53 Hz with the volumes down, 290 Hz wide open.
  it('raises the tone corner as the volumes come up', () => {
    const at = (p: number) => sharedNodeResponse(p, p, 0.5, NODE_5E3).toneCornerHz;
    expect(at(1)).toBeGreaterThan(at(0.5));
    expect(at(0.5)).toBeGreaterThan(at(0));
  });

  // The tone network is a first-order SHELF, not a lowpass: below the corner
  // it passes everything, above it what survives is `tonePlateau`. Tone down
  // puts the wiper on the cap and shunts the top end away; tone up puts a
  // megohm in series with the cap and there is nothing left to shunt.
  it('cuts treble hardest with the tone pot down and barely at all at full', () => {
    expect(sharedNodeResponse(1, 1, 0, NODE_5E3).tonePlateau).toBeLessThan(0.1);
    expect(sharedNodeResponse(1, 1, 1, NODE_5E3).tonePlateau).toBeGreaterThan(0.9);
  });

  it('never boosts through the tone network', () => {
    for (const v of [0, 0.3, 0.7, 1]) {
      for (const t of [0, 0.3, 0.7, 1]) {
        expect(sharedNodeResponse(v, v, t, NODE_5E3).tonePlateau).toBeLessThanOrEqual(1);
      }
    }
  });

  // ⚠ THE BRIGHT CAP TRACKS THE TONE POT, NOT THE VOLUME. The .0005 does not
  // bridge a volume pot — it feeds the TOP of the tone pot from V1B's plate,
  // so how much treble it injects depends on how close the tone wiper sits to
  // that end. The renderer sums the injection at the node AHEAD of the tone
  // shelf, so what is actually audible is the product of the two.
  it('injects through the bright cap only as the tone pot comes up', () => {
    const audible = (t: number) => {
      const r = sharedNodeResponse(0.5, 0.5, t, NODE_5E3);
      return r.brightInjection * r.tonePlateau;
    };
    expect(audible(1)).toBeGreaterThan(audible(0) * 100); // 0.657 against 3.4e-4
  });

  // And it fades as the amp is turned up, which is what a bright cap is for.
  // The node impedance it works against collapses, so less of it reaches.
  it('fades the bright injection as the volumes come up', () => {
    const audible = (v: number) => {
      const r = sharedNodeResponse(v, v, 1, NODE_5E3);
      return r.brightInjection * r.tonePlateau;
    };
    expect(audible(0.1)).toBeGreaterThan(audible(1) * 1.5); // 0.642 against 0.326
  });

  // The resistive path is symmetric — both channels see identical pots and
  // plate loads. Only the bright cap is asymmetric, and it is not in here.
  it('is symmetric between the two channels in its resistive path', () => {
    const a = sharedNodeResponse(0.3, 0.8, 0.5, NODE_5E3);
    const b = sharedNodeResponse(0.8, 0.3, 0.5, NODE_5E3);
    expect(a.normal).toBeCloseTo(b.bright, 10);
    expect(a.bright).toBeCloseTo(b.normal, 10);
    expect(a.nodeOhms).toBeCloseTo(b.nodeOhms, 6);
  });

  it('stays finite and in range across the whole control surface', () => {
    for (const n of [0, 0.02, 0.5, 0.98, 1]) {
      for (const b of [0, 0.02, 0.5, 0.98, 1]) {
        for (const t of [0, 0.5, 1]) {
          const r = sharedNodeResponse(n, b, t, NODE_5E3);
          for (const v of [r.normal, r.bright, r.nodeOhms, r.toneCornerHz, r.brightCornerHz]) {
            expect(Number.isFinite(v)).toBe(true);
          }
          expect(r.normal).toBeGreaterThanOrEqual(0);
          expect(r.normal).toBeLessThanOrEqual(1);
          expect(r.bright).toBeGreaterThanOrEqual(0);
          expect(r.bright).toBeLessThanOrEqual(1);
          expect(r.nodeOhms).toBeGreaterThan(0);
          expect(r.tonePlateau).toBeGreaterThan(0);
          expect(r.brightInjection).toBeGreaterThanOrEqual(0);
          expect(r.brightInjection).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});

describe('pushPullCurve', () => {
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
