import type { FretInstrumentId, VoicePreset } from './types';
import type { VariantRef } from './variant-types';
import { useVoiceStore } from './useVoiceStore';
import { getDefaultPresetForSlot, getInstrumentFirstDefaultSlotId } from './slots';

/** Resolve the VoicePreset that playback should use for the given instrument.
 *  Order: user variant → default slot → instrument first default. Anything
 *  missing or broken falls through cleanly to the first default.
 *
 *  When `explicitRef` is provided (e.g. a Composition Track that picked a
 *  specific voice), that ref is used directly — bypassing the global
 *  `activeVariants` setting. This lets two tracks of the same instrument
 *  pick different voices.
 */
export function resolveActiveVoice(
  instrumentId: FretInstrumentId,
  explicitRef?: VariantRef | null,
): VoicePreset {
  const state = useVoiceStore.getState();
  const ref: VariantRef = explicitRef ?? state.activeVariants[instrumentId];
  // Fall back to the instrument's first default if the saved slot id no
  // longer exists. This protects against preset renames (e.g. when 2026-05-25
  // renamed `test-*-amp` slots to `clean-amp`/`crunch-amp`/`metal-amp`) —
  // without the fallback the app would crash on boot for any user whose
  // localStorage held the old id.
  try {
    if (ref.kind === 'default') {
      return getDefaultPresetForSlot(ref.slotId);
    }
    const variant = state.variants.find((v) => v.id === ref.id);
    if (variant) return variant.preset;
  } catch {
    // No-op — fall through to the instrument default below.
  }
  return getDefaultPresetForSlot(getInstrumentFirstDefaultSlotId(instrumentId));
}
