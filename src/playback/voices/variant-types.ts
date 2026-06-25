import type { FretInstrumentId, VoiceFamily, VoicePreset } from './types';
import type { SlotId } from './slots';

/** A user-created variant — has its own uuid, lives in a folder, edits the preset payload. */
export interface Variant {
  readonly id: string;
  readonly name: string;
  readonly instrumentId: FretInstrumentId;
  readonly family: VoiceFamily;
  readonly collectionId: string | null;
  readonly preset: VoicePreset;
  /** UUID of the variant this was forked from, or null. */
  readonly forkedFromId: string | null;
  /** Display name of the user who created the source variant at fork-time.
   *  Denormalized snapshot, set once when the fork is created. Null when this
   *  variant isn't a fork or when the source had no attribution snapshot. */
  readonly forkedFromCreatorName: string | null;
}

/** Reference to whatever variant is currently active for an instrument. */
export type VariantRef =
  | { readonly kind: 'default'; readonly slotId: SlotId }
  | { readonly kind: 'user'; readonly id: string };

export interface ActiveVariantsMap {
  readonly guitar: VariantRef;
  readonly bass: VariantRef;
  readonly ukulele: VariantRef;
}

export function makeDefaultActiveVariants(): ActiveVariantsMap {
  return {
    guitar: { kind: 'default', slotId: 'acoustic-guitar' },
    bass: { kind: 'default', slotId: 'acoustic-bass' },
    ukulele: { kind: 'default', slotId: 'acoustic-ukulele' },
  };
}
