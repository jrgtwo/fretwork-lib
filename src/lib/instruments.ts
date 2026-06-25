/**
 * Instrument definitions — the catalog of fretted instruments the app knows about.
 *
 * Each entry describes the structural shape of the instrument: how many strings,
 * how many frets, and which tuning is the natural default. The actual tunings live
 * in tunings.ts (each tagged with `instrumentId`); the actual playback patterns
 * live in playback/patterns/ (each optionally tagged with `applicableInstruments`).
 *
 * Adding a new instrument:
 *   1. Add an entry here.
 *   2. Add tunings tagged with the new instrument id in tunings.ts.
 *   3. (Optional) Add instrument-specific patterns tagged with `applicableInstruments`.
 *   4. The renderer + UI pick up the new instrument automatically.
 */

export interface InstrumentDef {
  readonly id: string;
  readonly name: string;
  /** Number of strings on this instrument. */
  readonly stringCount: number;
  /** Number of fretted positions (excluding the open string). */
  readonly fretCount: number;
  /** ID of the default tuning shown when this instrument is first selected. */
  readonly defaultTuningId: string;
  /** Whether the user can place a capo on this instrument. All v1 instruments support it. */
  readonly supportsCapo: boolean;
}

export const INSTRUMENTS: readonly InstrumentDef[] = [
  {
    id: 'guitar',
    name: 'Guitar',
    stringCount: 6,
    fretCount: 22,
    defaultTuningId: 'standard',
    supportsCapo: true,
  },
  {
    id: 'bass',
    name: 'Bass',
    stringCount: 4,
    fretCount: 21,
    defaultTuningId: 'bass-standard',
    supportsCapo: true,
  },
  {
    id: 'ukulele',
    name: 'Ukulele',
    stringCount: 4,
    fretCount: 15,
    defaultTuningId: 'ukulele-standard',
    supportsCapo: true,
  },
];

const BY_ID = new Map(INSTRUMENTS.map((i) => [i.id, i]));

export function getInstrument(id: string): InstrumentDef | undefined {
  return BY_ID.get(id);
}

export const DEFAULT_INSTRUMENT_ID = 'guitar';
