/**
 * Sample store — sample files are fetched from the origin ONCE, EVER.
 *
 * ── What this replaces, and why the replacement is a different shape ────────
 *
 * The app used to front these files with a service worker. A worker is a
 * network INTERCEPTOR, not a local store: every load still BEGINS as a request
 * and the local copy is only reachable when the worker happens to be in the
 * request path. Measured 2026-09-11 — with the worker bypassed, the browser's
 * own HTTP cache revalidated and the origin answered 304 in ~1s. A 304 is a
 * small response and a FULL REQUEST, and requests are the axis Supabase rate
 * limits on. It answered 429; a Sampler whose notes were refused has no buffer
 * for them, so those notes play silently with nothing in the console.
 *
 * So the read comes first here and the network is the last resort, rather than
 * the network coming first with a cache bolted underneath it.
 *
 * ── Why the lib owns this ──────────────────────────────────────────────────
 *
 * The lib owns the whole mechanism: the Supabase base URLs are its constants,
 * `Voice.ts` picks which files a preset needs, and `Voice.ts` fetches and
 * decodes them. Caching from outside is what produced an interceptor
 * underneath the lib rather than a cache inside it.
 *
 * ── Order of resort ────────────────────────────────────────────────────────
 *
 *   1. A load for this URL is already in flight  → the same promise.
 *   2. Cache Storage hit, fresh                  → read, decode. No request.
 *   3. Cache Storage hit, stale                  → served NOW, refreshed behind.
 *   4. Miss                                      → fetch, store, decode.
 *
 * Nothing else reaches the network.
 *
 * ── Two stages, two in-flight maps, and that is deliberate ─────────────────
 *
 * `inFlightBuffers` dedupes DECODED loads; `inFlightBytes` dedupes the byte
 * acquisition underneath them. Both are required, for different reasons:
 *
 *   - `MultiTrackPlayback` builds every track's voice in one synchronous loop.
 *     Eight tracks on one pack is 8 × 144 calls for 144 distinct URLs — cold,
 *     that is 1008 duplicate requests into a rate limit. `inFlightBuffers`
 *     collapses them to 144 fetches AND 144 decodes.
 *   - `warmUrls` must NOT decode. Warming a pack is 144 files whose decoded
 *     PCM (>100 MB) would be garbage the instant it existed. A warm that finds
 *     the file already on disk stops at PRESENCE — it does not even read the
 *     body back — but a warm that has to fetch and a real load of the same URL
 *     must still be one request, so they meet at `inFlightBytes`.
 *
 * NEITHER map is a buffer cache. Every entry is deleted the moment it settles;
 * nothing is retained. An in-memory decoded tier was considered and rejected —
 * re-decoding costs CPU, which is not the axis that broke.
 *
 * ── What is deliberately NOT routed through here ───────────────────────────
 *
 * `src/metronome/click-sounds.ts` builds a `Tone.Sampler` from a
 * CALLER-SUPPLIED click URL. It is left on Tone's own loader: nothing in this
 * app sets one, so the path is dormant, and the URL is arbitrary rather than
 * one of the lib's own sample constants — caching a caller's file on the
 * caller's behalf, under a cache named for the sample library, is a decision
 * for whoever first supplies one.
 */
import * as Tone from 'tone';

/** Bump to drop every cached sample on the next load. The escape hatch for
 *  "a file was overwritten and has to be gone now" — the routine path is the
 *  expiry, which needs no deploy.
 *
 *  MIGRATION: this name is carried over verbatim from the service worker it
 *  replaces. Reusing it means the entries the worker already wrote — ~670 of
 *  them on the author's machine — are hits on day one rather than a
 *  re-download of the whole library. */
const CACHE_NAME = 'fretwork-samples-v1';

/** Where an entry's expiry is stamped. A header on the stored copy, so the
 *  expiry travels WITH the response rather than in a second store that can
 *  disagree with it. Never sent to the network.
 *
 *  MIGRATION: also verbatim from the worker, and this one is load-bearing. A
 *  different header name makes every existing entry read as stale, and
 *  stale-while-revalidate then fires a refresh for all ~670 — the exact 429
 *  burst this file exists to end, on day one, inside the fix. */
