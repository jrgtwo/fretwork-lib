/**
 * Chord vocabulary for predefined harmony selections — the root × quality (×
 * optional slash-bass) options behind the harmony-lane dropdowns. Kept in one
 * place so the same vocabulary feeds built-in content and a future
 * "harmony → playable track" path (`voiceChordPreferred` voices a symbol).
 *
 * The split/join helpers decompose an existing symbol (incl. imported ones like
 * `G/B`, `Am7`) into parts so the selects can show its current value, and
 * recompose parts back into a symbol.
 */

/** Root note options (common 12, key-friendly spellings). */
export const CHORD_ROOTS = [
  'C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B',
] as const;

/** Chord quality options: `suffix` is appended to the root to form the symbol. */
export const CHORD_QUALITIES: readonly { suffix: string; label: string }[] = [
  { suffix: '', label: 'maj' },
  { suffix: 'm', label: 'min' },
  { suffix: '7', label: '7' },
  { suffix: 'maj7', label: 'maj7' },
  { suffix: 'm7', label: 'm7' },
  { suffix: 'm7b5', label: 'm7♭5' },
  { suffix: 'dim', label: 'dim' },
  { suffix: 'aug', label: 'aug' },
  { suffix: 'sus2', label: 'sus2' },
  { suffix: 'sus4', label: 'sus4' },
  { suffix: '6', label: '6' },
  { suffix: 'm6', label: 'm6' },
  { suffix: '9', label: '9' },
  { suffix: 'add9', label: 'add9' },
];

export interface ChordParts {
  /** Root note, e.g. "G", "Bb". */
  root: string;
  /** Quality suffix, e.g. "" (major), "m", "m7". */
  quality: string;
  /** Slash-bass note, or null. */
  bass: string | null;
}

/** Decompose a chord symbol into {root, quality, bass}. Tolerant of imports. */
export function splitChordSymbol(symbol: string): ChordParts {
  const [mainRaw, bassRaw] = (symbol ?? '').split('/');
  const main = (mainRaw ?? '').trim();
  const m = main.match(/^([A-G][#b]?)(.*)$/);
  return {
    root: m?.[1] ?? '',
    quality: (m?.[2] ?? '').trim(),
    bass: bassRaw?.trim() || null,
  };
}

/** Recompose {root, quality, bass} into a chord symbol. */
export function joinChordSymbol(p: ChordParts): string {
  const base = `${p.root}${p.quality}`;
  return p.bass ? `${base}/${p.bass}` : base;
}
