import type { FretInstrumentId, VoiceFamily, VoicePreset } from './types';
import { VOICE_PRESETS } from './presets';

export type SlotId =
  | 'acoustic-guitar'
  | 'electric-guitar'
  | 'karoryfer-green-guitar'
  | 'karoryfer-black-guitar'
  | 'clean-amp'
  | 'blues-amp'
  | 'crunch-amp'
  | 'lead-amp'
  | 'metal-amp'
  | 'surf-amp'
  | 'ambient-amp'
  | 'acoustic-bass'
  | 'electric-bass'
  | 'acoustic-ukulele';

export const ALL_SLOT_IDS: readonly SlotId[] = [
  'acoustic-guitar',
  'electric-guitar',
  'karoryfer-green-guitar',
  'karoryfer-black-guitar',
  'clean-amp',
  'blues-amp',
  'crunch-amp',
  'lead-amp',
  'metal-amp',
  'surf-amp',
  'ambient-amp',
  'acoustic-bass',
  'electric-bass',
  'acoustic-ukulele',
] as const;

const SLOTS_BY_INSTRUMENT: Record<FretInstrumentId, readonly SlotId[]> = {
  guitar: [
    'acoustic-guitar',
    'electric-guitar',
    'karoryfer-green-guitar',
    'karoryfer-black-guitar',
    'clean-amp',
    'blues-amp',
    'crunch-amp',
    'lead-amp',
    'metal-amp',
    'surf-amp',
    'ambient-amp',
  ],
  bass: ['acoustic-bass', 'electric-bass'],
  ukulele: ['acoustic-ukulele'],
};

export function getSlotsForInstrument(instrumentId: FretInstrumentId): readonly SlotId[] {
  return SLOTS_BY_INSTRUMENT[instrumentId];
}

export function getInstrumentFirstDefaultSlotId(instrumentId: FretInstrumentId): SlotId {
  return SLOTS_BY_INSTRUMENT[instrumentId][0];
}

/**
 * Read a slot's instrument and family off the preset it names.
 *
 * NOT parsed from the id. This used to be `slotId.split('-')` on a
 * `<family>-<instrumentId>` assumption that only ever held for the five original
 * slots: it reported `instrumentId: 'amp'` for all seven amp slots and `'green'` /
 * `'black'` for the karoryfer guitars — 9 of 14 wrong. `getDefaultPresetForSlot`
 * below already sidestepped it for exactly this reason rather than fixing it here,
 * so the two functions disagreed about what a slot id meant.
 *
 * The preset is the authority: it carries its own `instrumentId` and `family`.
 */
export function parseSlotId(slotId: SlotId): { instrumentId: FretInstrumentId; family: VoiceFamily } {
  const preset = getDefaultPresetForSlot(slotId);
  return { instrumentId: preset.instrumentId, family: preset.family };
}

export function getDefaultPresetForSlot(slotId: SlotId): VoicePreset {
  // Direct preset-id lookup — every shipped preset's `id` matches its slot id.
  // This avoids parseSlotId's `<family>-<instrumentId>` assumption, which
  // doesn't hold for slots whose names include the source/brand (e.g. the
  // karoryfer-* guitars).
  const preset = VOICE_PRESETS.find((p) => p.id === slotId);
  if (!preset) {
    throw new Error(`No shipped preset found for slot ${slotId}`);
  }
  return preset;
}
