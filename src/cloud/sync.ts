/**
 * Cloud sync for patterns + compositions.
 *
 * Strategy:
 *   - On sign-in: fetch all of the user's rows from Supabase and hydrate
 *     the patterns store. Take a "snapshot" of what we just loaded so future
 *     diffs work.
 *   - On every store mutation (after sign-in): diff current state vs the
 *     snapshot. Inserts go up as INSERT, updates as UPDATE, deletions as
 *     DELETE. Debounced 500ms so rapid edits coalesce.
 *   - Hydration writes set an `isHydrating` flag so the change subscriber
 *     skips uploads during the load — otherwise we'd try to upload what we
 *     just downloaded.
 *   - On sign-out: clear the in-memory store + sessionStorage so cloud
 *     content doesn't leak to a subsequent anon session in the same tab.
 *
 * Used via the `useCloudSync()` React hook — mount it once at the app root
 * (alongside `useAuth()`).
 */
import { useEffect } from 'react';
import { getSupabaseClient } from '../auth/supabaseClient';
import { useAuthStore } from '../auth/useAuthStore';
import { clearMigrationFlag } from '../auth/migration';
import {
  usePatternsStore,
  DEFAULT_PATTERNS_STATE,
} from '../patterns/store/usePatternsStore';
import type { Collection, Composition, Pattern } from '../patterns';
import { migrateCompositionToTracks } from '../patterns/composition-ops';
import { useVoiceStore, VOICE_STORAGE_KEY } from '../playback/voices/useVoiceStore';
import { makeDefaultActiveVariants } from '../playback/voices/variant-types';
import type { Variant, ActiveVariantsMap } from '../playback/voices/variant-types';
import type {
  FretInstrumentId,
  VoiceFamily,
  VoicePreset,
  ReverbSettings,
} from '../playback/voices/types';

// ─── Module-level sync state ──────────────────────────────────────────────

let isHydrating = false;
let lastPatternsSnapshot: Pattern[] = [];
let lastCompositionsSnapshot: Composition[] = [];
let lastCollectionsSnapshot: Collection[] = [];
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let storeUnsubscribe: (() => void) | null = null;
let currentUserId: string | null = null;

/** Lab sync state. `labRowIdByVariantId` maps variant uuid → DB row id; since
 *  variants now carry their own uuids and we use the same uuid for the row id
 *  on insert, this is effectively identity, but we keep the map for future
 *  flexibility (e.g. if a server-side id ever diverges). The snapshots are
 *  serialized JSON strings keyed by variant id so we can diff cheaply. */
let labRowIdByVariantId: Map<string, string> = new Map();
let lastVariantsSnapshot: Map<string, string> = new Map();
let lastActiveVariantsSnapshot: string = JSON.stringify(makeDefaultActiveVariants());
let lastReverbSnapshot: string = 'null';
let labUnsubscribe: (() => void) | null = null;

const DEBOUNCE_MS = 500;
const SESSION_STORAGE_KEY = 'fretwork:patterns:v1';

// ─── Public hook ──────────────────────────────────────────────────────────

/**
 * useCloudSync — mount once at the app root.
 *
 * Watches `useAuthStore.user` and activates / deactivates the sync subscription
 * accordingly. Idempotent: re-mounting doesn't double-subscribe.
 *
 * Hydration is deferred while migration is pending — otherwise we'd race the
 * MigrationPromptDialog: cloud sync would fetch empty cloud and overwrite the
 * sessionStorage that the migration was about to upload from. We hold back
 * until `migrationResolved` flips true (set by MigrationPromptDialog on Add/Discard).
 */
export function useCloudSync(): void {
  const user = useAuthStore((s) => s.user);
  const status = useAuthStore((s) => s.status);
  const migrationResolved = useAuthStore((s) => s.migrationResolved);

  useEffect(() => {
    // Only sync once the user is fully signed in (profile loaded). 'needs-profile'
    // means we're authenticated but haven't created our profile row yet.
    if (status !== 'signed-in' || !user) {
      if (currentUserId) {
        teardownSync();
      }
      return;
    }
    if (currentUserId === user.id) {
      // Already syncing for this user.
      return;
    }

    // Defer hydration if there's anon session content waiting to be migrated.
    // We wait for `migrationResolved` to flip (set by the migration prompt)
    // before fetching cloud data, otherwise hydration clobbers the
    // pre-migration sessionStorage content.
    const hasPendingMigration = pendingMigrationContent() && !migrationResolved;
    if (hasPendingMigration) return;

    if (currentUserId) teardownSync();
    void initializeSync(user.id);
  }, [user, status, migrationResolved]);
}

