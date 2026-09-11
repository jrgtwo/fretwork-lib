/**
 * The magnitude of a curve's nth harmonic, in BOTH quadratures.
 *
 * ⚠ A SINE-ONLY BIN IS BLIND TO EVEN HARMONICS. For any memoryless `f` driven
 * by `A·sin(t)` the output satisfies `g(π−t) = g(t)`, which forces every even
 * harmonic's sine coefficient to zero — they live entirely in cosine. A
 * sine-only projection reads 3.1e-17 on `x => x*x`, whose true h2 is 0.32.
 *
 * Shared rather than copied because two test files measure push-pull
 * cancellation with it, and a second copy is a second place for that bug to
 * come back.
 */
export function harmonic(f: (x: number) => number, n: number, drive = 0.8): number {
  return harmonicOfPhase((t) => f(drive * Math.sin(t)), n);
}

/**
 * The same bin for a function already parameterised by PHASE.
 *
 * Needed where the paths being summed carry different phase shifts — two
 * inverter legs behind different filters, say — and so cannot be written as one
 * memoryless map of a single input.
 */
export function harmonicOfPhase(g: (t: number) => number, n: number): number {
  const N = 4096;
  let re = 0;
  let im = 0;
  for (let i = 0; i < N; i++) {
    const t = (2 * Math.PI * i) / N;
    const y = g(t);
    re += y * Math.cos(n * t);
    im += y * Math.sin(n * t);
  }
  return Math.hypot((2 * re) / N, (2 * im) / N);
}
