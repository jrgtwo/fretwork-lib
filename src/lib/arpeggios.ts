import type { ArpeggioDef } from '../types';

export const ARPEGGIOS: readonly ArpeggioDef[] = [
  { id: 'major', name: 'Major', intervals: [0, 4, 7], tag: 'Triad' },
  { id: 'minor', name: 'Minor', intervals: [0, 3, 7], tag: 'Triad' },
  { id: 'diminished', name: 'Diminished', intervals: [0, 3, 6], tag: 'Triad' },
  { id: 'augmented', name: 'Augmented', intervals: [0, 4, 8], tag: 'Triad' },
  { id: 'sus2', name: 'Sus2', intervals: [0, 2, 7], tag: 'Suspended triad' },
  { id: 'sus4', name: 'Sus4', intervals: [0, 5, 7], tag: 'Suspended triad' },
  { id: 'dom7', name: 'Dominant 7', intervals: [0, 4, 7, 10], tag: 'Seventh' },
  { id: 'maj7', name: 'Major 7', intervals: [0, 4, 7, 11], tag: 'Seventh' },
  { id: 'min7', name: 'Minor 7', intervals: [0, 3, 7, 10], tag: 'Seventh' },
  { id: 'min-maj7', name: 'Minor-Major 7', intervals: [0, 3, 7, 11], tag: 'Seventh' },
  { id: 'half-dim7', name: 'Half-Diminished 7 (m7♭5)', intervals: [0, 3, 6, 10], tag: 'Seventh' },
  { id: 'dim7', name: 'Diminished 7', intervals: [0, 3, 6, 9], tag: 'Seventh' },
] as const;

const ARP_BY_ID = new Map(ARPEGGIOS.map((a) => [a.id, a]));

export function getArpeggio(id: string): ArpeggioDef | undefined {
  return ARP_BY_ID.get(id);
}

export const DEFAULT_ARPEGGIO_ID = 'maj7';
