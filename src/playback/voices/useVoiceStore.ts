import { create } from 'zustand';
import { persist, type PersistStorage, type StorageValue } from 'zustand/middleware';
import { generateUuid } from '../../patterns/ids';
import { gateCreate } from '../../subscription/gate';
import { ALL_SLOT_IDS, getInstrumentFirstDefaultSlotId, type SlotId } from './slots';
import type { Variant, VariantRef, ActiveVariantsMap } from './variant-types';
import { makeDefaultActiveVariants } from './variant-types';
import type { FretInstrumentId, ReverbSettings } from './types';
import { resolveActiveVoice } from './resolve-active-voice';
import { prefetchSampleBanks } from './sample-packs';

export const VOICE_STORAGE_KEY = 'fretwork:lab-presets:v1';
const SCHEMA_VERSION = 2;

/** Logged once per session if the variants blob outgrows sessionStorage's quota. */
let voiceQuotaWarned = false;

/** Map of legacy slot ids (renamed during the 2026-05-25 voicings rebuild) to
 *  their current equivalents. Lets us migrate stored activeVariants entries
 *  in place rather than forcing a schema bump that wipes user data. */
const LEGACY_SLOT_ID_MAP: Record<string, SlotId> = {
  'test-clean-amp': 'clean-amp',
  'test-crunch-amp': 'crunch-amp',
  'test-metal-amp': 'metal-amp',
};

/** Rewrite legacy slot ids in an ActiveVariantsMap and replace entries whose
 *  slot id no longer resolves with the instrument's default. Returns a fresh
 *  object — never mutates the input (ActiveVariantsMap fields are readonly). */
function migrateActiveVariants(map: ActiveVariantsMap): ActiveVariantsMap {
  const knownSlotIds = new Set<string>(ALL_SLOT_IDS);
  const migrateOne = (instrumentId: FretInstrumentId, ref: VariantRef): VariantRef => {
    if (ref.kind !== 'default') return ref;
    if (knownSlotIds.has(ref.slotId)) return ref;
    const replacement = LEGACY_SLOT_ID_MAP[ref.slotId];
    if (replacement) return { kind: 'default', slotId: replacement };
    return { kind: 'default', slotId: getInstrumentFirstDefaultSlotId(instrumentId) };
  };
  return {
    guitar: migrateOne('guitar', map.guitar),
    bass: migrateOne('bass', map.bass),
    ukulele: migrateOne('ukulele', map.ukulele),
  };
}

interface VoiceState {
  schemaVersion: number;
  variants: Variant[];
  activeVariants: ActiveVariantsMap;
  reverb: ReverbSettings | null;

  /** Create a new non-fork variant. Fork fields are auto-defaulted to null;
   *  forks must go through `forkVariant`. */
  addVariant(input: Omit<Variant, 'id' | 'forkedFromId' | 'forkedFromCreatorName'>): string;
  /** Fork a (typically public/unlisted) variant into the user's library. Mirrors
   *  forkPattern / forkComposition: fresh uuid, fork fields set, collectionId
   *  reset to null. Gated by the voice-variants tier cap. */
  forkVariant(source: Variant, sourceCreatorName?: string | null): string;
  updateVariant(id: string, patch: Partial<Omit<Variant, 'id'>>): void;
  renameVariant(id: string, name: string): void;
  setVariantCollection(id: string, collectionId: string | null): void;
  deleteVariant(id: string): void;
  /** Re-parent every variant that lives in `folderId` to root. Called from
   *  the folder-delete flow so variants don't end up orphaned with a stale
   *  collectionId after the patterns-store deletes the collection itself. */
  orphanVariantsInFolder(folderId: string): void;

  setActiveVariantRef(instrumentId: FretInstrumentId, ref: VariantRef): void;
  setReverb(reverb: ReverbSettings | null): void;

  rehydrateFromStorage(): void;
  reset(): void;
}

