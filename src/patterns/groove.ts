/**
 * Named groove presets. The UI exposes these as a dropdown; "Custom" is a
 * synthetic option representing any (swing, appliedTo) pair that doesn't exactly
 * match a named preset.
 *
 * Swing values use the same [0.5, 0.75] range as the metronome's swing field
 * (Tone.js convention with 0.5 = straight).
 */
import type { GrooveSpec } from './types';

export type GroovePresetId =
  | 'straight'
  | 'swing-8ths'
  | 'shuffle'
  | '16th-swing'
  | 'custom';

export interface GroovePreset {
  id: Exclude<GroovePresetId, 'custom'>;
  label: string;
  /** Null = straight (no swing). */
  groove: GrooveSpec | null;
}

export const GROOVE_PRESETS: readonly GroovePreset[] = [
  { id: 'straight',    label: 'Straight',   groove: null },
  { id: 'swing-8ths',  label: 'Swing 8ths', groove: { swing: 0.67, appliedTo: 'eighths' } },
  { id: 'shuffle',     label: 'Shuffle',    groove: { swing: 0.72, appliedTo: 'eighths' } },
  { id: '16th-swing',  label: '16th Swing', groove: { swing: 0.6,  appliedTo: 'sixteenths' } },
];

/** Returns the id of the preset whose groove matches exactly, or 'custom' for
 *  any other non-null value. Null groove → 'straight'. */
export function presetMatching(groove: GrooveSpec | null): GroovePresetId {
  if (groove === null) return 'straight';
  for (const preset of GROOVE_PRESETS) {
    if (preset.groove === null) continue;
    if (preset.groove.swing === groove.swing && preset.groove.appliedTo === groove.appliedTo) {
      return preset.id;
    }
  }
  return 'custom';
}