/** Quick check: is there anon-authored content in sessionStorage that hasn't
 *  been migrated yet? Used to decide whether to defer cloud hydration. */
function pendingMigrationContent(): boolean {
  if (typeof sessionStorage === 'undefined') return false;
  try {
    const patternsRaw = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (patternsRaw) {
      const parsed = JSON.parse(patternsRaw) as { state?: { library?: { patterns?: unknown[]; compositions?: unknown[] } } };
      const lib = parsed?.state?.library;
      if ((lib?.patterns?.length ?? 0) > 0 || (lib?.compositions?.length ?? 0) > 0) return true;
    }
    const labRaw = sessionStorage.getItem(VOICE_STORAGE_KEY);
    if (labRaw) {
      const parsed = JSON.parse(labRaw) as { variants?: unknown[]; reverb?: unknown };
      if ((parsed?.variants?.length ?? 0) > 0) return true;
      if (parsed?.reverb) return true;
    }
  } catch {
    // ignore — treat as no pending content
  }
  return false;
}

// ─── Internal: initialization & teardown ──────────────────────────────────

async function initializeSync(userId: string): Promise<void> {
  currentUserId = userId;
  await Promise.all([hydrateFromCloud(userId), hydrateLabFromCloud(userId)]);
  installStoreSubscription();
  installLabSubscription();
}

function teardownSync(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  if (storeUnsubscribe) {
    storeUnsubscribe();
    storeUnsubscribe = null;
  }
  if (labUnsubscribe) {
    labUnsubscribe();
    labUnsubscribe = null;
  }
  currentUserId = null;
  lastPatternsSnapshot = [];
  lastCompositionsSnapshot = [];
  lastCollectionsSnapshot = [];
  labRowIdByVariantId = new Map();
  lastVariantsSnapshot = new Map();
  lastActiveVariantsSnapshot = JSON.stringify(makeDefaultActiveVariants());
  lastReverbSnapshot = 'null';

  // Clear in-memory state and sessionStorage so cloud content doesn't leak
  // to a subsequent anon session in the same tab.
  usePatternsStore.setState({ ...DEFAULT_PATTERNS_STATE });
  useVoiceStore.getState().reset();
  try {
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
    sessionStorage.removeItem(VOICE_STORAGE_KEY);
  } catch {
    // private-browsing or quota issues — non-fatal.
  }
  // Also clear the migration-done flag so a subsequent anon → signup flow
  // in the same tab can re-trigger the prompt for its own session content.
  clearMigrationFlag();
}

// ─── Hydration: cloud → store ─────────────────────────────────────────────

/**
 * Reconstruct a Pattern from a Supabase row. The Pattern body lives in `data`
 * jsonb; we defensively fall back to top-level columns + safe defaults for
 * any catalog-metadata field that's missing (older rows written before the
 * schema landed had a slimmer Pattern shape). The DB row id always wins over
 * any id stored in data, so migrated anon content with legacy `pat_xxx` ids
 * gets re-mapped to its UUID row id.
 */
function hydratePatternRow(row: Record<string, unknown>): Pattern {
  const data = (row.data as Partial<Pattern>) ?? ({} as Partial<Pattern>);
  return {
    ...(data as Pattern),
    id: row.id as string,
    description: data.description ?? (row.description as string | null) ?? null,
    difficulty: data.difficulty ?? (row.difficulty as string | null) ?? null,
    genres: data.genres ?? ((row.genres as string[] | null) ?? []),
    tags: data.tags ?? ((row.tags as string[] | null) ?? []),
    visibility: data.visibility ?? (row.visibility as string | null) ?? 'private',
    publishedAt: data.publishedAt ?? coerceTimestamp(row.published_at),
    forkedFromId: data.forkedFromId ?? (row.forked_from_id as string | null) ?? null,
    forkedFromCreatorName:
      data.forkedFromCreatorName ?? (row.forked_from_creator_name as string | null) ?? null,
    collectionId: data.collectionId ?? (row.collection_id as string | null) ?? null,
    // New (Task 9): default for legacy rows that pre-date the fields.
    suggestedBpm: data.suggestedBpm ?? null,
    groove: data.groove ?? null,
    subdivision: data.subdivision ?? null,
    loop: (data.loop as boolean | undefined) ?? true,
    // Music-import expansion: legacy rows have no automation tracks or sourceIR.
    tempoTrack: data.tempoTrack ?? [],
    timeSignatureTrack: data.timeSignatureTrack ?? [],
    sourceIR: data.sourceIR ?? null,
  };
}