const EXPIRES_HEADER = 'x-fretwork-expires';

/**
 * How long a downloaded sample is trusted. Long, because these files change
 * rarely and the cost of being wrong is one stale note, not a broken app.
 *
 * ── Why a local expiry rather than asking the origin ───────────────────────
 *
 * The obvious alternative is HTTP revalidation: let the browser ask "changed?"
 * when its `max-age` runs out. That is cheap in bytes — a 304 is a few hundred
 * — but it is one REQUEST PER FILE, and a pack is 144 files. Expiring locally
 * inverts the trade: a 30-day TTL costs 144 requests a month instead of
 * ~4,300, at the price of re-downloading ~11 MB that probably did not change.
 * Bytes are the cheap axis, so that is the right thing to waste.
 *
 * MEASURED, not inferred: Supabase answers a CDN MISS with `cache-control:
 * no-cache` and a Smart CDN HIT with `public, max-age=3600`, and `cacheControl`
 * can only be set at UPLOAD time — no API, no dashboard field — so changing
 * what the origin says means re-uploading all 670 objects.
 */
export const SAMPLE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** How far either side of the TTL an entry's expiry is spread. */
export const JITTER_FRACTION = 0.1;

/** How many fetches may be in flight at once. Gates the NETWORK ONLY — see
 *  `pooled`. Six is the browser's own per-host HTTP/1.1 ceiling, so a wider
 *  pool would only move the queue rather than shorten it. */
const MAX_CONCURRENT_FETCHES = 6;

/** Attempts per URL before giving up, counting the first. */
const MAX_FETCH_ATTEMPTS = 4;

/** First backoff step; doubles per retry. */
const BASE_BACKOFF_MS = 500;

/**
 * When an entry written now should fall due.
 *
 * Jittered, and that is load-bearing rather than tidy. A pack's 144 files are
 * written within the same second, so a fixed TTL makes all 144 expire within
 * the same second — and the refresh is then the same 144-request burst that
 * caused the rate limiting in the first place. Spreading them turns the spike
 * into a trickle.
 *
 * @param nowMs   current epoch ms
 * @param random  injected so the spread is testable; defaults to Math.random
 */
export function expiryFor(nowMs: number, random: () => number = Math.random): number {
  const offset = (random() * 2 - 1) * JITTER_FRACTION * SAMPLE_TTL_MS;
  return nowMs + SAMPLE_TTL_MS + offset;
}

/**
 * Whether a cached entry is due for a refresh.
 *
 * A missing or unparseable stamp counts as stale. An entry written by an older
 * build carries no expiry, and refreshing it once is right where trusting it
 * forever is how a cache outlives the format it was written in.
 */
export function isStale(expiresAt: string | number | null | undefined, nowMs: number): boolean {
  // Takes the RAW header value, because that is what the only caller has and
  // `Number(null)` is 0 — a coercion at the call site would hand a missing
  // stamp in as a real, very expired one and this guard would never run.
  if (expiresAt === null || expiresAt === undefined || expiresAt === '') return true;
  const expiresAtMs = Number(expiresAt);
  if (!Number.isFinite(expiresAtMs)) return true;
  return nowMs >= expiresAtMs;
}

/** What the dev counter reports. `fetches` counts network REQUESTS ISSUED —
 *  including retries and background refreshes — because requests are the axis
 *  being conserved, not downloads completed. */
export interface SampleStoreStats {
  /** Loads answered out of Cache Storage, fresh or stale. A warm never counts:
   *  it checks for presence and stops, so it neither reads a body nor answers
   *  a load — and double-counting would put `hits` at twice the number of URLs
   *  a preset names, which is the number the browser check compares against. */
  hits: number;
  /** Loads with no usable cached copy, which therefore went to the network. */
  misses: number;
  /** Network requests issued. */
  fetches: number;
  /** `decodeAudioData` calls. */
  decodes: number;
}

const stats: SampleStoreStats = { hits: 0, misses: 0, fetches: 0, decodes: 0 };

