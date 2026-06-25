import type { ScaleDef } from '../types';

/**
 * Scale definitions as semitone offsets from the root.
 * Authoritative list; the Type dropdown in Scales mode is driven by this array's order.
 */
export const SCALES: readonly ScaleDef[] = [
  { id: 'major', name: 'Major (Ionian)', intervals: [0, 2, 4, 5, 7, 9, 11], tag: 'Diatonic · Mode I' },
  { id: 'dorian', name: 'Dorian', intervals: [0, 2, 3, 5, 7, 9, 10], tag: 'Diatonic · Mode II' },
  { id: 'phrygian', name: 'Phrygian', intervals: [0, 1, 3, 5, 7, 8, 10], tag: 'Diatonic · Mode III' },
  { id: 'lydian', name: 'Lydian', intervals: [0, 2, 4, 6, 7, 9, 11], tag: 'Diatonic · Mode IV' },
  { id: 'mixolydian', name: 'Mixolydian', intervals: [0, 2, 4, 5, 7, 9, 10], tag: 'Diatonic · Mode V' },
  { id: 'minor', name: 'Natural Minor (Aeolian)', intervals: [0, 2, 3, 5, 7, 8, 10], tag: 'Diatonic · Mode VI' },
  { id: 'locrian', name: 'Locrian', intervals: [0, 1, 3, 5, 6, 8, 10], tag: 'Diatonic · Mode VII' },
  { id: 'harmonic-minor', name: 'Harmonic Minor', intervals: [0, 2, 3, 5, 7, 8, 11], tag: 'Minor · raised 7' },
  { id: 'melodic-minor', name: 'Melodic Minor', intervals: [0, 2, 3, 5, 7, 9, 11], tag: 'Minor · raised 6 & 7' },
  { id: 'major-pentatonic', name: 'Major Pentatonic', intervals: [0, 2, 4, 7, 9], tag: 'Pentatonic' },
  { id: 'minor-pentatonic', name: 'Minor Pentatonic', intervals: [0, 3, 5, 7, 10], tag: 'Pentatonic' },
  { id: 'blues', name: 'Blues', intervals: [0, 3, 5, 6, 7, 10], tag: 'Pentatonic + b5' },
] as const;

const SCALE_BY_ID = new Map(SCALES.map((s) => [s.id, s]));

export function getScale(id: string): ScaleDef | undefined {
  return SCALE_BY_ID.get(id);
}

export const DEFAULT_SCALE_ID = 'major';