function hydrateCompositionRow(row: Record<string, unknown>): Composition {
  const data = (row.data as Partial<Composition>) ?? ({} as Partial<Composition>);
  const hydrated: Composition = {
    ...(data as Composition),
    id: row.id as string,
    description: data.description ?? (row.description as string | null) ?? null,
    difficulty: data.difficulty ?? (row.difficulty as string | null) ?? null,
    genres: data.genres ?? ((row.genres as string[] | null) ?? []),
    tags: data.tags ?? ((row.tags as string[] | null) ?? []),
    visibility: data.visibility ?? (row.visibility as string | null) ?? 'private',
    publishedAt: data.publishedAt ?? coerceTimestamp(row.published_at),
    forkedFromId: data.forkedFromId ?? (row.forked_from_id as string | null) ?? null,
    forkedFromCreatorName:
      data.forkedFromCreatorName ?? (row.forked_from_creator_name as string | null) ?? null,
    collectionId: data.collectionId ?? (row.collection_id as string | null) ?? null,
    // New (Task 9): default for legacy rows that pre-date the fields.
    tempoMode: data.tempoMode ?? 'global',
    groove: data.groove ?? null,
    grooveMode: data.grooveMode ?? 'global',
    subdivision: data.subdivision ?? null,
    loop: data.loop ?? false,
    placements: (data.placements ?? []).map((pl) => ({
      ...pl,
      transposeSemitones: pl.transposeSemitones ?? 0,
      lengthTicks: pl.lengthTicks ?? null,
    })),
    // Music-import expansion: legacy rows have no automation tracks or sourceIR.
    tempoTrack: data.tempoTrack ?? [],
    timeSignatureTrack: data.timeSignatureTrack ?? [],
    sourceIR: data.sourceIR ?? null,
    // Multi-track expansion: legacy rows have no tracks; the migration
    // helper bucketizes legacy `placements` into a single auto-generated
    // Track 1 so the composition can flow through the multi-track playback
    // engine without special-casing single-track shape.
    tracks: data.tracks ?? [],
    masterVolumeDb: data.masterVolumeDb ?? 0,
  };
  return migrateCompositionToTracks(hydrated);
}

function hydrateCollectionRow(row: Record<string, unknown>): Collection {
  return {
    id: row.id as string,
    name: row.name as string,
    parentId: (row.parent_id as string | null) ?? null,
    visibility: (row.visibility as string | null) ?? 'private',
    publishedAt: coerceTimestamp(row.published_at),
    createdAt: coerceTimestamp(row.created_at) ?? Date.now(),
    updatedAt: coerceTimestamp(row.updated_at) ?? Date.now(),
  };
}

/** Postgres returns timestamptz as an ISO 8601 string; in-memory we use unix-ms. */
function coerceTimestamp(v: unknown): number | null {
  if (typeof v === 'string') {
    const parsed = Date.parse(v);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof v === 'number') return v;
  return null;
}