/** A snapshot of the counters. Exposed on `window.__fretworkSampleStore`
 *  alongside this, following `audio-debug`'s `__fretworkAudioStats` pattern —
 *  a camelCase handle assigned through a named shape. (SCREAMING_SNAKE in this
 *  lib means a flag the USER sets, like `__FRETWORK_AUDIO_DEBUG`; this is a
 *  handle the code installs.)
 *
 *  Unlike `audio-debug`, the counting is NOT gated on a debug flag: four
 *  integer increments per file is nothing, and gating them would mean the flag
 *  has to be set before the loads you want to count, which is the one thing a
 *  page-load-time cache check cannot arrange. */
export function sampleStoreStats(): SampleStoreStats {
  return { ...stats };
}

/** Zero the counters. For tests, and for "reload, then check" by hand. */
export function resetSampleStoreStats(): void {
  stats.hits = 0;
  stats.misses = 0;
  stats.fetches = 0;
  stats.decodes = 0;
  // The warning throttle goes with them. Someone who zeroes the counters and
  // repeats the run should see the first failure again, not a silence that
  // reads as a pass.
  reported.clear();
}

if (typeof window !== 'undefined') {
  const win = window as unknown as {
    __fretworkSampleStore?: { stats: () => SampleStoreStats; reset: () => void };
  };
  win.__fretworkSampleStore = { stats: sampleStoreStats, reset: resetSampleStoreStats };
}

/** Decoded loads in flight, keyed by URL. Deleted on settle. */
const inFlightBuffers = new Map<string, Promise<Tone.ToneAudioBuffer>>();

/** Byte acquisitions in flight, keyed by URL. Deleted on settle. Shared by
 *  loads and warms so the two never duplicate a request. */
const inFlightBytes = new Map<string, Promise<Acquired | null>>();

/** URLs whose stale entry is already being refreshed behind the caller. A
 *  refresh is fire-and-forget, so without this a run of stale hits spread over
 *  separate acquisitions would each fire their own — a burst, which is the
 *  thing being avoided. */
const refreshing = new Set<string>();

/**
 * Load a sample as a decoded buffer. NEVER REJECTS.
 *
 * On backoff exhaustion, a genuine network failure or a bad decode it resolves
 * to an EMPTY `ToneAudioBuffer` and reports to the console. That is not
 * defensive tidiness: a later change registers these promises on
 * `ToneAudioBuffer.downloads`, which is what `Tone.loaded()` drains, and
 * `Metronome.start()` awaits `Tone.loaded()` AFTER setting itself running — so
 * a rejection here throws inside an already-started transport.
 */
export function loadAudioBuffer(url: string): Promise<Tone.ToneAudioBuffer> {
  const existing = inFlightBuffers.get(url);
  if (existing) return existing;

  const load = (async (): Promise<Tone.ToneAudioBuffer> => {
    const acquired = await acquireBytes(url);
    if (!acquired) return new Tone.ToneAudioBuffer();
    try {
      stats.decodes++;
      // Tone's OWN context, never a fresh AudioContext. The app pins Tone's
      // context to 48 kHz at startup by replacing it; a buffer decoded on a
      // foreign context at the output device's rate plays at the wrong speed,
      // with no error anywhere.
      const decoded = await Tone.getContext().decodeAudioData(acquired.bytes);
      return new Tone.ToneAudioBuffer(decoded);
    } catch (err) {
      // Only a STORED copy is worth deleting, and `fromCache` is what says so.
      // Dropping unconditionally would race the miss path's own un-awaited
      // `cache.put`: a delete and a put with nothing ordering them, and if the
      // put lands last the bad entry survives to fail the same way forever.
      // A freshly downloaded file that will not decode is simply left — the
      // next load reads it back, fails again with `fromCache` true, and drops
      // it then.
      if (acquired.fromCache) void dropCacheEntry(url);
      report('sample decode failed', url, err);
      return new Tone.ToneAudioBuffer();
    }
  })()
    // The last line of the "must not reject" defence. Every failure this file
    // knows about is already handled above; this catches the ones it does not,
    // because a rejection here lands inside `Tone.loaded()` and throws in an
    // already-running transport.
    .catch((err: unknown) => {
      report('sample load failed', url, err);
      return new Tone.ToneAudioBuffer();
    })
    .finally(() => {
      inFlightBuffers.delete(url);
    });

  inFlightBuffers.set(url, load);
  return load;
}

