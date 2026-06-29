import { useMemo } from 'react';
import { useFretworkStore } from '../store/useFretworkStore';
import { getScale } from './scales';
import { getArpeggio } from './arpeggios';
import { spellInKey, intervalLabel } from './theory';
import type { IntervalSet } from '../types';

export interface ActiveTheoryNote {
  /** Note name spelled in the active key (e.g. "A", "C#"). */
  readonly note: string;
  /** Interval label for the degree (e.g. "1", "b3", "5"). */
  readonly interval: string;
}

export interface ActiveTheoryInfo {
  /** Display title, e.g. "A Minor Scale" / "C Major Arpeggio" / "E note". */
  readonly title: string;
  /** Short descriptive tag for the active scale/arpeggio (may be empty). */
  readonly tag: string;
  /** The interval set of the active scale/arpeggio (or [0] in notes mode). */
  readonly intervals: IntervalSet;
  /** Spelled note + interval-label pairs, ready to render. */
  readonly notes: readonly ActiveTheoryNote[];
}

/**
 * Derives the active scale / arpeggio / note info from the global fretwork state.
 *
 * This is the headless data behind what used to be the lib's `<InfoCard>`: a
 * consumer can render its own info panel from this return shape. Reads
 * `useFretworkStore` for the current mode/key/type.
 */
export function useActiveTheoryInfo(): ActiveTheoryInfo {
  const mode = useFretworkStore((s) => s.mode);
  const key = useFretworkStore((s) => s.key);
  const type = useFretworkStore((s) => s.type);

  return useMemo<ActiveTheoryInfo>(() => {
    let title = '';
    let tag = '';
    let intervals: IntervalSet = [];
    let rootForSpelling = key;

    if (mode === 'scales') {
      const scale = getScale(type);
      title = scale ? `${key} ${scale.name.replace(/ \(.*\)/, '')} Scale` : '';
      tag = scale?.tag ?? '';
      intervals = scale?.intervals ?? [];
      rootForSpelling = key;
    } else if (mode === 'arpeggios') {
      const arp = getArpeggio(type);
      title = arp ? `${key} ${arp.name} Arpeggio` : '';
      tag = arp?.tag ?? '';
      intervals = arp?.intervals ?? [];
      rootForSpelling = key;
    } else {
      title = `${type} note`;
      tag = 'All instances across the neck';
      intervals = [0];
      rootForSpelling = type;
    }

    const notes = intervals.map((iv) => ({
      note: spellInKey(rootForSpelling, iv),
      interval: intervalLabel(iv),
    }));

    return { title, tag, intervals, notes };
  }, [mode, key, type]);
}
