/**
 * Sample store tests.
 *
 * Tone is fully mocked: jsdom has no Web Audio, so `decodeAudioData` cannot be
 * exercised for real here and these tests prove the ORDER OF RESORT and the
 * failure handling, not that audio comes out. Cache Storage is likewise absent
 * from jsdom, so `caches` is a fake whose behaviour each test sets.
 *
 * The module holds process-wide state — two in-flight maps, the counters, the
 * once-only quota warning — so every test re-imports it after `resetModules`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const decodeAudioData = vi.fn(async (bytes: ArrayBuffer) => ({
  fakeAudioBuffer: true,
  byteLength: bytes.byteLength,
}));

vi.mock('tone', () => {
  class ToneAudioBuffer {
    readonly source: unknown;
    constructor(source?: unknown) {
      this.source = source;
    }
    /** An empty buffer is what the store resolves to on failure. */
    get isEmpty(): boolean {
      return this.source === undefined;
    }
  }
  return {
    ToneAudioBuffer,
    getContext: () => ({ decodeAudioData }),
  };
});

type Store = typeof import('../src/playback/voices/sample-store');

const URL_A = 'https://example.test/samples/A2.mp3';
const URL_B = 'https://example.test/samples/B2.mp3';
const URL_C = 'https://example.test/samples/C2.mp3';

/** The store resolves to an EMPTY buffer on every failure, so this — not
 *  `toBeDefined`, which cannot fail — is what says a load succeeded. */
function isEmpty(buf: unknown): boolean {
  return (buf as { isEmpty: boolean }).isEmpty;
}

/** Let every pending microtask and timer-free continuation run. Used where the
 *  assertion is that something did NOT happen, which `waitFor` cannot express. */
async function flush(): Promise<void> {
  for (let i = 0; i < 50; i++) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** A plausible mp3 body. Content is irrelevant — only its identity is. */
function bytes(label = 'mp3'): ArrayBuffer {
  return new TextEncoder().encode(label).buffer as ArrayBuffer;
}

function cachedResponse(expiresAtMs: number, label = 'cached'): Response {
  return new Response(bytes(label), {
    headers: { 'x-fretwork-expires': String(expiresAtMs) },
  });
}

/** A cache entry whose body read is observable — the warm path must NOT read
 *  it. `makeCache`'s clone hides that, so this is hand-rolled. */
function presentEntry(expiresAtMs: number, label = 'cached'): {
  response: Response;
  arrayBuffer: ReturnType<typeof vi.fn>;
} {
  const arrayBuffer = vi.fn(async () => bytes(label));
  const response = {
    headers: new Headers({ 'x-fretwork-expires': String(expiresAtMs) }),
    arrayBuffer,
  } as unknown as Response;
  return { response, arrayBuffer };
}

interface FakeCache {
  match: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
}

function makeCache(hit?: Response): FakeCache {
  return {
    // Cloned, because a real Cache hands back a fresh Response every time and
    // a second read of a consumed body would throw. A fake that is laxer than
    // the thing it stands for hides exactly that class of bug.
    match: vi.fn(async () => hit?.clone()),
    put: vi.fn(async () => undefined),
    delete: vi.fn(async () => true),
  };
}

/** Install a `caches` global whose `open` resolves to `cache`. */
function installCaches(open: () => Promise<unknown>): void {
  (globalThis as Record<string, unknown>).caches = { open: vi.fn(open) };
}

function removeCaches(): void {
  delete (globalThis as Record<string, unknown>).caches;
}

let warn: ReturnType<typeof vi.spyOn>;

async function loadStore(): Promise<Store> {
  vi.resetModules();
  return import('../src/playback/voices/sample-store');
}

beforeEach(() => {
  decodeAudioData.mockClear();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn(async () => new Response(bytes('network'))));
});

afterEach(() => {
  warn.mockRestore();
  vi.unstubAllGlobals();
  removeCaches();
  vi.useRealTimers();
});