export const useVoiceStore = create<VoiceState>()(
  persist(
    (set, get) => ({
      schemaVersion: SCHEMA_VERSION,
      variants: [],
      activeVariants: makeDefaultActiveVariants(),
      reverb: null,

      addVariant(input) {
        // Tier cap: refuse and open signup/upgrade prompt at the Free cap.
        // Returns '' on refusal so callers can `if (!id) return;`, mirroring
        // `createPattern` / `createComposition` semantics.
        if (!gateCreate('voiceVariants', get().variants.length)) return '';
        const id = generateUuid();
        const variant: Variant = {
          ...input,
          id,
          forkedFromId: null,
          forkedFromCreatorName: null,
        };
        set((s) => ({ variants: [...s.variants, variant] }));
        return id;
      },

      forkVariant(source, sourceCreatorName) {
        if (!gateCreate('voiceVariants', get().variants.length)) return '';
        const id = generateUuid();
        const fork: Variant = {
          id,
          name: source.name,
          instrumentId: source.instrumentId,
          family: source.family,
          // Forks land at the forker's root; the source's collectionId belongs
          // to a different user's library.
          collectionId: null,
          preset: source.preset,
          forkedFromId: source.id,
          forkedFromCreatorName: sourceCreatorName ?? null,
        };
        set((s) => ({ variants: [...s.variants, fork] }));
        return id;
      },

      updateVariant(id, patch) {
        set((s) => ({
          variants: s.variants.map((v) => (v.id === id ? { ...v, ...patch } : v)),
        }));
      },

      renameVariant(id, name) {
        get().updateVariant(id, { name });
      },

      setVariantCollection(id, collectionId) {
        get().updateVariant(id, { collectionId });
      },

      orphanVariantsInFolder(folderId) {
        set((s) => ({
          variants: s.variants.map((v) =>
            v.collectionId === folderId ? { ...v, collectionId: null } : v,
          ),
        }));
      },

      deleteVariant(id) {
        const target = get().variants.find((v) => v.id === id);
        set((s) => ({ variants: s.variants.filter((v) => v.id !== id) }));
        if (!target) return;
        // If this variant was active for any instrument, fall back to that
        // instrument's first default per spec Section 2.
        const active = get().activeVariants;
        const updates: { -readonly [K in keyof ActiveVariantsMap]?: ActiveVariantsMap[K] } = {};
        for (const inst of ['guitar', 'bass', 'ukulele'] as FretInstrumentId[]) {
          const ref = active[inst];
          if (ref.kind === 'user' && ref.id === id) {
            updates[inst] = { kind: 'default', slotId: getInstrumentFirstDefaultSlotId(inst) };
          }
        }
        if (Object.keys(updates).length > 0) {
          set((s) => ({ activeVariants: { ...s.activeVariants, ...updates } }));
        }
      },

      setActiveVariantRef(instrumentId, ref) {
        set((s) => ({ activeVariants: { ...s.activeVariants, [instrumentId]: ref } }));
        // Fire-and-forget prefetch of the newly-active voice's sample URLs so
        // the browser cache is warm by the time the user hits Play. No-op for
        // non-sampler voices.
        const preset = resolveActiveVoice(instrumentId, ref);
        if (preset.source.kind === 'sampler') {
          prefetchSampleBanks(preset.source.samples);
        }
      },

      setReverb(reverb) {
        set({ reverb });
      },

      rehydrateFromStorage() {
        try {
          const raw = sessionStorage.getItem(VOICE_STORAGE_KEY);
          if (!raw) {
            set({ variants: [], activeVariants: makeDefaultActiveVariants(), reverb: null });
            return;
          }
          const parsed = JSON.parse(raw) as Partial<VoiceState>;
          if (!parsed || parsed.schemaVersion !== SCHEMA_VERSION) {
            set({ variants: [], activeVariants: makeDefaultActiveVariants(), reverb: null });
            return;
          }
          set({
            variants: parsed.variants ?? [],
            activeVariants: migrateActiveVariants(parsed.activeVariants ?? makeDefaultActiveVariants()),
            reverb: parsed.reverb ?? null,
          });
        } catch {
          set({ variants: [], activeVariants: makeDefaultActiveVariants(), reverb: null });
        }
      },

      reset() {
        set({
          schemaVersion: SCHEMA_VERSION,
          variants: [],
          activeVariants: makeDefaultActiveVariants(),
          reverb: null,
        });
      },
    }),
    {
      name: VOICE_STORAGE_KEY,
      // Custom flat storage: persist the partialized state at the top level of
      // the JSON blob (rather than nested under `{ state, version }`) so the
      // on-disk schema matches what `rehydrateFromStorage` reads. This keeps
      // the storage format simple and version-checks live next to the data.
      storage: {
        getItem: (name): StorageValue<Partial<VoiceState>> | null => {
          const raw = sessionStorage.getItem(name);
          if (!raw) return null;
          try {
            const parsed = JSON.parse(raw) as Partial<VoiceState>;
            if (parsed.schemaVersion !== SCHEMA_VERSION) return null;
            if (parsed.activeVariants) {
              parsed.activeVariants = migrateActiveVariants(parsed.activeVariants);
            }
            return { state: parsed, version: SCHEMA_VERSION };
          } catch {
            return null;
          }
        },
        setItem: (name, value: StorageValue<Partial<VoiceState>>) => {
          // Swallow QuotaExceededError so a large variants blob can't crash the
          // app on save (mirrors usePatternsStore's quotaTolerant band-aid). The
          // in-memory store stays correct; for signed-in users the cloud is the
          // source of truth, so the sessionStorage cache being partial is safe.
          try {
            sessionStorage.setItem(name, JSON.stringify(value.state));
          } catch (e) {
            const isQuota =
              e instanceof DOMException &&
              (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014);
            if (!isQuota) throw e;
            if (!voiceQuotaWarned) {
              voiceQuotaWarned = true;
              // eslint-disable-next-line no-console
              console.warn(
                '[voice presets] sessionStorage quota exceeded; in-memory state is correct, the sessionStorage cache is partial.',
              );
            }
          }
        },
        removeItem: (name) => sessionStorage.removeItem(name),
      } satisfies PersistStorage<Partial<VoiceState>>,
      partialize: (s) => ({
        schemaVersion: s.schemaVersion,
        variants: s.variants,
        activeVariants: s.activeVariants,
        reverb: s.reverb,
      }),
      version: SCHEMA_VERSION,
    },
  ),
);