async function hydrateFromCloud(userId: string): Promise<void> {
  isHydrating = true;
  try {
    const client = getSupabaseClient();

    const [patternsResult, compositionsResult, collectionsResult] = await Promise.all([
      client
        .from('patterns')
        .select('*')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false }),
      client
        .from('compositions')
        .select('*')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false }),
      client
        .from('collections')
        .select('*')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false }),
    ]);

    const patterns: Pattern[] = (patternsResult.data ?? []).map((row) =>
      hydratePatternRow(row),
    );

    const compositions: Composition[] = (compositionsResult.data ?? []).map((row) =>
      hydrateCompositionRow(row),
    );

    const collections: Collection[] = (collectionsResult.data ?? []).map((row) =>
      hydrateCollectionRow(row),
    );

    // Preserve any pristine local draft so the user doesn't lose their auto-seeded
    // pattern across sign-in. The draft sits alongside hydrated cloud rows; it stays
    // invisible to subsequent syncs until promoted.
    const prevState = usePatternsStore.getState();
    const draftId = prevState.unpersistedDraftId;
    const draft = draftId ? prevState.library.patterns.find((p) => p.id === draftId) : null;
    const mergedPatterns = draft ? [...patterns, draft] : patterns;

    usePatternsStore.setState({
      library: { patterns: mergedPatterns, compositions, collections },
    });

    lastPatternsSnapshot = patterns;
    lastCompositionsSnapshot = compositions;
    lastCollectionsSnapshot = collections;

    if (patternsResult.error) {
      console.error('[cloud sync] fetch patterns error:', patternsResult.error);
    }
    if (compositionsResult.error) {
      console.error('[cloud sync] fetch compositions error:', compositionsResult.error);
    }
    if (collectionsResult.error) {
      console.error('[cloud sync] fetch collections error:', collectionsResult.error);
    }
  } catch (e) {
    console.error('[cloud sync] hydrateFromCloud threw:', e);
  } finally {
    isHydrating = false;
  }
}

// ─── Store subscription: store mutations → cloud writes ───────────────────

function installStoreSubscription(): void {
  if (storeUnsubscribe) return;
  storeUnsubscribe = usePatternsStore.subscribe((state) => {
    if (isHydrating) return;
    if (!currentUserId) return;
    // Pristine auto-seeded drafts are excluded from sync until the user touches them
    // (any real mutation clears `unpersistedDraftId`, which lets the pattern flow through).
    const draftId = state.unpersistedDraftId;
    const patterns = draftId
      ? state.library.patterns.filter((p) => p.id !== draftId)
      : state.library.patterns;
    scheduleSync(patterns, state.library.compositions, state.library.collections);
  });
}

function scheduleSync(
  patterns: Pattern[],
  compositions: Composition[],
  collections: Collection[],
): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void performSync(patterns, compositions, collections);
  }, DEBOUNCE_MS);
}

async function performSync(
  patterns: Pattern[],
  compositions: Composition[],
  collections: Collection[],
): Promise<void> {
  const userId = currentUserId;
  if (!userId) return;

  try {
    await Promise.all([
      syncCollection('patterns', userId, patterns, lastPatternsSnapshot, (next) => {
        lastPatternsSnapshot = next;
      }),
      syncCollection('compositions', userId, compositions, lastCompositionsSnapshot, (next) => {
        lastCompositionsSnapshot = next;
      }),
      syncCollections(userId, collections),
    ]);
  } catch (e) {
    console.error('[cloud sync] performSync threw:', e);
  }
}

/**
 * Generic diff-and-sync for one collection. Works for `patterns` and
 * `compositions` because they share the same shape (`id`, `name`, `data`,
 * `updatedAt`, owned by user).
 *
 * Diff logic:
 *   - present in current, missing in snapshot → INSERT
 *   - present in both, updatedAt differs       → UPDATE
 *   - present in snapshot, missing in current  → DELETE
 *
 * On any failure, we DON'T update the snapshot — the failed delta will be
 * retried on the next mutation. This is intentionally simple at the cost of
 * eventually consistent only.
 */
/** Minimum surface a row-shaped item needs to expose to flow through syncCollection.
 *  Both Pattern and Composition satisfy this; the constraint is kept narrow so the
 *  function stays generic across the two tables. */
type SyncableItem = {
  id: string;
  name: string;
  instrumentId: string;
  description: string | null;
  difficulty: string | null;
  genres: string[];
  tags: string[];
  visibility: string;
  publishedAt: number | null;
  forkedFromId: string | null;
  forkedFromCreatorName: string | null;
  collectionId: string | null;
  updatedAt: number;
};

