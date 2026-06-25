import { describe, it, expect, beforeEach } from 'vitest';
import { useVoiceStore } from '../src/playback/voices/useVoiceStore';
import { resolveActiveVoice } from '../src/playback/voices/resolve-active-voice';
import { getDefaultPresetForSlot } from '../src/playback/voices/slots';

describe('resolveActiveVoice', () => {
  beforeEach(() => {
    sessionStorage.clear();
    useVoiceStore.getState().reset();
  });

  it('returns the shipped default when the active ref is a default', () => {
    const preset = resolveActiveVoice('guitar');
    expect(preset).toEqual(getDefaultPresetForSlot('acoustic-guitar'));
  });

  it('returns the user variant preset when the active ref is a user variant', () => {
    const fakePreset = { id: 'custom', name: 'custom' } as never;
    const id = useVoiceStore.getState().addVariant({
      name: 'My tone',
      instrumentId: 'guitar',
      family: 'electric',
      collectionId: null,
      preset: fakePreset,
    });
    useVoiceStore.getState().setActiveVariantRef('guitar', { kind: 'user', id });
    expect(resolveActiveVoice('guitar')).toBe(fakePreset);
  });

  it('falls back to the instrument first default when the user ref id is missing', () => {
    useVoiceStore.getState().setActiveVariantRef('bass', { kind: 'user', id: 'never-existed' });
    expect(resolveActiveVoice('bass')).toEqual(getDefaultPresetForSlot('acoustic-bass'));
  });
});