describe('loadAudioBuffer — order of resort', () => {
  it('serves a fresh cache hit without touching the network', async () => {
    const cache = makeCache(cachedResponse(Date.now() + 60_000));
    installCaches(async () => cache);
    const store = await loadStore();

    const buf = await store.loadAudioBuffer(URL_A);

    expect(fetch).not.toHaveBeenCalled();
    expect(decodeAudioData).toHaveBeenCalledTimes(1);
    expect(isEmpty(buf)).toBe(false);
    expect(store.sampleStoreStats()).toMatchObject({ hits: 1, misses: 0, fetches: 0, decodes: 1 });
    // The cache NAME is migration-critical: the ~670 entries the service worker
    // it replaces already wrote are hits on day one only while it matches.
    // Nothing else in this file would notice it changing.
    expect((globalThis as unknown as { caches: { open: ReturnType<typeof vi.fn> } }).caches.open)
      .toHaveBeenCalledWith('fretwork-samples-v1');
  });

  it('reads the cache with ignoreVary so a stored Vary cannot hide an entry', async () => {
    const cache = makeCache(cachedResponse(Date.now() + 60_000));
    installCaches(async () => cache);
    const store = await loadStore();

    await store.loadAudioBuffer(URL_A);

    expect(cache.match).toHaveBeenCalledWith(URL_A, { ignoreVary: true });
  });

  it('serves a stale hit immediately and refreshes behind it', async () => {
    const cache = makeCache(cachedResponse(Date.now() - 1, 'stale'));
    installCaches(async () => cache);
    const store = await loadStore();

    await store.loadAudioBuffer(URL_A);

    // Served from the stale copy: the caller's decode ran on the cached bytes,
    // not on anything the refresh produced.
    expect(decodeAudioData).toHaveBeenCalledTimes(1);
    expect(new TextDecoder().decode(decodeAudioData.mock.calls[0][0])).toBe('stale');
    expect(store.sampleStoreStats().hits).toBe(1);

    // ...and the refresh is under way behind it.
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(cache.put).toHaveBeenCalledTimes(1));
  });

  it('refreshes a stale entry once — the refresh is what makes it fresh', async () => {
    // A stateful cache, because the point of the refresh is that the NEXT read
    // is a fresh hit. A fake that keeps answering `stale` would assert the
    // opposite of the behaviour wanted.
    const stored = new Map<string, Response>([[URL_A, cachedResponse(Date.now() - 1, 'stale')]]);
    const cache: FakeCache = {
      match: vi.fn(async (url: string) => stored.get(url)?.clone()),
      put: vi.fn(async (url: string, response: Response) => {
        stored.set(url, response);
      }),
      delete: vi.fn(async () => true),
    };
    installCaches(async () => cache);
    const store = await loadStore();

    await store.loadAudioBuffer(URL_A);
    await vi.waitFor(() => expect(cache.put).toHaveBeenCalledTimes(1));
    await store.loadAudioBuffer(URL_A);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(store.sampleStoreStats()).toMatchObject({ hits: 2, misses: 0, fetches: 1 });
  });

  it('fetches, stores and decodes on a miss', async () => {
    const cache = makeCache(undefined);
    installCaches(async () => cache);
    const store = await loadStore();

    await store.loadAudioBuffer(URL_A);

    expect(fetch).toHaveBeenCalledWith(URL_A);
    expect(decodeAudioData).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(cache.put).toHaveBeenCalledTimes(1));
    expect(store.sampleStoreStats()).toMatchObject({ hits: 0, misses: 1, fetches: 1, decodes: 1 });
  });

  it('stamps an expiry on what it stores', async () => {
    const cache = makeCache(undefined);
    installCaches(async () => cache);
    const store = await loadStore();

    await store.loadAudioBuffer(URL_A);
    await vi.waitFor(() => expect(cache.put).toHaveBeenCalledTimes(1));

    const stored = cache.put.mock.calls[0][1] as Response;
    const expiresAt = Number(stored.headers.get('x-fretwork-expires'));
    expect(expiresAt).toBeGreaterThan(Date.now());
    // Inside the jittered window either side of the 30-day TTL.
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + store.SAMPLE_TTL_MS * (1 + store.JITTER_FRACTION));
  });
});