/**
 * Put these URLs on disk without decoding them. Fire-and-forget.
 *
 * Warming stops at the byte stage on purpose — see the module header. It
 * shares the pool, the backoff, the cache and `inFlightBytes` with
 * `loadAudioBuffer`, so a warm racing a real load is one request, not two.
 */
export function warmUrls(urls: readonly string[]): void {
  if (typeof fetch === 'undefined') return;
  for (const url of urls) {
    // A decoded load already covers the bytes; joining it would only add a
    // needless promise.
    if (inFlightBuffers.has(url)) continue;
    void warmOne(url);
  }
}

/**
 * Make sure `url` is on disk, stopping at the first point that proves it.
 *
 * Presence is the whole question a warm asks, so it asks only that. Routing a
 * warm through `acquireBytes` would read every hit's body back out of Cache
 * Storage in full and then throw it away — ~11 MB per already-warm pack,
 * allocated for nothing, on every voice selection — and would count a `hit`
 * for a load nobody made.
 */
async function warmOne(url: string): Promise<void> {
  try {
    const cache = await openCache();
    if (cache) {
      const hit = await matchCache(cache, url);
      if (hit) {
        if (isStale(hit.headers.get(EXPIRES_HEADER), Date.now())) refreshBehind(cache, url);
        return;
      }
    }
    // Not on disk, so the bytes have to be fetched — and a real load of the
    // same URL must not fetch them a second time, which is why the miss path
    // is the shared one.
    await acquireBytes(url);
  } catch (err) {
    report('sample warm failed', url, err);
  }
}

/** Bytes for one URL, and where they came from. */
interface Acquired {
  bytes: ArrayBuffer;
  /** True when these bytes were read out of Cache Storage rather than fetched.
   *  Only a stored copy is worth deleting when it will not decode. */
  fromCache: boolean;
}

/** The bytes for `url`, from Cache Storage where possible. `null` means the
 *  load failed and has already been reported. */
function acquireBytes(url: string): Promise<Acquired | null> {
  const existing = inFlightBytes.get(url);
  if (existing) return existing;

  const acquire = (async (): Promise<Acquired | null> => {
    const cache = await openCache();
    if (cache) {
      const hit = await matchCache(cache, url);
      if (hit) {
        const bytes = await readBody(hit);
        if (bytes) {
          stats.hits++;
          // STALE-WHILE-REVALIDATE. The caller gets the copy we already have,
          // now, and the refresh happens behind them — so an expiry is never
          // something anyone waits for.
          if (isStale(hit.headers.get(EXPIRES_HEADER), Date.now())) {
            refreshBehind(cache, url);
          }
          return { bytes, fromCache: true };
        }
        // A matched entry with no readable body is corrupt. Left alone it
        // fails identically on every future load, so the fetch below would be
        // permanent rather than one-off. Deleted here, with the cache already
        // in hand, so it cannot race the put that follows.
        await deleteFromCache(cache, url);
      }
    }
    stats.misses++;
    const fetched = await fetchAndStore(cache, url);
    return fetched === null ? null : { bytes: fetched.bytes, fromCache: false };
  })()
    // `warmUrls` and the background refresh both drop this promise on the
    // floor, so an unexpected throw would surface as an unhandled rejection
    // with no owner. Everything here reports and resolves instead.
    .catch((err: unknown) => {
      report('sample load failed', url, err);
      return null;
    })
    .finally(() => {
      inFlightBytes.delete(url);
    });

  inFlightBytes.set(url, acquire);
  return acquire;
}

function refreshBehind(cache: Cache, url: string): void {
  if (refreshing.has(url)) return;
  refreshing.add(url);
  // Cleared when the WRITE has landed, not when the fetch has. Clearing on the
  // fetch leaves a window in which the copy on disk is still the stale one, and
  // a read arriving inside it fires a second refresh — bounded, but it is the
  // burst shape this file exists to prevent.
  void fetchAndStore(cache, url)
    .then((fetched) => fetched?.stored)
    .catch((err: unknown) => {
      report('sample refresh failed', url, err);
    })
    .finally(() => {
      refreshing.delete(url);
    });
}

