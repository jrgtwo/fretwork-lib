/**
 * Anon → signed-in migration logic.
 *
 * When an anonymous user creates patterns / compositions during a tab session,
 * everything lives in `sessionStorage` (key `fretwork:patterns:v1`). After
 * they sign up, we offer to upload that session content into their cloud
 * account. This module provides the pure read/upload/clear primitives; the
 * MigrationPromptDialog component drives the UX.
 *
 * Reads sessionStorage directly rather than importing the patterns store to
 * keep this module independent of the patterns code (no circular deps; auth
 * is a lower layer than patterns).
 */
import { getSupabaseClient } from './supabaseClient';
import { useAuthStore } from './useAuthStore';
import { useVoiceStore, VOICE_STORAGE_KEY } from '../playback/voices/useVoiceStore';
import { DEFAULT_INSTRUMENT_ID } from '../lib/instruments';

const SESSION_STORAGE_KEY = 'fretwork:patterns:v1';
/** Tab-scoped flag that says "the migration prompt has already been resolved
 *  for this tab session." Survives reloads within the same tab; clears on
 *  tab close (sessionStorage lifetime). Without this, after Add/Discard, the
 *  cloud-sync hydration writes content back to sessionStorage, which would
 *  re-trigger the prompt on next render. */
const MIGRATION_DONE_KEY = 'fretwork:migration-done';

/** Minimal shape of what we read from session — just enough for counts and uploads. */
interface SessionLibraryItem {
  id: string;
  name: string;
  [key: string]: unknown;
}

interface SessionLibrary {
  patterns?: SessionLibraryItem[];
  compositions?: SessionLibraryItem[];
}

export interface MigrationCounts {
  patterns: number;
  compositions: number;
  /** User-authored voice variants in the Sound Lab during the anon session. */
  voiceVariants: number;
  /** Whether reverb has a custom override (counted as 1 if non-default). */
  reverbCustomized: boolean;
  total: number;
}

export interface MigrationResult {
  uploadedPatterns: number;
  uploadedCompositions: number;
  uploadedVoiceVariants: number;
  uploadedReverb: boolean;
  error: string | null;
}

/** Read the persisted session library blob without going through the patterns
 *  store. Tolerant of any malformed data — returns empty content on parse error. */
export function readSessionContent(): { patterns: SessionLibraryItem[]; compositions: SessionLibraryItem[] } {
  if (typeof sessionStorage === 'undefined') return { patterns: [], compositions: [] };
  try {
    const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return { patterns: [], compositions: [] };
    const parsed = JSON.parse(raw) as { state?: { library?: SessionLibrary } };
    const library = parsed?.state?.library;
    return {
      patterns: library?.patterns ?? [],
      compositions: library?.compositions ?? [],
    };
  } catch {
    return { patterns: [], compositions: [] };
  }
}

/** Count what's available to migrate. Returns zeros when nothing is staged. */
export function countSessionContent(): MigrationCounts {
  const c = readSessionContent();
  const voiceState = useVoiceStore.getState();
  const voiceVariants = voiceState.variants.length;
  const reverbCustomized = voiceState.reverb !== null;
  return {
    patterns: c.patterns.length,
    compositions: c.compositions.length,
    voiceVariants,
    reverbCustomized,
    total: c.patterns.length + c.compositions.length + voiceVariants + (reverbCustomized ? 1 : 0),
  };
}

/** Upload all session-storage patterns + compositions to the current user's
 *  cloud library. Each item becomes a new private row. Returns a counts +
 *  error result; partial success is possible (patterns might succeed even if
 *  compositions fail). */