function rowPayload<T extends SyncableItem>(item: T) {
  return {
    name: item.name,
    data: item,
    instrument_id: item.instrumentId,
    description: item.description,
    difficulty: item.difficulty,
    genres: item.genres,
    tags: item.tags,
    visibility: item.visibility,
    // `published_at` is a timestamptz column. We store unix-ms in memory and convert
    // to ISO for the wire; Postgres parses ISO 8601 strings into timestamptz.
    published_at: item.publishedAt !== null ? new Date(item.publishedAt).toISOString() : null,
    forked_from_id: item.forkedFromId,
    forked_from_creator_name: item.forkedFromCreatorName,
    collection_id: item.collectionId,
  };
}

async function syncCollection<T extends SyncableItem>(
  table: 'patterns' | 'compositions',
  userId: string,
  current: T[],
  snapshot: T[],
  updateSnapshot: (next: T[]) => void,
): Promise<void> {
  const client = getSupabaseClient();
  const currentById = new Map(current.map((p) => [p.id, p]));
  const snapshotById = new Map(snapshot.map((p) => [p.id, p]));

  const inserts: T[] = [];
  const updates: T[] = [];
  const deletes: string[] = [];

  for (const item of current) {
    const prev = snapshotById.get(item.id);
    if (!prev) inserts.push(item);
    else if (prev.updatedAt !== item.updatedAt) updates.push(item);
  }
  for (const id of snapshotById.keys()) {
    if (!currentById.has(id)) deletes.push(id);
  }

  let ok = true;

  if (inserts.length > 0) {
    // Snapshot the current user's display name onto every new shareable row so
    // attribution can render without a profiles join — anon viewers can read the
    // row but not the profiles table (see migration 0009).
    const displayName = useAuthStore.getState().profile?.displayName ?? null;
    const rows = inserts.map((item) => ({
      id: item.id,
      user_id: userId,
      created_by_display_name: displayName,
      ...rowPayload(item),
    }));
    const { error } = await client.from(table).insert(rows);
    if (error) {
      console.error(`[cloud sync] ${table} INSERT failed:`, error);
      ok = false;
    }
  }

  if (updates.length > 0) {
    // Sequential to keep the per-row error surface clean; volumes are small.
    for (const item of updates) {
      const { error } = await client
        .from(table)
        .update(rowPayload(item))
        .eq('id', item.id);
      if (error) {
        console.error(`[cloud sync] ${table} UPDATE failed for ${item.id}:`, error);
        ok = false;
      }
    }
  }

  if (deletes.length > 0) {
    const { error } = await client.from(table).delete().in('id', deletes);
    if (error) {
      console.error(`[cloud sync] ${table} DELETE failed:`, error);
      ok = false;
    }
  }

  if (ok) {
    updateSnapshot(current);
  }
}

/**
 * Diff-and-sync for the `collections` table. Collections have a different shape
 * than patterns/compositions (no instrument/difficulty/genres/tags, plus a
 * `parent_id`), so they need their own row mapper. Same diff logic by id +
 * updatedAt; same snapshot-on-success behavior.
 */
async function syncCollections(userId: string, current: Collection[]): Promise<void> {
  const client = getSupabaseClient();
  const snapshot = lastCollectionsSnapshot;
  const currentById = new Map(current.map((c) => [c.id, c]));
  const snapshotById = new Map(snapshot.map((c) => [c.id, c]));

  const inserts: Collection[] = [];
  const updates: Collection[] = [];
  const deletes: string[] = [];

  for (const item of current) {
    const prev = snapshotById.get(item.id);
    if (!prev) inserts.push(item);
    else if (prev.updatedAt !== item.updatedAt) updates.push(item);
  }
  for (const id of snapshotById.keys()) {
    if (!currentById.has(id)) deletes.push(id);
  }

  let ok = true;
  const displayName = useAuthStore.getState().profile?.displayName ?? null;

  if (inserts.length > 0) {
    const rows = inserts.map((c) => ({
      id: c.id,
      user_id: userId,
      parent_id: c.parentId,
      name: c.name,
      visibility: c.visibility,
      published_at: c.publishedAt !== null ? new Date(c.publishedAt).toISOString() : null,
      created_by_display_name: displayName,
    }));
    const { error } = await client.from('collections').insert(rows);
    if (error) {
      console.error('[cloud sync] collections INSERT failed:', error);
      ok = false;
    }
  }

  if (updates.length > 0) {
    for (const c of updates) {
      const { error } = await client
        .from('collections')
        .update({
          parent_id: c.parentId,
          name: c.name,
          visibility: c.visibility,
          published_at: c.publishedAt !== null ? new Date(c.publishedAt).toISOString() : null,
        })
        .eq('id', c.id);
      if (error) {
        console.error(`[cloud sync] collections UPDATE failed for ${c.id}:`, error);
        ok = false;
      }
    }
  }

  if (deletes.length > 0) {
    const { error } = await client.from('collections').delete().in('id', deletes);
    if (error) {
      console.error('[cloud sync] collections DELETE failed:', error);
      ok = false;
    }
  }

  if (ok) {
    lastCollectionsSnapshot = current;
  }
}