/** A completed download, and the write that follows it. */
interface Fetched {
  bytes: ArrayBuffer;
  /** Settles when the `cache.put` has landed or failed. Deliberately off the
   *  caller's critical path — only the background refresh waits on it, so that
   *  it knows when the entry it is replacing has actually been replaced. */
  stored: Promise<void>;
}

/**
 * Fetch, stamp, store, return the bytes. `null` on failure, already reported.
 *
 * Storing is NOT on the critical path: the `cache.put` is fired and not
 * awaited. The worker this replaces awaited its put between a successful fetch
 * and its return, so a `QuotaExceededError` turned a good download into a
 * failed request — and at ~50 MB a pack, quota is reachable.
 */
async function fetchAndStore(cache: Cache | null, url: string): Promise<Fetched | null> {
  // The pool slot spans the WHOLE transfer, body included. `fetch()` resolves
  // as soon as the HEADERS arrive and `arrayBuffer()` is where the bytes
  // actually move, so releasing the slot on the Response would gate nothing but
  // the handshake and leave the number of bodies streaming at once unbounded —
  // the opposite of what a pool in front of a rate-limited origin is for.
  //
  // It is also held across the backoff sleeps rather than released and
  // re-acquired. Under a 429 that is the point: keeping the slot throttles the
  // whole pack while the origin is complaining, where releasing it would let
  // six more URLs start straight into the same limit.
  const got = await pooled(async () => {
    const response = await fetchWithBackoff(url);
    if (!response) return null;
    try {
      return { bytes: await response.arrayBuffer(), response };
    } catch (err) {
      report('sample body unreadable', url, err);
      return null;
    }
  });
  if (!got) return null;

  // Stamped BEFORE the bytes are handed to the decoder. `new Response(bytes)`
  // copies the buffer synchronously, and `decodeAudioData` detaches it.
  const stored = cache
    ? putInCache(cache, url, stamped(got.bytes, got.response))
    : Promise.resolve();
  return { bytes: got.bytes, stored };
}

/** A copy of the downloaded bytes carrying the expiry we will read them back
 *  with, and nothing else from the origin's headers except the content type —
 *  the origin's `cache-control: no-cache` has no meaning in Cache Storage and
 *  keeping it invites confusion. */
function stamped(bytes: ArrayBuffer, response: Response): Response {
  const headers = new Headers();
  const contentType = response.headers.get('content-type');
  if (contentType) headers.set('content-type', contentType);
  headers.set(EXPIRES_HEADER, String(expiryFor(Date.now())));
  return new Response(bytes, { status: 200, headers });
}

/**
 * One URL, retried on 429 and only on 429.
 *
 * `null` means give up — reported here so every caller can stay quiet. A 500,
 * a 404 or a dropped connection is NOT retried and is NOT cached: fabricating
 * a success from a genuine network failure is how a transient outage becomes a
 * month of silent notes.
 */
