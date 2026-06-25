/**
 * Pure tick/region math for looped playback. No Tone, no side effects — fully
 * unit-testable. A loop region is the half-open tick range [loopStart, loopEnd).
 * In Wave 1 the region is always the whole timeline ([0, durationTicks)); the
 * generalized form is here so the Wave 2 loop-brace UI needs no engine rework.
 */

/** Map an absolute, monotonically-increasing transport tick into its position
 *  within the loop region [loopStart, loopEnd). With loopStart=0 and
 *  loopEnd=duration this is exactly `tick % duration`. A zero/negative-length
 *  region returns the tick unchanged (no wrap). */
export function wrapTick(tick: number, loopStart: number, loopEnd: number): number {
  const len = loopEnd - loopStart;
  if (len <= 0) return tick;
  const rel = tick - loopStart;
  return loopStart + (((rel % len) + len) % len);
}

/** Absolute tick at which the loop iteration currently containing `now` began.
 *  Iterations start at loopStart, loopStart+len, loopStart+2*len, ... */
export function currentIterationOffset(now: number, loopStart: number, loopEnd: number): number {
  const len = loopEnd - loopStart;
  if (len <= 0) return loopStart;
  const n = Math.floor((now - loopStart) / len);
  return loopStart + n * len;
}

/** Given the absolute ticks of one iteration's events (in stream order) and a
 *  `fromTick` floor, return the indices to schedule. Events at or behind the
 *  floor are skipped — they've already played on the current pass and will be
 *  picked up on the next loop iteration. */
export function selectIterationEvents(
  absoluteTicks: readonly number[],
  fromTick: number,
): number[] {
  const out: number[] = [];
  for (let i = 0; i < absoluteTicks.length; i++) {
    if (absoluteTicks[i] > fromTick) out.push(i);
  }
  return out;
}
