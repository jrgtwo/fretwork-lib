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

export function parseSlotId(slotId: SlotId): { instrumentId: FretInstrumentId; family: VoiceFamily } {
  const [family, instrumentId] = slotId.split('-') as [VoiceFamily, FretInstrumentId];
  return { instrumentId, family };
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
