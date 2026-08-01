import { describe, it, expect } from 'vitest';
import {
  ALL_SLOT_IDS,
  getSlotsForInstrument,
  getInstrumentFirstDefaultSlotId,
  getDefaultPresetForSlot,
  parseSlotId,
} from '../src/playback/voices/slots';

describe('slots', () => {
  it('lists every slot in canonical order', () => {
    expect(ALL_SLOT_IDS).toEqual([
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
    ]);
  });

  // Properties, not three hardcoded lists. The literal version claimed guitar had two
  // slots and went stale the moment the seven amp slots landed — it failed for being
  // old, not for catching anything. These hold however many slots exist.
  it('partitions every slot across the instruments, with none left over', () => {
    const partitioned = [
      ...getSlotsForInstrument('guitar'),
      ...getSlotsForInstrument('bass'),
      ...getSlotsForInstrument('ukulele'),
    ];
    expect([...partitioned].sort()).toEqual([...ALL_SLOT_IDS].sort());
  });

  it('files each slot under the instrument its own id parses to', () => {
    for (const instrumentId of ['guitar', 'bass', 'ukulele'] as const) {
      for (const slot of getSlotsForInstrument(instrumentId)) {
        expect(parseSlotId(slot).instrumentId).toBe(instrumentId);
      }
    }
  });

  it('returns the first default slot id per instrument (acoustic first)', () => {
    expect(getInstrumentFirstDefaultSlotId('guitar')).toBe('acoustic-guitar');
    expect(getInstrumentFirstDefaultSlotId('bass')).toBe('acoustic-bass');
    expect(getInstrumentFirstDefaultSlotId('ukulele')).toBe('acoustic-ukulele');
  });

  it('returns a VoicePreset for each slot id', () => {
    for (const slot of ALL_SLOT_IDS) {
      const preset = getDefaultPresetForSlot(slot);
      expect(preset).toBeDefined();
      expect(preset.id).toBeTypeOf('string');
    }
  });

  it('parses a slot id into instrument + family', () => {
    expect(parseSlotId('acoustic-guitar')).toEqual({ instrumentId: 'guitar', family: 'acoustic' });
    expect(parseSlotId('electric-bass')).toEqual({ instrumentId: 'bass', family: 'electric' });
  });
});
