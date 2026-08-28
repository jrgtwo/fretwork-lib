/**
 * True peak metering (AF-01 correction).
 *
 * ## The miss
 *
 * Every meter in this library was a `Tone.Meter`, and `Tone.Meter` reports
 * **RMS**, not peak:
 *
 *     const rms = Math.sqrt(totalSquared / values.length);
 *     this._rms[i] = Math.max(rms, this._rms[i] * this.smoothing);
 *     return gainToDb(this._rms[i]);
 *
 * A plucked guitar note has a crest factor of roughly 12-20 dB, so an RMS
 * reading of -10 dB is consistent with true peaks up to +10 dBFS. That is why
 * the user could hear digital clipping while every meter read comfortable — and
 * why `MasterBus.getOutputPeakDb()`, a method with "Peak" in its name and the
 * doc comment *"> 0 = clipping"*, was reporting a statistic that essentially
 * never goes above 0.
 *
 * It also cost a whole day of diagnosis: *"Not master clipping — `outPeak` sat
 * between -3.7 and -5.9 dB for a whole run"* was read off this meter, under a
 * variable named `outPeak`. At a typical crest factor those peaks were
 * +6 to +11 dBFS.
 *
 * ## What replaces it
 *
 * A `Tone.Analyser` in waveform mode, and the maximum absolute sample in its
 * buffer. The arithmetic is pulled out into a pure function so it can be tested
 * on real sample data rather than on a mocked meter agreeing with itself.
 */
import { describe, it, expect } from 'vitest';
import { peakDbFromSamples, PEAK_METER_SIZE } from '../src/playback/voices/peak-meter';

function samples(...values: number[]): Float32Array {
  return Float32Array.from(values);
}

describe('peakDbFromSamples', () => {
  it('reports the largest absolute sample, not the average', () => {
    // The whole defect in one assertion. RMS of this buffer is about 0.29
    // (-10.7 dB); the peak is 0.9 (-0.9 dB). Ten dB apart, and only one of them
    // tells you whether the next stage is going to clamp.
    const buffer = samples(0.05, 0.05, 0.9, 0.05, 0.05, 0.05, 0.05, 0.05);
    expect(peakDbFromSamples(buffer)).toBeCloseTo(20 * Math.log10(0.9), 6);
  });

  it('is sign-blind — a negative excursion clips exactly as hard', () => {
    expect(peakDbFromSamples(samples(0.1, -0.8, 0.2))).toBeCloseTo(20 * Math.log10(0.8), 6);
  });

  it('reads full scale as 0 dBFS', () => {
    expect(peakDbFromSamples(samples(0.2, 1, -0.3))).toBeCloseTo(0, 6);
  });

  it('reports ABOVE zero rather than pinning there', () => {
    // A meter that clamps at full scale hides the one number this exists to
    // show. Web Audio floats go past 1 and so does this.
    expect(peakDbFromSamples(samples(0.1, 1.5))).toBeCloseTo(20 * Math.log10(1.5), 6);
  });

  it('reads silence as -Infinity, not as zero dB', () => {
    expect(peakDbFromSamples(samples(0, 0, 0))).toBe(-Infinity);
    expect(peakDbFromSamples(samples())).toBe(-Infinity);
  });

  it('takes the loudest channel when handed several', () => {
    // `Analyser.getValue()` returns an array of buffers for a multichannel tap.
    // Metering the first channel only would miss a signal panned to the other.
    expect(peakDbFromSamples([samples(0.1, 0.2), samples(0.1, 0.7)])).toBeCloseTo(
      20 * Math.log10(0.7),
      6,
    );
  });

  it('ignores a non-finite sample rather than reporting an infinite level', () => {
    // `Infinity` is the case the finiteness check is actually for: it compares
    // greater than every real sample and would make the meter read `Infinity` dB
    // forever after. NaN needs no guard — `NaN > peak` is already false — and an
    // earlier version of this test claimed otherwise, which a mutation caught.
    expect(peakDbFromSamples(samples(0.4, Infinity, 0.2))).toBeCloseTo(20 * Math.log10(0.4), 6);
    expect(peakDbFromSamples(samples(0.4, -Infinity, 0.2))).toBeCloseTo(20 * Math.log10(0.4), 6);
    expect(peakDbFromSamples(samples(0.4, NaN, 0.2))).toBeCloseTo(20 * Math.log10(0.4), 6);
  });
});

describe('the analyser window', () => {
  it('is long enough that consecutive polls overlap', () => {
    // The UI polls every 33 ms and the debug line samples every 50 ms. A window
    // shorter than the gap between polls means signal nobody ever looks at, and
    // a transient landing in that gap is exactly what this is for. 2048 samples
    // is 46 ms at 44.1 kHz and 43 ms at 48 kHz — longer than the UI's interval,
    // and close enough at the debug line's that a miss needs a peak to fall in
    // a ~4 ms slot AND not recur within the second the line aggregates over.
    const shortestWindowMs = (PEAK_METER_SIZE / 48000) * 1000;
    expect(shortestWindowMs).toBeGreaterThan(33);
  });
});