export async function uploadSessionContent(): Promise<MigrationResult> {
  const content = readSessionContent();
  const voiceState = useVoiceStore.getState();
  const user = useAuthStore.getState().user;
  if (!user) {
    return {
      uploadedPatterns: 0,
      uploadedCompositions: 0,
      uploadedVoiceVariants: 0,
      uploadedReverb: false,
      error: 'Not signed in',
    };
  }

  let uploadedPatterns = 0;
  let uploadedCompositions = 0;
  let uploadedVoiceVariants = 0;
  let uploadedReverb = false;

  // The user just completed signup so the profile row exists with the chosen
  // display name. Snapshot it onto every shareable row we're about to insert
  // (see migration 0009 for why attribution is denormalized).
  const displayName = useAuthStore.getState().profile?.displayName ?? null;

  try {
    const client = getSupabaseClient();

    if (content.patterns.length > 0) {
      const rows = content.patterns.map((p) => ({
        user_id: user.id,
        name: typeof p.name === 'string' && p.name.length > 0 ? p.name : 'Untitled pattern',
        data: p,
        instrument_id: (p as { instrumentId?: string }).instrumentId ?? DEFAULT_INSTRUMENT_ID,
        created_by_display_name: displayName,
        visibility: 'private' as const,
      }));
      const { data, error } = await client.from('patterns').insert(rows).select();
      if (error) {
        return {
          uploadedPatterns,
          uploadedCompositions,
          uploadedVoiceVariants,
          uploadedReverb,
          error: `Patterns upload failed: ${error.message}`,
        };
      }
      uploadedPatterns = data?.length ?? 0;
    }

    if (content.compositions.length > 0) {
      const rows = content.compositions.map((c) => ({
        user_id: user.id,
        name: typeof c.name === 'string' && c.name.length > 0 ? c.name : 'Untitled composition',
        data: c,
        instrument_id: (c as { instrumentId?: string }).instrumentId ?? DEFAULT_INSTRUMENT_ID,
        created_by_display_name: displayName,
        visibility: 'private' as const,
      }));
      const { data, error } = await client.from('compositions').insert(rows).select();
      if (error) {
        return {
          uploadedPatterns,
          uploadedCompositions,
          uploadedVoiceVariants,
          uploadedReverb,
          error: `Compositions upload failed: ${error.message}`,
        };
      }
      uploadedCompositions = data?.length ?? 0;
    }

    // User-authored voice variants → voice_presets rows.
    if (voiceState.variants.length > 0) {
      const rows = voiceState.variants.map((v) => ({
        id: v.id,
        user_id: user.id,
        name: v.name,
        instrument_id: v.instrumentId,
        family: v.family,
        collection_id: v.collectionId,
        data: v.preset,
        created_by_display_name: displayName,
        visibility: 'private' as const,
        forked_from_id: v.forkedFromId,
        forked_from_creator_name: v.forkedFromCreatorName,
      }));
      const { data, error } = await client.from('voice_presets').insert(rows).select();
      if (error) {
        return {
          uploadedPatterns,
          uploadedCompositions,
          uploadedVoiceVariants,
          uploadedReverb,
          error: `Voice variants upload failed: ${error.message}`,
        };
      }
      uploadedVoiceVariants = data?.length ?? 0;
    }

    // active_variants + reverb come along with the upload via user_settings
    // singleton (upsert by user_id PK).
    const { error: settingsErr } = await client.from('user_settings').upsert({
      user_id: user.id,
      active_presets: voiceState.activeVariants,
      reverb: voiceState.reverb,
    });
    if (settingsErr) {
      return {
        uploadedPatterns,
        uploadedCompositions,
        uploadedVoiceVariants,
        uploadedReverb,
        error: `User settings upload failed: ${settingsErr.message}`,
      };
    }
    uploadedReverb = voiceState.reverb !== null;

    return {
      uploadedPatterns,
      uploadedCompositions,
      uploadedVoiceVariants,
      uploadedReverb,
      error: null,
    };
  } catch (e) {
    return {
      uploadedPatterns,
      uploadedCompositions,
      uploadedVoiceVariants,
      uploadedReverb,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Clear the session-storage patterns library + voice variants. Idempotent —
 *  safe to call when the user picks Discard, or after a successful Add to
 *  prevent re-prompting. */
export function clearSessionContent(): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
    useVoiceStore.getState().reset();
    sessionStorage.removeItem(VOICE_STORAGE_KEY);
  } catch {
    // Storage may throw in private-browsing modes or quota-exceeded states.
  }
}

/** Mark the migration prompt as already-resolved for this tab session. After
 *  this is set, `shouldShowMigrationPrompt()` returns false even if the
 *  cloud-sync layer later writes content back to sessionStorage. */
export function markMigrationResolved(): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(MIGRATION_DONE_KEY, '1');
  } catch {
    // ignore — failing to set the flag just means we re-prompt next render,
    // which is recoverable.
  }
}

/** True if the migration prompt has been resolved for this tab session. */
export function hasMigrationBeenResolved(): boolean {
  if (typeof sessionStorage === 'undefined') return false;
  try {
    return sessionStorage.getItem(MIGRATION_DONE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Clear the migration-done flag along with content. Used by cloud-sync teardown
 *  on sign-out so a subsequent anon→signup flow can re-trigger the prompt. */
export function clearMigrationFlag(): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.removeItem(MIGRATION_DONE_KEY);
  } catch {
    // ignore
  }
}
