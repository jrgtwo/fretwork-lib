/**
 * Feel — single-axis rhythmic concept that collapses two underlying settings
 * (click subdivision + swing on/off) into one user-facing choice.
 *
 *   Off              → no sub-clicks, no swing
 *   Straight 8ths    → 8th sub-clicks, no swing
 *   Swung 8ths       → 8th sub-clicks, off-beat 8ths shifted by swing intensity
 *   Triplets         → triplet sub-clicks, no swing (triplets group as 3s)
 *   Straight 16ths   → 16th sub-clicks, no swing
 *   Swung 16ths      → 16th sub-clicks, off-beat 16ths shifted by swing intensity
 *   Sextuplets       → sextuplet sub-clicks, no swing
 *
 * `Feel` is a derived view over `(subdivision, swing)`. The metronome and
 * pattern model continue to store the raw values; Feel exists only at the
 * UX layer.
 */
import type { SubdivisionId } from './types';

export type Feel =
  | 'off'
  | 'straight-8ths'
  | 'swung-8ths'
  | 'triplets'
  | 'straight-16ths'
  | 'swung-16ths'
  | 'sextuplets';

export const FEEL_OPTIONS: readonly Feel[] = [
  'off',
  'straight-8ths',
  'swung-8ths',
  'triplets',
  'straight-16ths',
  'swung-16ths',
  'sextuplets',
] as const;

export const FEEL_LABELS: Record<Feel, string> = {
  'off': 'Off',
  'straight-8ths': 'Straight 8ths',
  'swung-8ths': 'Swung 8ths',
  'triplets': 'Triplets',
  'straight-16ths': 'Straight 16ths',
  'swung-16ths': 'Swung 16ths',
  'sextuplets': 'Sextuplets',
};

/** Swing intensity slider is meaningful only for the two swung feels. */
export function feelIsSwung(feel: Feel): boolean {
  return feel === 'swung-8ths' || feel === 'swung-16ths';
}

/** Default swing value used when a feel transitions into a swung mode for the
 *  first time and no prior intensity was stored. */
export const DEFAULT_SWUNG_INTENSITY = 0.67;

/** Map a Feel to the underlying click subdivision. */
export function feelToSubdivision(feel: Feel): SubdivisionId {
  switch (feel) {
    case 'off': return 'off';
    case 'straight-8ths':
    case 'swung-8ths': return '8ths';
    case 'triplets': return 'triplets';
    case 'straight-16ths':
    case 'swung-16ths': return '16ths';
    case 'sextuplets': return 'sextuplets';
  }
}

/** Derive the Feel preset from the underlying (subdivision, swing) pair. */
export function deriveFeel(subdivision: SubdivisionId, swing: number): Feel {
  switch (subdivision) {
    case 'off': return 'off';
    case '8ths': return swing > 0.5 ? 'swung-8ths' : 'straight-8ths';
    case 'triplets': return 'triplets';
    case '16ths': return swing > 0.5 ? 'swung-16ths' : 'straight-16ths';
    case 'sextuplets': return 'sextuplets';
  }
}
