import type { PlaybackPattern, PlayableCell } from '../types';
import { FRET_COUNT } from '../../lib/fretboard';

export const CUSTOM_PATTERN_ID = 'custom';

/**
 * The "custom" pattern returns the user's recorded sequence verbatim. When in
 * programming mode the user clicks visible highlights to add cells to the sequence;
 * once finished, the metronome walks them in click order.
 *
 * Cells whose fret is outside the playable range (negative, > FRET_COUNT) are filtered
 * out as a safety net in case stale state persists across edits.
 */
export const customPattern: PlaybackPattern = {
  id: CUSTOM_PATTERN_ID,
  name: 'Custom',
  group: 'Custom',
  isApplicable: ({ customSequence }) => {
    return Boolean(customSequence && customSequence.length > 0);
  },
  resolve: ({ customSequence }) => {
    if (!customSequence) return [];
    const out: PlayableCell[] = [];
    for (const cell of customSequence) {
      if (cell.fret < 0 || cell.fret > FRET_COUNT) continue;
      out.push({ stringIndex: cell.stringIndex, fret: cell.fret });
    }
    return out;
  },
};
