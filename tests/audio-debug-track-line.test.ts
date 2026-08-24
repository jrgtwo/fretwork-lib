/**
 * The per-track debug line (AF-01).
 *
 * `audio-debug` is a module of side effects — an interval, a console line and a
 * `window` flag — so this drives it the way the browser does: turn the flag on,
 * hand it a source, advance the clock, read what was printed.
 *
 * The peak-holding is the part worth the trouble. A transient that lands
 * between two log ticks is exactly what the artifacting report is about, and a
 * line that sampled once a second would miss it every time.
 *
 * The manager's side — what it hands in, and unregistering on dispose — is in
 * `drive-meter-source.test.ts`; the two cannot share a file, because that one
 * mocks this module away.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('audio-debug — the per-track line', () => {
  let logged: string[];
  let restoreFlag: () => void;

  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    logged = [];
    vi.spyOn(console, 'log').mockImplementation((msg: unknown) => {
      logged.push(String(msg));
    });
    const w = globalThis as unknown as { __FRETWORK_AUDIO_DEBUG?: boolean };
    w.__FRETWORK_AUDIO_DEBUG = true;
    restoreFlag = () => {
      w.__FRETWORK_AUDIO_DEBUG = false;
    };
  });

  afterEach(() => {
    restoreFlag();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function loadDebug() {
    vi.doMock('../src/playback/voices/MasterBus', () => ({
      MasterBus: {
        getOutputPeakDb: () => -12,
        setReverbBypassed: () => {},
      },
    }));
    return await import('../src/playback/audio-debug');
  }

  function trackLines(): string[] {
    return logged.filter((l) => l.startsWith('[audio]   '));
  }

  it('prints one line per track, with all four levels', async () => {
    const debug = await loadDebug();
    debug.registerTrackLevelSource(() => [
      { trackId: 't1', name: 'Rhythm', inDb: -14.2, driveDb: -5.1, outDb: -9.8, faderDb: -15.8 },
      { trackId: 't2', name: 'Lead', inDb: -11, driveDb: 2.4, outDb: -8.9, faderDb: -8.9 },
    ]);

    vi.advanceTimersByTime(1000);

    const lines = trackLines();
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('Rhythm');
    expect(lines[0]).toContain('in= -14.2');
    expect(lines[0]).toContain('drive=  -5.1');
    expect(lines[0]).toContain('out=  -9.8');
    expect(lines[0]).toContain('fader= -15.8');
    debug.registerTrackLevelSource(null);
  });

  it('flags a drive tap above 0 dBFS — the WaveShaper domain edge', async () => {
    const debug = await loadDebug();
    debug.registerTrackLevelSource(() => [
      { trackId: 't1', name: 'Hot', inDb: -14, driveDb: 2.4, outDb: -9, faderDb: -9 },
      { trackId: 't2', name: 'Cool', inDb: -14, driveDb: -2.4, outDb: -9, faderDb: -9 },
    ]);

    vi.advanceTimersByTime(1000);

    const lines = trackLines();
    expect(lines.find((l) => l.includes('Hot'))).toContain('⚠ drive');
    expect(lines.find((l) => l.includes('Cool'))).not.toContain('⚠ drive');
    debug.registerTrackLevelSource(null);
  });

  it('reports the PEAK over the second, not the value at log time', async () => {
    // The 50 ms sampler is the whole reason this is trustworthy: a transient
    // that lands between two log ticks is exactly the thing being hunted, and a
    // line that read the meter once a second would miss it.
    const debug = await loadDebug();
    const drives = [-30, -30, -4, -30, -30];
    let i = 0;
    debug.registerTrackLevelSource(() => [
      {
        trackId: 't1',
        name: 'Spiky',
        inDb: -20,
        driveDb: drives[Math.min(i++, drives.length - 1)],
        outDb: -9,
        faderDb: -9,
      },
    ]);

    vi.advanceTimersByTime(1000);

    expect(trackLines()[0]).toContain('drive=  -4.0');
    debug.registerTrackLevelSource(null);
  });

  it('starts each second fresh, so a peak is not held forever', async () => {
    const debug = await loadDebug();
    let drive = -4;
    debug.registerTrackLevelSource(() => [
      { trackId: 't1', name: 'Spiky', inDb: -20, driveDb: drive, outDb: -9, faderDb: -9 },
    ]);

    // Stopping at 950 ms leaves the whole first window sampled and not yet
    // logged, so the change below lands cleanly in the second window. Advancing
    // a flat 1000 first would put one -30 sample on the same tick as the log,
    // and which of the two intervals fires first is not worth depending on.
    vi.advanceTimersByTime(950);
    drive = -30;
    vi.advanceTimersByTime(50);
    expect(trackLines()[0]).toContain('drive=  -4.0');

    logged.length = 0;
    vi.advanceTimersByTime(1000);
    expect(trackLines()[0]).toContain('drive= -30.0');
    debug.registerTrackLevelSource(null);
  });

  it('prints nothing per-track when no engine is registered', async () => {
    const debug = await loadDebug();
    vi.advanceTimersByTime(1000);
    expect(trackLines()).toHaveLength(0);
    // The master line still prints — the two are independent.
    expect(logged.some((l) => l.startsWith('[audio] voices='))).toBe(true);
    void debug;
  });

  it('drops a torn-down engine\'s held peaks when it unregisters', () => {
    // Close a composition and open another and the ids can repeat. A peak held
    // from the engine that just went away would be printed as if it were the
    // new one's, which is worse than printing nothing.
    return (async () => {
      const debug = await loadDebug();
      debug.registerTrackLevelSource(() => [
        { trackId: 't1', name: 'Old', inDb: -20, driveDb: -4, outDb: -9, faderDb: -9 },
      ]);
      vi.advanceTimersByTime(500);

      debug.registerTrackLevelSource(null);
      debug.registerTrackLevelSource(() => [
        { trackId: 't1', name: 'New', inDb: -20, driveDb: -30, outDb: -9, faderDb: -9 },
      ]);
      vi.advanceTimersByTime(1000);

      const line = trackLines().at(-1)!;
      expect(line).toContain('New');
      expect(line).toContain('drive= -30.0');
      debug.registerTrackLevelSource(null);
    })();
  });

  it('survives a source that throws — a debug line never takes playback down', async () => {
    const debug = await loadDebug();
    debug.registerTrackLevelSource(() => {
      throw new Error('half-disposed engine');
    });
    expect(() => vi.advanceTimersByTime(1000)).not.toThrow();
    expect(trackLines()).toHaveLength(0);
    debug.registerTrackLevelSource(null);
  });
});
