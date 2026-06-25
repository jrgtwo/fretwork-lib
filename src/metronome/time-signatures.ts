import type { TimeSignature } from './types';

/**
 * Curated list of supported time signatures. The Type dropdown in the example app's
 * metronome control reads from this in order. Custom time signatures are not supported
 * in v1 — keeping the surface curated avoids edge cases like 13/16 with weird accents.
 */
export const TIME_SIGNATURES: readonly TimeSignature[] = [
  { id: '2/4',  numerator: 2,  denominator: 4, defaultAccents: [0] },
  { id: '3/4',  numerator: 3,  denominator: 4, defaultAccents: [0] },
  { id: '4/4',  numerator: 4,  denominator: 4, defaultAccents: [0] },
  { id: '5/4',  numerator: 5,  denominator: 4, defaultAccents: [0, 3] },
  { id: '6/8',  numerator: 6,  denominator: 8, defaultAccents: [0, 3] },
  { id: '7/8',  numerator: 7,  denominator: 8, defaultAccents: [0, 2, 4] },
  { id: '9/8',  numerator: 9,  denominator: 8, defaultAccents: [0, 3, 6] },
  { id: '12/8', numerator: 12, denominator: 8, defaultAccents: [0, 3, 6, 9] },
] as const;

const BY_ID = new Map(TIME_SIGNATURES.map((ts) => [ts.id, ts]));

/** Look up a time signature by its `id` (e.g. "4/4"). Returns undefined for unknown ids. */
export function getTimeSignature(id: string): TimeSignature | undefined {
  return BY_ID.get(id);
}

export const DEFAULT_TIME_SIGNATURE_ID = '4/4';

/**
 * The Tone.js subdivision string representing one tick of the given time signature.
 * Example: 4/4 → '4n' (quarter), 6/8 → '8n' (eighth), 2/2 → '2n' (half).
 */
export function tickSubdivision(ts: TimeSignature): '2n' | '4n' | '8n' | '16n' {
  switch (ts.denominator) {
    case 2: return '2n';
    case 4: return '4n';
    case 8: return '8n';
    case 16: return '16n';
  }
}