async function fetchWithBackoff(url: string): Promise<Response | null> {
  for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt++) {
    let response: Response | undefined;
    try {
      stats.fetches++;
      response = await fetch(url);
    } catch (err) {
      report('sample fetch failed', url, err);
      return null;
    }

    // Duck-typed rather than `instanceof Response`, which is false across
    // realms. A stubbed or patched `fetch` resolving to something else is
    // treated as a failed request rather than allowed to throw — a crash here
    // would take the caller with it.
    if (!response || typeof response.ok !== 'boolean') {
      report('sample fetch produced no response', url);
      return null;
    }

    if (response.ok) return response;

    if (response.status !== 429) {
      report(`sample fetch returned ${response.status}`, url);
      return null;
    }

    if (attempt === MAX_FETCH_ATTEMPTS) {
      report(`sample fetch rate-limited after ${MAX_FETCH_ATTEMPTS} attempts`, url);
      return null;
    }

    // Full jitter on the backoff. A deterministic delay would re-synchronise
    // the burst that earned the 429 in the first place and hit the limit again
    // as one block.
    const step = BASE_BACKOFF_MS * 2 ** (attempt - 1);
    await sleep(step * (0.5 + Math.random() * 0.5));
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** How many fetches are running right now. */
let activeFetches = 0;
/** Resolvers for callers waiting on a slot, in arrival order. */
const fetchQueue: Array<() => void> = [];

/**
 * Run `fn` with at most `MAX_CONCURRENT_FETCHES` others.
 *
 * The gate is on the NETWORK ONLY. Putting Cache Storage reads and decodes
 * behind it would make a warm rebuild artificially slow and would queue an
 * audition click behind a composition's 1152-deep fill — a pool protecting the
 * origin has no business slowing down work that never reaches it.
 *
 * The slot is HANDED OVER rather than counted down and back up. A releaser
 * that decremented and then woke a waiter would leave a window — one microtask
 * wide, and arrivals here are exactly microtask-timed — in which a caller
 * arriving late sees the lowered count, skips the queue and takes the slot from
 * under the waiter it was handed to. The cap would then be advisory and a
 * queued URL could be starved by a stream of latecomers.
 */
async function pooled<T>(fn: () => Promise<T>): Promise<T> {
  if (activeFetches >= MAX_CONCURRENT_FETCHES) {
    await new Promise<void>((resolve) => fetchQueue.push(resolve));
  } else {
    activeFetches++;
  }
  try {
    return await fn();
  } finally {
    const next = fetchQueue.shift();
    if (next) next();
    else activeFetches--;
  }
}

/**
 * The sample cache, or `null` if it cannot be had.
 *
 * `caches` is absent in jsdom, on an insecure origin, and where site data is
 * blocked. Uncached is slower; it is not broken — so every cache operation has
 * its own guard and degrades to a plain fetch rather than failing the load.
 */
async function openCache(): Promise<Cache | null> {
  if (typeof caches === 'undefined') return null;
  try {
    return await caches.open(CACHE_NAME);
  } catch {
    return null;
  }
}

async function matchCache(cache: Cache, url: string): Promise<Response | undefined> {
  try {
    // `ignoreVary` because a stored `Vary` we did not choose — `Vary: *`
    // included — would turn a present entry into a miss for reasons that have
    // nothing to do with this URL.
    return await cache.match(url, { ignoreVary: true });
  } catch {
    return undefined;
  }
}

async function readBody(response: Response): Promise<ArrayBuffer | null> {
  try {
    const bytes = await response.arrayBuffer();
    return bytes.byteLength > 0 ? bytes : null;
  } catch {
    return null;
  }
}

async function putInCache(cache: Cache, url: string, response: Response): Promise<void> {
  try {
    await cache.put(url, response);
  } catch (err) {
    // A silently failing put means permanent misses with no symptom, so quota
    // is reported. Once: past quota every file in the pack fails the same way,
    // which `report` already collapses.
    if (isQuotaError(err)) {
      report('sample cache is out of space — samples will be re-downloaded every session', undefined, err);
    }
  }
}

async function deleteFromCache(cache: Cache, url: string): Promise<void> {
  try {
    await cache.delete(url);
  } catch {
    // Nothing to do about it, and it must not fail a load.
  }
}

async function dropCacheEntry(url: string): Promise<void> {
  const cache = await openCache();
  if (!cache) return;
  await deleteFromCache(cache, url);
}

function isQuotaError(err: unknown): boolean {
  return err instanceof Error && err.name === 'QuotaExceededError';
}

/** How many times each reason has been reported. */
const reported = new Map<string, number>();

/**
 * Warn, but not once per file.
 *
 * A rate-limited or unreachable origin fails every URL in a pack the same way,
 * so an unthrottled reporter is 144 identical lines and the first one — the
 * useful one — is buried. Each REASON warns on its first occurrence and then
 * every hundredth with a tally, so a dead origin costs two lines and still
 * says how big the problem is.
 */
function report(reason: string, detail?: string, err?: unknown): void {
  const seen = (reported.get(reason) ?? 0) + 1;
  reported.set(reason, seen);
  if (seen !== 1 && seen % 100 !== 0) return;

  const tally = seen === 1 ? '' : ` (×${seen})`;
  const message =
    detail === undefined
      ? `[fretwork] ${reason}${tally}`
      : `[fretwork] ${reason}${tally}: ${detail}`;
  if (err === undefined) console.warn(message);
  else console.warn(message, err);
}