// ─── Lab cloud sync (Sound Lab variants + active_variants + reverb) ───────

/**
 * Pull the user's `voice_presets` rows (one per variant), `user_settings.active_presets`
 * (now stores `ActiveVariantsMap`), and `user_settings.reverb` from the cloud,
 * then write them into `useVoiceStore`.
 */
async function hydrateLabFromCloud(userId: string): Promise<void> {
  isHydrating = true;
  try {
    const client = getSupabaseClient();
    const [presetsResult, settingsResult] = await Promise.all([
      client.from('voice_presets').select('*').eq('user_id', userId),
      client
        .from('user_settings')
        .select('active_presets, reverb')
        .eq('user_id', userId)
        .maybeSingle(),
    ]);

    const variants: Variant[] = [];
    const rowIdMap = new Map<string, string>();
    for (const row of presetsResult.data ?? []) {
      const preset = row.data as VoicePreset;
      const variant: Variant = {
        id: row.id as string,
        name: (row.name as string) ?? 'Untitled',
        instrumentId: row.instrument_id as FretInstrumentId,
        family: row.family as VoiceFamily,
        collectionId: (row.collection_id as string | null) ?? null,
        preset,
        forkedFromId: (row.forked_from_id as string | null) ?? null,
        forkedFromCreatorName: (row.forked_from_creator_name as string | null) ?? null,
      };
      variants.push(variant);
      rowIdMap.set(variant.id, row.id as string);
    }
    labRowIdByVariantId = rowIdMap;

    const rawActive = (settingsResult.data?.active_presets ?? null) as ActiveVariantsMap | null;
    const activeVariants = sanitizeActiveVariants(rawActive, variants);
    const reverb = (settingsResult.data?.reverb as ReverbSettings | null) ?? null;

    useVoiceStore.setState({
      variants,
      activeVariants,
      reverb,
      schemaVersion: 2,
    });
    lastVariantsSnapshot = new Map(variants.map((v) => [v.id, JSON.stringify(v)]));
    lastActiveVariantsSnapshot = JSON.stringify(activeVariants);
    lastReverbSnapshot = JSON.stringify(reverb);

    if (presetsResult.error) {
      console.error('[cloud sync] fetch voice_presets error:', presetsResult.error);
    }
    if (settingsResult.error) {
      console.error('[cloud sync] fetch user_settings error:', settingsResult.error);
    }
  } catch (e) {
    console.error('[cloud sync] hydrateLabFromCloud threw:', e);
  } finally {
    isHydrating = false;
  }
}

/**
 * Coerce a (possibly malformed or stale) cloud `active_presets` blob into a
 * valid `ActiveVariantsMap`. Any `user`-ref that points to a missing variant
 * collapses back to the instrument's default. Null input yields all-defaults.
 *
 * Exported for unit testing.
 */
export function sanitizeActiveVariants(
  raw: ActiveVariantsMap | null,
  variants: Variant[],
): ActiveVariantsMap {
  const variantIds = new Set(variants.map((v) => v.id));
  const defaults = makeDefaultActiveVariants();
  if (!raw) return defaults;
  const out: { -readonly [K in keyof ActiveVariantsMap]: ActiveVariantsMap[K] } = {
    ...defaults,
  };
  for (const inst of ['guitar', 'bass', 'ukulele'] as FretInstrumentId[]) {
    const ref = raw[inst];
    if (!ref) continue;
    if (ref.kind === 'user' && !variantIds.has(ref.id)) {
      out[inst] = defaults[inst];
    } else {
      out[inst] = ref;
    }
  }
  return out;
}

