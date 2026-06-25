import type { TuningDef } from '../types';

/**
 * Tunings catalog. Each entry is tagged with `instrumentId` so the UI can filter
 * the list by the active instrument. Strings are stored in **physical bottom-to-top**
 * order (matches tab convention) — see TuningDef in types.ts for the reentrant-tuning
 * caveat.
 */
export const TUNINGS: readonly TuningDef[] = [
  // ─── Guitar (6-string) ─────────────────────────────────────────────────────
  { id: 'standard',       name: 'Standard',       instrumentId: 'guitar',  strings: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'] },
  { id: 'drop-d',         name: 'Drop D',         instrumentId: 'guitar',  strings: ['D2', 'A2', 'D3', 'G3', 'B3', 'E4'] },
  { id: 'dadgad',         name: 'DADGAD',         instrumentId: 'guitar',  strings: ['D2', 'A2', 'D3', 'G3', 'A3', 'D4'] },
  { id: 'open-g',         name: 'Open G',         instrumentId: 'guitar',  strings: ['D2', 'G2', 'D3', 'G3', 'B3', 'D4'] },
  { id: 'open-d',         name: 'Open D',         instrumentId: 'guitar',  strings: ['D2', 'A2', 'D3', 'F#3', 'A3', 'D4'] },
  { id: 'half-step-down', name: 'Half-Step Down', instrumentId: 'guitar',  strings: ['Eb2', 'Ab2', 'Db3', 'Gb3', 'Bb3', 'Eb4'] },

  // ─── Bass (4-string) ──────────────────────────────────────────────────────
  { id: 'bass-standard',  name: 'Standard',       instrumentId: 'bass',    strings: ['E1', 'A1', 'D2', 'G2'] },
  { id: 'bass-drop-d',    name: 'Drop D',         instrumentId: 'bass',    strings: ['D1', 'A1', 'D2', 'G2'] },

  // ─── Ukulele (4-string) ───────────────────────────────────────────────────
  // Standard ukulele is REENTRANT: high-G string sits at the physical bottom of the
  // fretboard, despite being pitched higher than the C and E strings above it.
  { id: 'ukulele-standard', name: 'Standard (reentrant)', instrumentId: 'ukulele', strings: ['G4', 'C4', 'E4', 'A4'] },
  { id: 'ukulele-low-g',    name: 'Low G',                instrumentId: 'ukulele', strings: ['G3', 'C4', 'E4', 'A4'] },
  { id: 'ukulele-baritone', name: 'Baritone',             instrumentId: 'ukulele', strings: ['D3', 'G3', 'B3', 'E4'] },
] as const;

const TUNING_BY_ID = new Map(TUNINGS.map((t) => [t.id, t]));

export function getTuning(id: string): TuningDef | undefined {
  return TUNING_BY_ID.get(id);
}

/** Tunings that belong to a given instrument. */
export function getTuningsForInstrument(instrumentId: string): TuningDef[] {
  return TUNINGS.filter((t) => t.instrumentId === instrumentId);
}

export const DEFAULT_TUNING_ID = 'standard';

/** All 12 chromatic note names with sharp spellings — used for the Key dropdown. */
export const CHROMATIC_KEYS = [
  'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B',
] as const;

/** Convenience type for the Notes mode — a single note name as the "type". */
export const CHROMATIC_NOTES = CHROMATIC_KEYS;
