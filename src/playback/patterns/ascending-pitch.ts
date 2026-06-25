import type { PlaybackPattern } from '../types';
import { pitchOf } from '../../lib/fretboard';

export const ASCENDING_PITCH_ID = 'ascending-pitch';

/**
 * Walks the visible highlights in ascending MIDI pitch order. The most musical default
 * — listening to it sounds like a guitarist running the scale up the neck low to high.
 */
export const ascendingPitchPattern: PlaybackPattern = {
  id: ASCENDING_PITCH_ID,
  name: 'Ascending pitch',
  group: 'Walk',
  isApplicable: ({ highlights }) => highlights.length > 0,
  resolve: ({ highlights, tuning }) => {
    const cells = highlights.map((h) => ({ stringIndex: h.stringIndex, fret: h.fret }));
    return cells.sort((a, b) => pitchOf(a, tuning) - pitchOf(b, tuning));
  },
};