describe('loadAudioBuffer — no cache operation may fail a load', () => {
  it('degrades to a plain fetch when caches.open rejects', async () => {
    installCaches(async () => {
      throw new Error('storage blocked');
    });
    const store = await loadStore();

    const buf = await store.loadAudioBuffer(URL_A);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(decodeAudioData).toHaveBeenCalledTimes(1);
    expect(isEmpty(buf)).toBe(false);
  });

  it('still returns the decoded buffer when cache.put rejects', async () => {
    const cache = makeCache(undefined);
    cache.put.mockRejectedValue(Object.assign(new Error('over quota'), { name: 'QuotaExceededError' }));
    installCaches(async () => cache);
    const store = await loadStore();

    const buf = await store.loadAudioBuffer(URL_A);

    expect(isEmpty(buf)).toBe(false);
    expect(decodeAudioData).toHaveBeenCalledTimes(1);
  });

  it('warns exactly once about quota, however many files fail', async () => {
    const cache = makeCache(undefined);
    cache.put.mockRejectedValue(Object.assign(new Error('over quota'), { name: 'QuotaExceededError' }));
    installCaches(async () => cache);
    const store = await loadStore();

    await store.loadAudioBuffer(URL_A);
    await store.loadAudioBuffer(URL_B);
    await vi.waitFor(() => expect(cache.put).toHaveBeenCalledTimes(2));

    const quotaWarnings = warn.mock.calls.filter((c) => String(c[0]).includes('out of space'));
    expect(quotaWarnings).toHaveLength(1);
  });

  it('falls through to fetch-and-decode where caches does not exist at all', async () => {
    removeCaches();
    const store = await loadStore();

    const buf = await store.loadAudioBuffer(URL_A);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(isEmpty(buf)).toBe(false);
    expect(store.sampleStoreStats()).toMatchObject({ hits: 0, misses: 1, fetches: 1 });
  });
});

describe('loadAudioBuffer — rate limiting and failure', () => {
  it('retries a 429 with backoff and succeeds', async () => {
    vi.useFakeTimers();
    const responses = [
      new Response('', { status: 429 }),
      new Response(bytes('network')),
    ];
    vi.stubGlobal('fetch', vi.fn(async () => responses.shift()!));
    const cache = makeCache(undefined);
    installCaches(async () => cache);
    const store = await loadStore();

    const pending = store.loadAudioBuffer(URL_A);
    await vi.advanceTimersByTimeAsync(5_000);
    const buf = await pending;

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(isEmpty(buf)).toBe(false);
    expect(store.sampleStoreStats().fetches).toBe(2);
  });

  it('resolves with an empty buffer rather than rejecting when backoff is exhausted', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 429 })));
    const cache = makeCache(undefined);
    installCaches(async () => cache);
    const store = await loadStore();

    const pending = store.loadAudioBuffer(URL_A);
    await vi.advanceTimersByTimeAsync(60_000);
    const buf = await pending;

    expect(isEmpty(buf)).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(decodeAudioData).not.toHaveBeenCalled();
    expect(cache.put).not.toHaveBeenCalled();
    expect(warn.mock.calls.some((c) => String(c[0]).includes('rate-limited'))).toBe(true);
  });

  it('reports a genuine network failure and caches nothing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }));
    const cache = makeCache(undefined);
    installCaches(async () => cache);
    const store = await loadStore();

    const buf = await store.loadAudioBuffer(URL_A);

    expect(isEmpty(buf)).toBe(true);
    expect(cache.put).not.toHaveBeenCalled();
    expect(warn.mock.calls.some((c) => String(c[0]).includes('fetch failed'))).toBe(true);
  });

  it('does not cache a non-429 error response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));
    const cache = makeCache(undefined);
    installCaches(async () => cache);
    const store = await loadStore();

    const buf = await store.loadAudioBuffer(URL_A);

    expect(isEmpty(buf)).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(cache.put).not.toHaveBeenCalled();
  });
});

describe('in-flight dedupe', () => {
  it('two concurrent loads of one URL make exactly one fetch and one decode', async () => {
    const cache = makeCache(undefined);
    installCaches(async () => cache);
    const store = await loadStore();

    const [a, b] = await Promise.all([
      store.loadAudioBuffer(URL_A),
      store.loadAudioBuffer(URL_A),
    ]);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(decodeAudioData).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });

  it('retains nothing: a later load of the same URL goes back to the store', async () => {
    const cache = makeCache(undefined);
    installCaches(async () => cache);
    const store = await loadStore();

    await store.loadAudioBuffer(URL_A);
    await store.loadAudioBuffer(URL_A);

    // Two separate acquisitions — the map is a dedupe of concurrent work, not
    // a buffer cache.
    expect(cache.match).toHaveBeenCalledTimes(2);
  });
});

