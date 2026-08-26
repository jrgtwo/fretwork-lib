/**
 * The contract every amp saturator curve has to keep (AF-02).
 *
 * `amp-models.ts` had no test of its own until this file. That is how a comment
 * asserting the curves were "normalized so peak output ≈ unity … compresses
 * dynamics but doesn't bump the overall peak level" survived for months while
 * the code did the opposite for every signal below full scale.
 *
 * The property that matters is the one nobody checked: **what the curve does to
 * a QUIET signal**. Endpoint normalisation — `tanh(k·x) / tanh(k)` — pins output
 * to 1 when input is 1 and says nothing about anything else, and its slope at
 * the origin is `k / tanh(k)`: +22.8 dB on Modern High-Gain at `preDrive: 0.85`.
 * A saturator that amplifies quiet signals by 22 dB is a gain stage wearing a
 * shaper's name.
 *
 * Slope normalisation — dividing by that slope instead — makes each curve unity
 * when quiet and saturating toward `1/k` when loud, which is what a saturator
 * is: a downward compressor. These tests hold that shape for every model at
 * every drive value, so it cannot quietly stop being true again.
 */
import { describe, it, expect } from 'vitest';
import { AMP_MODELS } from '../src/playback/voices/amp-models';

/** How far from zero "small signal" is probed. */
const EPSILON = 1e-6;

/** Drive values swept per model. Includes both ends and the dead-zone boundary
 *  the helpers use (`drive < 0.001` returns identity). */
const DRIVES = [0, 0.0005, 0.001, 0.05, 0.11, 0.25, 0.4, 0.6, 0.83, 0.85, 1];

function db(gain: number): number {
  return 20 * Math.log10(gain);
}

/** Gain at the origin, per half of the waveform. */
function slopes(curve: (x: number) => number): { positive: number; negative: number } {
  return { positive: curve(EPSILON) / EPSILON, negative: curve(-EPSILON) / -EPSILON };
}

describe('every amp curve is unity at small signal', () => {
  for (const model of AMP_MODELS) {
    for (const drive of DRIVES) {
      it(`${model.id} at drive ${drive}`, () => {
        const { positive, negative } = slopes(model.curve(drive));
        // ±0.1 dB, both halves. The asymmetric models normalise each lobe by its
        // own endpoint today, so this fails on the negative half for a different
        // reason than the positive one — both are the same bug.
        expect(Math.abs(db(positive))).toBeLessThanOrEqual(0.1);
        expect(Math.abs(db(negative))).toBeLessThanOrEqual(0.1);
      });
    }
  }
});

describe('every amp curve behaves like a saturator', () => {
  for (const model of AMP_MODELS) {
    it(`${model.id} never exceeds the WaveShaper's ±1 domain`, () => {
      // The curve is sampled over [-1, +1] and Web Audio clamps its INPUT to that
      // window. If the OUTPUT left the window too, the next stage would be handed
      // something it clamps into a flat chop. Nothing in the chain amplifies ahead
      // of a shaper, so keeping output bounded keeps the whole amp inside domain.
      for (const drive of DRIVES) {
        const curve = model.curve(drive);
        // Stepped by integer so the probe lands exactly on ±1 — `x += 0.01`
        // overshoots by 1.3e-15 and fails an identity curve on its own rounding.
        for (let i = -100; i <= 100; i++) {
          expect(Math.abs(curve(i / 100))).toBeLessThanOrEqual(1);
        }
      }
    });

    it(`${model.id} is monotonic — a saturator never folds back`, () => {
      for (const drive of DRIVES) {
        const curve = model.curve(drive);
        let previous = curve(-1);
        for (let i = -99; i <= 100; i++) {
          const value = curve(i / 100);
          expect(value).toBeGreaterThanOrEqual(previous - 1e-12);
          previous = value;
        }
      }
    });

    it(`${model.id} compresses at the top rather than amplifying at the bottom`, () => {
      // The defining property. A driven curve must give back LESS than a straight
      // line through the origin would — that difference is the compression. The
      // old shape had it backwards: unity at 1 and enormous gain below.
      const driven = model.curve(1);
      const out = driven(1);
      expect(out).toBeLessThan(1);
      expect(out).toBeGreaterThan(0);
    });

    it(`${model.id} is a clean pass-through at drive 0`, () => {
      const clean = model.curve(0);
      for (const x of [-1, -0.5, -0.01, 0, 0.01, 0.5, 1]) {
        expect(clean(x)).toBeCloseTo(x, 12);
      }
    });
  }
});

describe('asymmetry appears when driven, not at rest', () => {
  // `asymmetricSoftClip` normalises each lobe by its own endpoint, so today the
  // two halves have DIFFERENT small-signal gain — Crunch's pre-stage is +14.0 dB
  // going up and +9.6 dB going down. That is a standing DC offset at every level,
  // including a whisper. Even-harmonic character is supposed to come from the
  // shape under drive, not from a permanent imbalance.
  const asymmetric = ['fender-champ', 'marshall-plexi'];

  for (const id of asymmetric) {
    const model = AMP_MODELS.find((m) => m.id === id)!;

    it(`${id} has matched halves at small signal`, () => {
      for (const drive of DRIVES) {
        const { positive, negative } = slopes(model.curve(drive));
        expect(db(positive) - db(negative)).toBeCloseTo(0, 1);
      }
    });

    it(`${id} still clips the two halves differently when driven`, () => {
      // The character has to survive the fix. Removing the imbalance at the origin
      // must not flatten the model into a symmetric one.
      const driven = model.curve(0.8);
      expect(Math.abs(driven(1))).not.toBeCloseTo(Math.abs(driven(-1)), 3);
    });
  }

  for (const id of ['fender-twin', 'modern-high-gain']) {
    const model = AMP_MODELS.find((m) => m.id === id)!;

    it(`${id} stays odd-symmetric — push-pull cancels even harmonics`, () => {
      const driven = model.curve(0.8);
      for (const x of [0.1, 0.35, 0.7, 1]) {
        expect(driven(-x)).toBeCloseTo(-driven(x), 12);
      }
    });
  }
});
