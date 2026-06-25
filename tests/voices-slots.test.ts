import { describe, it, expect } from 'vitest';
import {
  ALL_SLOT_IDS,
  getSlotsForInstrument,
  getInstrumentFirstDefaultSlotId,
  getDefaultPresetForSlot,
  parseSlotId,
} from '../src/playback/voices/slots';

describe('slots', () => {
  it('lists all five slots in canonical order', () => {
    expect(ALL_SLOT_IDS).toEqual([
      'acoustic-guitar',
      'electric-guitar',
      'acoustic-bass',
      'electric-bass',
      'acoustic-ukulele',
    ]);
  });

  it('returns slots for each instrument', () => {
    expect(getSlotsForInstrument('guitar')).toEqual(['acoustic-guitar', 'electric-guitar']);
    expect(getSlotsForInstrument('bass')).toEqual(['acoustic-bass', 'electric-bass']);
    expect(getSlotsForInstrument('ukulele')).toEqual(['acoustic-ukulele']);
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