/**
 * Subscribe to every `useVoiceStore` change and dispatch a sync. No debounce:
 * every store mutation in the variant model is already a user-commit
 * (add/update/delete/setActiveVariantRef/setReverb), so deferring would only
 * delay writes without coalescing benefit.
 */
function installLabSubscription(): void {
  if (labUnsubscribe) return;
  labUnsubscribe = useVoiceStore.subscribe(() => {
    if (isHydrating) return;
    if (!currentUserId) return;
    void performLabSync();
  });
}

async function performLabSync(): Promise<void> {
  const userId = currentUserId;
  if (!userId) return;
  try {
    const client = getSupabaseClient();
    const state = useVoiceStore.getState();

    // Variants diff vs. last-synced snapshot.
    const current = state.variants;
    const currentIds = new Set(current.map((v) => v.id));
    const prevIds = new Set(lastVariantsSnapshot.keys());

    const inserts: Variant[] = [];
    const updates: Variant[] = [];
    const deletes: string[] = [];

    for (const v of current) {
      const serialized = JSON.stringify(v);
      const prev = lastVariantsSnapshot.get(v.id);
      if (!prev) inserts.push(v);
      else if (prev !== serialized) updates.push(v);
    }
    for (const id of prevIds) {
      if (!currentIds.has(id)) deletes.push(id);
    }

    if (inserts.length > 0) {
      const rows = inserts.map((v) => ({
        id: v.id,
        user_id: userId,
        name: v.name,
        instrument_id: v.instrumentId,
        family: v.family,
        collection_id: v.collectionId,
        data: v.preset,
        visibility: 'private' as const,
        forked_from_id: v.forkedFromId,
        forked_from_creator_name: v.forkedFromCreatorName,
      }));
      const { error } = await client.from('voice_presets').insert(rows);
      if (error) {
        console.error('[cloud sync] voice_presets INSERT failed:', error);
      } else {
        for (const v of inserts) labRowIdByVariantId.set(v.id, v.id);
      }
    }

    for (const v of updates) {
      const { error } = await client
        .from('voice_presets')
        .update({
          name: v.name,
          instrument_id: v.instrumentId,
          family: v.family,
          collection_id: v.collectionId,
          data: v.preset,
          forked_from_id: v.forkedFromId,
          forked_from_creator_name: v.forkedFromCreatorName,
        })
        .eq('id', v.id);
      if (error) {
        console.error(`[cloud sync] voice_presets UPDATE failed for ${v.id}:`, error);
      }
    }

    if (deletes.length > 0) {
      const { error } = await client.from('voice_presets').delete().in('id', deletes);
      if (error) {
        console.error('[cloud sync] voice_presets DELETE failed:', error);
      } else {
        for (const id of deletes) labRowIdByVariantId.delete(id);
      }
    }

    // active_variants + reverb upsert (user_settings singleton).
    const activeSer = JSON.stringify(state.activeVariants);
    const reverbSer = JSON.stringify(state.reverb);
    if (activeSer !== lastActiveVariantsSnapshot || reverbSer !== lastReverbSnapshot) {
      const { error } = await client.from('user_settings').upsert({
        user_id: userId,
        active_presets: state.activeVariants,
        reverb: state.reverb,
      });
      if (error) {
        console.error('[cloud sync] user_settings upsert failed:', error);
      } else {
        lastActiveVariantsSnapshot = activeSer;
        lastReverbSnapshot = reverbSer;
      }
    }

    lastVariantsSnapshot = new Map(current.map((v) => [v.id, JSON.stringify(v)]));
  } catch (e) {
    console.error('[cloud sync] performLabSync threw:', e);
  }
}

/** Test-only escape hatch. */
export function _resetCloudSyncForTests(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  if (storeUnsubscribe) storeUnsubscribe();
  if (labUnsubscribe) labUnsubscribe();
  isHydrating = false;
  lastPatternsSnapshot = [];
  lastCompositionsSnapshot = [];
  lastCollectionsSnapshot = [];
  labRowIdByVariantId = new Map();
  lastVariantsSnapshot = new Map();
  lastActiveVariantsSnapshot = JSON.stringify(makeDefaultActiveVariants());
  lastReverbSnapshot = 'null';
  debounceTimer = null;
  storeUnsubscribe = null;
  labUnsubscribe = null;
  currentUserId = null;
}