describe('warmUrls', () => {
  it('puts bytes on disk without decoding them', async () => {
    const cache = makeCache(undefined);
    installCaches(async () => cache);
    const store = await loadStore();

    store.warmUrls([URL_A, URL_B]);
    await vi.waitFor(() => expect(cache.put).toHaveBeenCalledTimes(2));

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(decodeAudioData).not.toHaveBeenCalled();
  });

  it('shares its in-flight work with a concurrent load of the same URL', async () => {
    const cache = makeCache(undefined);
    installCaches(async () => cache);
    const store = await loadStore();

    store.warmUrls([URL_A]);
    const buf = await store.loadAudioBuffer(URL_A);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(isEmpty(buf)).toBe(false);
  });
});

describe('loadAudioBuffer never rejects', () => {
  it('resolves empty when fetch resolves to something that is not a Response', async () => {
    // Not hypothetical: the app's VoicePane tests stub `fetch` with
    // `() => Promise.resolve()` to assert the prefetch ran.
    vi.stubGlobal('fetch', vi.fn(async () => undefined));
    installCaches(async () => makeCache(undefined));
    const store = await loadStore();

    const buf = await store.loadAudioBuffer(URL_A);

    expect(isEmpty(buf)).toBe(true);
  });

  it('resolves empty when Cache Storage itself throws mid-read', async () => {
    const cache = makeCache(undefined);
    cache.match.mockImplementation(() => {
      throw new Error('cache went away');
    });
    installCaches(async () => cache);
    const store = await loadStore();

    // The throw is swallowed by the match guard and the load falls through to
    // the network, so this asserts the degrade, not just the absence of a throw.
    const buf = await store.loadAudioBuffer(URL_A);

    expect(isEmpty(buf)).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('warmUrls — presence is the whole question', () => {
  it('stops at presence when the file is already on disk', async () => {
    const entry = presentEntry(Date.now() + 60_000);
    const cache = makeCache();
    cache.match.mockResolvedValue(entry.response);
    installCaches(async () => cache);
    const store = await loadStore();

    store.warmUrls([URL_A, URL_B]);
    await vi.waitFor(() => expect(cache.match).toHaveBeenCalledTimes(2));
    await flush();

    // Reading the body back would allocate ~11 MB per already-warm pack and
    // throw all of it away, on every voice selection.
    expect(entry.arrayBuffer).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    // And a warm answers no load, so it counts no hit — `hits` is the number
    // the browser check compares against the preset's URL count.
    expect(store.sampleStoreStats()).toMatchObject({ hits: 0, misses: 0, fetches: 0 });
  });

  it('refreshes behind a stale file without reading it', async () => {
    const entry = presentEntry(Date.now() - 1);
    const cache = makeCache();
    cache.match.mockResolvedValue(entry.response);
    installCaches(async () => cache);
    const store = await loadStore();

    store.warmUrls([URL_A]);
    await vi.waitFor(() => expect(cache.put).toHaveBeenCalledTimes(1));

    expect(entry.arrayBuffer).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(store.sampleStoreStats().hits).toBe(0);
  });
});

describe('the concurrency pool', () => {
  /** A fetch whose headers arrive at once and whose BODY is held open. That
   *  gap is the whole question: `fetch()` resolves on the headers, and the
   *  bytes move during `arrayBuffer()`. */
  function heldBodyFetch(): { fetchMock: ReturnType<typeof vi.fn>; bodies: Array<() => void> } {
    const bodies: Array<() => void> = [];
    const fetchMock = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          headers: new Headers(),
          arrayBuffer: () =>
            new Promise<ArrayBuffer>((resolve) => {
              bodies.push(() => resolve(bytes('late')));
            }),
        }) as unknown as Response,
    );
    return { fetchMock, bodies };
  }

  it('holds a slot for the whole transfer, so only six requests are ever open', async () => {
    removeCaches();
    const { fetchMock, bodies } = heldBodyFetch();
    vi.stubGlobal('fetch', fetchMock);
    const store = await loadStore();

    store.warmUrls(Array.from({ length: 20 }, (_, i) => `https://example.test/s/${i}.mp3`));

    await vi.waitFor(() => expect(bodies).toHaveLength(6));
    await flush();
    // Six, not twenty: releasing the slot on the Response would gate the
    // handshake and leave the bodies streaming unbounded.
    expect(fetchMock).toHaveBeenCalledTimes(6);

    bodies[0]();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(7));
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(7);
  });

  it('hands the freed slot to a waiter rather than letting a latecomer take it', async () => {
    removeCaches();
    const { fetchMock, bodies } = heldBodyFetch();
    vi.stubGlobal('fetch', fetchMock);
    const store = await loadStore();

    store.warmUrls(Array.from({ length: 8 }, (_, i) => `https://example.test/q/${i}.mp3`));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(6));

    // A late arrival, admitted in the same turn the slot is released. Counting
    // the slot down and back up would let it barge in alongside the waiter.
    bodies[0]();
    store.warmUrls([URL_C]);

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(7));
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(7);
  });
});

