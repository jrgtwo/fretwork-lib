import { describe, it, expect, beforeEach } from 'vitest';
import { useVoiceStore, VOICE_STORAGE_KEY } from '../src/playback/voices/useVoiceStore';
import { makeDefaultActiveVariants } from '../src/playback/voices/variant-types';
import { DEFAULT_REVERB_SETTINGS } from '../src/playback/voices/types';

function reset() {
  sessionStorage.clear();
  useVoiceStore.setState({
    variants: [],
    activeVariants: makeDefaultActiveVariants(),
    reverb: null,
    schemaVersion: 2,
  });
}

describe('useVoiceStore', () => {
  beforeEach(reset);

  it('starts with no user variants and all-default active refs', () => {
    const s = useVoiceStore.getState();
    expect(s.variants).toEqual([]);
    expect(s.activeVariants).toEqual(makeDefaultActiveVariants());
  });

  it('addVariant appends a variant and returns the id', () => {
    const id = useVoiceStore.getState().addVariant({
      name: 'Test',
      instrumentId: 'guitar',
      family: 'acoustic',
      collectionId: null,
      preset: { /* shape is loose for this test */ } as never,
    });
    const variants = useVoiceStore.getState().variants;
    expect(variants).toHaveLength(1);
    expect(variants[0].id).toBe(id);
    expect(variants[0].name).toBe('Test');
  });

  it('renameVariant updates the name', () => {
    const id = useVoiceStore.getState().addVariant({
      name: 'Old',
      instrumentId: 'guitar',
      family: 'electric',
      collectionId: null,
      preset: {} as never,
    });
    useVoiceStore.getState().renameVariant(id, 'New');
    expect(useVoiceStore.getState().variants[0].name).toBe('New');
  });

  it('deleteVariant removes the variant and falls back active ref to the instrument default', () => {
    const id = useVoiceStore.getState().addVariant({
      name: 'Active',
      instrumentId: 'guitar',
      family: 'electric',
      collectionId: null,
      preset: {} as never,
    });
    useVoiceStore.getState().setActiveVariantRef('guitar', { kind: 'user', id });
    useVoiceStore.getState().deleteVariant(id);
    expect(useVoiceStore.getState().variants).toHaveLength(0);
    expect(useVoiceStore.getState().activeVariants.guitar).toEqual({
      kind: 'default',
      slotId: 'acoustic-guitar',
    });
  });

  it('persists to sessionStorage on change', () => {
    useVoiceStore.getState().addVariant({
      name: 'Persist me',
      instrumentId: 'guitar',
      family: 'acoustic',
      collectionId: null,
      preset: {} as never,
    });
    const raw = sessionStorage.getItem(VOICE_STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.schemaVersion).toBe(2);
    expect(parsed.variants).toHaveLength(1);
  });

  it('drops session storage data with mismatched schemaVersion', () => {
    sessionStorage.setItem(
      VOICE_STORAGE_KEY,
      JSON.stringify({ schemaVersion: 1, presets: { foo: 'bar' } }),
    );
    useVoiceStore.getState().rehydrateFromStorage();
    expect(useVoiceStore.getState().variants).toEqual([]);
  });

  it('setReverb persists reverb settings', () => {
    useVoiceStore.getState().setReverb({ ...DEFAULT_REVERB_SETTINGS, decay: 3.0 });
    expect(useVoiceStore.getState().reverb?.decay).toBe(3.0);
  });
});
