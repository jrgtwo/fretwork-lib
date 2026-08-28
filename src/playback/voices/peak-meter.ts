/**
 * Sample-peak metering.
 *
 * ── Why this is not `Tone.Meter` ────────────────────────────────────────────
 *
 * `Tone.Meter` reports RMS, not peak. From its source:
 *
 *     const rms = Math.sqrt(totalSquared / values.length);
 *     this._rms[i] = Math.max(rms, this._rms[i] * this.smoothing);
 *     return gainToDb(this._rms[i]);
 *
 * Every meter in this library used to be one, including
 * `MasterBus.getOutputPeakDb()` — a method named "Peak", documented as
 * *"> 0 = clipping"*, reporting a statistic that on musical material essentially
 * never reaches 0. A plucked guitar note has a crest factor of roughly 12-20 dB,
 * so a comfortable-looking -10 dB reading is consistent with true peaks up to
 * +10 dBFS.
 *
 * That is why the artifacting was audible while nothing metered, and it is why
 * an early conclusion — *"not master clipping, `outPeak` sat between -3.7 and
 * -5.9 dB for a whole run"* — was wrong. It was read off this meter.
 *
 * ── What this does instead ──────────────────────────────────────────────────
 *
 * A `Tone.Analyser` in waveform mode, and the largest absolute sample in its
 * buffer.
 *
 * **SAMPLE peak, not TRUE peak** — and the difference is worth stating rather
 * than letting the name overpromise, since a name overpromising is exactly what
 * caused the bug this file fixes. True peak (ITU-R BS.1770) measures the
 * reconstructed analogue waveform, which requires oversampling; the signal
 * BETWEEN two samples can sit up to about 3 dB above the highest sample, and a
 * converter clips on that. So a reading of -1 dBFS here can still be an
 * intersample over at the DAC. What this catches is everything the previous RMS
 * meter averaged away, which is the great majority of it; intersample overs are
 * a separate and smaller problem, and `MasterBus.ts` already has a comment
 * saying its limiter cannot catch them either. No smoothing (the Web Audio spec applies `smoothingTimeConstant` to
 * frequency data only, so waveform reads are already raw) and no held state
 * here: several consumers poll these getters independently, so "the maximum
 * since YOUR last call" would give each of them a different answer. Holding is
 * the consumer's job, and both consumers already do it — `LevelMeter` holds a
 * falling peak, `audio-debug` holds a per-second maximum.
 */
import * as Tone from 'tone';

/**
 * Analyser window, in samples.
 *
 * Chosen so consecutive polls OVERLAP rather than leaving gaps. The UI samples
 * every 33 ms and the debug line every 50 ms; 2048 samples is 46 ms at 44.1 kHz
 * and 43 ms at 48 kHz. A window shorter than the polling interval means stretches
 * of signal nobody ever examines, and a transient landing in one of those gaps is
 * precisely what this exists to catch.
 *
 * Bigger is not free — it is this many floats copied per meter per poll, four
 * meters per voice-bearing track. 2048 buys the overlap without making the read
 * itself something worth profiling.
 */
export const PEAK_METER_SIZE = 2048;

/**
 * Largest absolute sample in a waveform buffer, in dBFS.
 *
 * Pure, and separated from the node so it can be tested against real sample data
 * instead of against a mock agreeing with itself — which is how the RMS-vs-peak
 * mistake survived a whole test suite.
 *
 * Returns `-Infinity` for silence or an empty buffer, and reports values ABOVE
 * 0 dBFS rather than clamping: past full scale is the one reading this exists to
 * show. The finiteness check is there for `±Infinity`, which would otherwise
 * compare greater than every real sample and pin the meter permanently; `NaN`
 * needs no guard, since `NaN > peak` is already false.
 */
export function peakDbFromSamples(value: Float32Array | Float32Array[]): number {
  const buffers = Array.isArray(value) ? value : [value];
  let peak = 0;
  for (const buffer of buffers) {
    for (let i = 0; i < buffer.length; i++) {
      const magnitude = Math.abs(buffer[i]);
      if (magnitude > peak && Number.isFinite(magnitude)) peak = magnitude;
    }
  }
  return peak > 0 ? 20 * Math.log10(peak) : -Infinity;
}

/** A waveform-mode analyser sized for {@link peakDbFromSamples}. Built as a
 *  sink — nothing connects downstream of it — so it costs a buffer copy per
 *  read and nothing else. */
export function createPeakMeter(): Tone.Analyser {
  return new Tone.Analyser({ type: 'waveform', size: PEAK_METER_SIZE });
}

/** Current sample peak at an analyser tap, in dBFS. `-Infinity` when the tap does
 *  not exist — silence and absence read the same on purpose, the same way they
 *  do in the app's meter plumbing. */
export function readPeakDb(analyser: Tone.Analyser | null | undefined): number {
  if (!analyser) return -Infinity;
  return peakDbFromSamples(analyser.getValue() as Float32Array | Float32Array[]);
}