describe('backoff timing', () => {
  it('waits before retrying a 429 instead of retrying straight away', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 429 })));
    removeCaches();
    const store = await loadStore();

    const pending = store.loadAudioBuffer(URL_A);

    // Everything up to the sleep is microtasks, so attempt one has happened.
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(1);

    // Full jitter puts the first step in [250, 500) ms. Below the floor,
    // nothing may have moved — deleting the sleep is what this catches.
    await vi.advanceTimersByTimeAsync(249);
    expect(fetch).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(500);
    expect(fetch).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(isEmpty(await pending)).toBe(true);
  });
});

describe('a cached copy that cannot be used', () => {
  it('drops a stored entry that will not decode', async () => {
    const cache = makeCache(cachedResponse(Date.now() + 60_000));
    installCaches(async () => cache);
    const store = await loadStore();
    decodeAudioData.mockRejectedValueOnce(new Error('bad mp3'));

    const buf = await store.loadAudioBuffer(URL_A);

    expect(isEmpty(buf)).toBe(true);
    await vi.waitFor(() => expect(cache.delete).toHaveBeenCalledWith(URL_A));
    expect(warn.mock.calls.some((c) => String(c[0]).includes('decode failed'))).toBe(true);
  });

  it('leaves a freshly downloaded file that will not decode, rather than racing its own write', async () => {
    const cache = makeCache(undefined);
    installCaches(async () => cache);
    const store = await loadStore();
    decodeAudioData.mockRejectedValueOnce(new Error('bad mp3'));

    const buf = await store.loadAudioBuffer(URL_A);

    expect(isEmpty(buf)).toBe(true);
    await vi.waitFor(() => expect(cache.put).toHaveBeenCalledTimes(1));
    await flush();
    // A delete here would race the un-awaited put with nothing ordering them.
    // The entry is dropped on the NEXT load, where it arrives from the cache.
    expect(cache.delete).not.toHaveBeenCalled();
  });

  it('drops an entry with an empty body instead of missing on it forever', async () => {
    const cache = makeCache();
    cache.match.mockResolvedValue(
      new Response(new ArrayBuffer(0), {
        headers: { 'x-fretwork-expires': String(Date.now() + 60_000) },
      }),
    );
    installCaches(async () => cache);
    const store = await loadStore();

    const buf = await store.loadAudioBuffer(URL_A);

    expect(isEmpty(buf)).toBe(false);
    expect(cache.delete).toHaveBeenCalledWith(URL_A);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('resolves empty when a malformed entry throws after its body has been read', async () => {
    // Reaches the outer catch in the byte acquisition — the last guard before
    // a rejection would escape into `Tone.loaded()`.
    const cache = makeCache();
    cache.match.mockResolvedValue({
      arrayBuffer: async () => bytes('cached'),
    } as unknown as Response);
    installCaches(async () => cache);
    const store = await loadStore();

    const buf = await store.loadAudioBuffer(URL_A);

    expect(isEmpty(buf)).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
    expect(warn.mock.calls.some((c) => String(c[0]).includes('load failed'))).toBe(true);
  });
});

describe('reporting', () => {
  it('warns once per reason, not once per file', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    removeCaches();
    const store = await loadStore();

    await Promise.all([
      store.loadAudioBuffer(URL_A),
      store.loadAudioBuffer(URL_B),
      store.loadAudioBuffer(URL_C),
    ]);

    // A dead origin fails all 144 files in a pack identically; 144 lines bury
    // the first one, which is the useful one.
    const failures = warn.mock.calls.filter((c) => String(c[0]).includes('sample fetch failed'));
    expect(failures).toHaveLength(1);
  });
});

describe('expiryFor', () => {
  const NOW = 1_800_000_000_000;

  it('sits one TTL ahead, before jitter', async () => {
    const store = await loadStore();
    // random() === 0.5 is the midpoint, so no offset is applied.
    expect(store.expiryFor(NOW, () => 0.5)).toBe(NOW + store.SAMPLE_TTL_MS);
  });

  it('spreads expiry so a pack does not all fall due at once', async () => {
    // 144 files written in the same instant would otherwise expire in the same
    // instant, and the refresh burst is exactly the shape that got the origin
    // to answer 429. Jitter is what turns that spike into a trickle.
    const store = await loadStore();
    const earliest = store.expiryFor(NOW, () => 0);
    const latest = store.expiryFor(NOW, () => 1);
    expect(latest - earliest).toBeCloseTo(2 * store.JITTER_FRACTION * store.SAMPLE_TTL_MS, 0);
    expect(earliest).toBeLessThan(NOW + store.SAMPLE_TTL_MS);
    expect(latest).toBeGreaterThan(NOW + store.SAMPLE_TTL_MS);
  });

  it('never returns an already-expired time, whatever random does', async () => {
    const store = await loadStore();
    for (const r of [0, 0.25, 0.5, 0.75, 1]) {
      expect(store.expiryFor(NOW, () => r)).toBeGreaterThan(NOW);
    }
  });
});

describe('isStale', () => {
  const NOW = 1_800_000_000_000;

  it('is fresh before the expiry', async () => {
    const store = await loadStore();
    expect(store.isStale(NOW + 1000, NOW)).toBe(false);
  });

  it('is stale at and after the expiry', async () => {
    const store = await loadStore();
    expect(store.isStale(NOW, NOW)).toBe(true);
    expect(store.isStale(NOW - 1, NOW)).toBe(true);
  });

  it('treats a missing or unparseable expiry as stale', async () => {
    // A cached entry written by an older build carries no stamp. Refreshing it
    // once is right; trusting it forever is how a cache outlives its format.
    const store = await loadStore();
    expect(store.isStale(null, NOW)).toBe(true);
    expect(store.isStale(undefined, NOW)).toBe(true);
    expect(store.isStale('', NOW)).toBe(true);
    expect(store.isStale('not a number', NOW)).toBe(true);
    expect(store.isStale(Number.NaN, NOW)).toBe(true);
  });

  it('reads the raw header rather than a coerced one', async () => {
    // `Number(null)` is 0, so coercing at the call site would hand a MISSING
    // stamp in as a real, very expired one — right answer, wrong reason, and
    // the guard above would never run.
    const store = await loadStore();
    expect(store.isStale(String(NOW + 1000), NOW)).toBe(false);
  });
});

describe('prefetchSampleBanks', () => {
  it('routes every distinct URL through the store instead of firing bare fetches', async () => {
    const cache = makeCache(undefined);
    installCaches(async () => cache);
    const store = await loadStore();
    // Imported after `loadStore`'s module reset, so it is wired to the same
    // store instance these assertions read.
    const { prefetchSampleBanks } = await import('../src/playback/voices/sample-packs');

    prefetchSampleBanks([
      { a: URL_A, b: URL_A },
      { c: URL_B },
    ]);
    await vi.waitFor(() => expect(cache.put).toHaveBeenCalledTimes(2));
    await flush();

    // One request per DISTINCT url, and the cache consulted first — neither of
    // which the bare-`fetch` version it replaces did.
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(cache.match).toHaveBeenCalledWith(URL_A, { ignoreVary: true });
    expect(store.sampleStoreStats()).toMatchObject({ fetches: 2, decodes: 0 });
  });
});
