/**
 * Metronome tests. Tone.js is mocked because jsdom has no AudioContext — the mock
 * captures the scheduled tick callback and lets tests drive it manually, which is
 * exactly the determinism we want for verifying beat math + event dispatch.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Hoisted state shared between the mock factory and the tests.
const hoisted = vi.hoisted(() => {
  let scheduledCallback: ((time: number) => void) | null = null;
  let nextScheduleId = 1;
  const synthInstances: Array<Record<string, unknown>> = [];
  const transportMock = {
    bpm: { value: 120 },
    position: 0,
    scheduleRepeat: vi.fn((cb: (time: number) => void) => {
      scheduledCallback = cb;
      return nextScheduleId++;
    }),
    clear: vi.fn(() => { scheduledCallback = null; }),
    start: vi.fn(),
    stop: vi.fn(),
  };
  const drawMock = {
    schedule: vi.fn((fn: () => void) => fn()),
  };
  return {
    transportMock,
    drawMock,
    synthInstances,
    getCallback: () => scheduledCallback,
    setCallback: (cb: ((t: number) => void) | null) => { scheduledCallback = cb; },
    /** Look up a Mock Synth instance by its initial `volume` config. The default
     *  metronome creates three: accent (+2), regular (0), subdivision (-6). */
    findSynthByInitialVolume: (vol: number) =>
      synthInstances.find((s) => (s as { initialVolume?: number }).initialVolume === vol),
    resetSynths: () => { synthInstances.length = 0; },
    resetCounters: () => { nextScheduleId = 1; },
  };
});

vi.mock('tone', () => {
  class MockSynth {
    oscillator: unknown;
    envelope: unknown;
    initialVolume: number;
    volume = { value: 0 };
    triggerAttackRelease = vi.fn();
    dispose = vi.fn();
    constructor(opts: any = {}) {
      this.oscillator = opts.oscillator;
      this.envelope = opts.envelope;
      this.initialVolume = opts.volume ?? 0;
      if (opts.volume !== undefined) this.volume.value = opts.volume;
      hoisted.synthInstances.push(this as unknown as Record<string, unknown>);
    }
    toDestination() { return this; }
  }
  class MockSampler {
    volume = { value: 0 };
    constructor(_opts: any = {}) {}
    toDestination() { return this; }
    triggerAttackRelease = vi.fn();
    dispose = vi.fn();
  }
  return {
    start: vi.fn(async () => undefined),
    getTransport: () => hoisted.transportMock,
    getDraw: () => hoisted.drawMock,
    Synth: MockSynth,
    Sampler: MockSampler,
    gainToDb: (g: number) => 20 * Math.log10(Math.max(0.0001, g)),
  };
});

import { Metronome } from '../src/metronome/Metronome';
import { getTimeSignature } from '../src/metronome/time-signatures';

beforeEach(() => {
  hoisted.setCallback(null);
  hoisted.resetCounters();
  hoisted.resetSynths();
  hoisted.transportMock.bpm.value = 120;
  hoisted.transportMock.position = 0;
  vi.clearAllMocks();
  hoisted.drawMock.schedule.mockImplementation((fn: () => void) => fn());
});

afterEach(() => {
  hoisted.setCallback(null);
  hoisted.resetSynths();
});

function tick(time = 0): void {
  const cb = hoisted.getCallback();
  if (!cb) throw new Error('No tick callback registered yet — call start() first.');
  cb(time);
}

describe('Metronome — construction', () => {
  it('uses sensible defaults', () => {
    const m = new Metronome();
    expect(m.bpm).toBe(120);
    expect(m.timeSignature.id).toBe('4/4');
    expect(m.accents).toEqual([0]);
    expect(m.isRunning).toBe(false);
    m.dispose();
  });

  it('clamps BPM to [40, 240]', () => {
    expect(new Metronome({ bpm: 10 }).bpm).toBe(40);
    expect(new Metronome({ bpm: 999 }).bpm).toBe(240);
    expect(new Metronome({ bpm: 88 }).bpm).toBe(88);
  });

  it('accepts a time-signature id string', () => {
    const m = new Metronome({ timeSignature: '6/8' });
    expect(m.timeSignature.id).toBe('6/8');
    expect(m.accents).toEqual([0, 3]);
    m.dispose();
  });

  it('accepts a TimeSignature object', () => {
    const ts = getTimeSignature('5/4')!;
    const m = new Metronome({ timeSignature: ts });
    expect(m.timeSignature).toBe(ts);
    m.dispose();
  });

  it('throws on unknown time-signature id', () => {
    expect(() => new Metronome({ timeSignature: 'banana' })).toThrow(/banana/);
  });

  it('honors accents override at construction', () => {
    const m = new Metronome({ timeSignature: '4/4', accents: [0, 2] });
    expect(m.accents).toEqual([0, 2]);
    m.dispose();
  });

  it('registers events from the constructor option map', async () => {
    const tickHandler = vi.fn();
    const m = new Metronome({ events: { tick: tickHandler } });
    await m.start();
    tick(0);
    expect(tickHandler).toHaveBeenCalledOnce();
    m.dispose();
  });
});

describe('Metronome — lifecycle', () => {
  it('start() flips isRunning and fires the start event', async () => {
    const startHandler = vi.fn();
    const m = new Metronome();
    m.on('start', startHandler);

    await m.start();
    expect(m.isRunning).toBe(true);
    expect(startHandler).toHaveBeenCalledOnce();
    expect(hoisted.transportMock.start).toHaveBeenCalledOnce();
    m.dispose();
  });

  it('start() is idempotent — calling twice does not double-schedule', async () => {
    const m = new Metronome();
    await m.start();
    await m.start();
    expect(hoisted.transportMock.scheduleRepeat).toHaveBeenCalledOnce();
    m.dispose();
  });

  it('stop() resets the tick counter and fires the stop event', async () => {
    const stopHandler = vi.fn();
    const m = new Metronome();
    m.on('stop', stopHandler);
    await m.start();
    tick(0); tick(0.5); tick(1.0);
    m.stop();
    expect(m.isRunning).toBe(false);
    expect(stopHandler).toHaveBeenCalledOnce();
    expect(hoisted.transportMock.stop).toHaveBeenCalledOnce();

    // Restart — counters should be back to 0
    const ticks: number[] = [];
    m.on('tick', (e) => ticks.push(e.tickIndex));
    await m.start();
    tick(0);
    expect(ticks).toEqual([0]);
    m.dispose();
  });

  it('toggle() returns the new running state', async () => {
    const m = new Metronome();
    expect(await m.toggle()).toBe(true);
    expect(await m.toggle()).toBe(false);
    m.dispose();
  });
});

describe('Metronome — beat counting', () => {
  it('counts beats correctly in 4/4', async () => {
    const events: Array<{ beat: number; measure: number; tickIndex: number; isAccent: boolean }> = [];
    const m = new Metronome({ timeSignature: '4/4' });
    m.on('tick', (e) => events.push({ beat: e.beat, measure: e.measure, tickIndex: e.tickIndex, isAccent: e.isAccent }));
    await m.start();

    // Fire 9 ticks — should see 2 full measures + start of 3rd
    for (let i = 0; i < 9; i++) tick(i * 0.5);

    expect(events).toEqual([
      { beat: 0, measure: 0, tickIndex: 0, isAccent: true },
      { beat: 1, measure: 0, tickIndex: 1, isAccent: false },
      { beat: 2, measure: 0, tickIndex: 2, isAccent: false },
      { beat: 3, measure: 0, tickIndex: 3, isAccent: false },
      { beat: 0, measure: 1, tickIndex: 4, isAccent: true },
      { beat: 1, measure: 1, tickIndex: 5, isAccent: false },
      { beat: 2, measure: 1, tickIndex: 6, isAccent: false },
      { beat: 3, measure: 1, tickIndex: 7, isAccent: false },
      { beat: 0, measure: 2, tickIndex: 8, isAccent: true },
    ]);
    m.dispose();
  });

  it('counts beats correctly in 6/8 with default accents [0,3]', async () => {
    const events: Array<{ beat: number; isAccent: boolean }> = [];
    const m = new Metronome({ timeSignature: '6/8' });
    m.on('tick', (e) => events.push({ beat: e.beat, isAccent: e.isAccent }));
    await m.start();
    for (let i = 0; i < 6; i++) tick(i * 0.25);
    expect(events).toEqual([
      { beat: 0, isAccent: true },
      { beat: 1, isAccent: false },
      { beat: 2, isAccent: false },
      { beat: 3, isAccent: true },
      { beat: 4, isAccent: false },
      { beat: 5, isAccent: false },
    ]);
    m.dispose();
  });

  it('respects custom accent overrides', async () => {
    const events: boolean[] = [];
    const m = new Metronome({ timeSignature: '4/4', accents: [1, 3] });
    m.on('tick', (e) => events.push(e.isAccent));
    await m.start();
    for (let i = 0; i < 4; i++) tick(i);
    expect(events).toEqual([false, true, false, true]);
    m.dispose();
  });

  it('counts beats correctly in 7/8', async () => {
    const beats: number[] = [];
    const m = new Metronome({ timeSignature: '7/8' });
    m.on('tick', (e) => beats.push(e.beat));
    await m.start();
    for (let i = 0; i < 14; i++) tick(i * 0.125);
    expect(beats).toEqual([0, 1, 2, 3, 4, 5, 6, 0, 1, 2, 3, 4, 5, 6]);
    m.dispose();
  });
});

describe('Metronome — derived events (accent, measure)', () => {
  it('accent fires only on accent beats', async () => {
    const accents: number[] = [];
    const m = new Metronome({ timeSignature: '4/4' });
    m.on('accent', (e) => accents.push(e.tickIndex));
    await m.start();
    for (let i = 0; i < 12; i++) tick(i);
    expect(accents).toEqual([0, 4, 8]); // beat 0 of each measure
    m.dispose();
  });

  it('measure fires on beat 0 only', async () => {
    const measures: number[] = [];
    const m = new Metronome({ timeSignature: '3/4' });
    m.on('measure', (e) => measures.push(e.measure));
    await m.start();
    for (let i = 0; i < 9; i++) tick(i);
    expect(measures).toEqual([0, 1, 2]);
    m.dispose();
  });
});

describe('Metronome — live config changes', () => {
  it('setBpm clamps and pushes to transport, fires bpmChange', async () => {
    const handler = vi.fn();
    const m = new Metronome();
    m.on('bpmChange', handler);
    await m.start();

    m.setBpm(80);
    expect(m.bpm).toBe(80);
    expect(hoisted.transportMock.bpm.value).toBe(80);
    expect(handler).toHaveBeenCalledWith(80);

    m.setBpm(9999);
    expect(m.bpm).toBe(240);

    m.dispose();
  });

  it('setBpm is a no-op when the value does not change', async () => {
    const handler = vi.fn();
    const m = new Metronome({ bpm: 100 });
    m.on('bpmChange', handler);
    m.setBpm(100);
    expect(handler).not.toHaveBeenCalled();
    m.dispose();
  });

  it('setTimeSignature mid-run resets beat to 0 and re-schedules', async () => {
    const beats: number[] = [];
    const m = new Metronome({ timeSignature: '4/4' });
    m.on('tick', (e) => beats.push(e.beat));
    await m.start();
    tick(0); tick(0.5); tick(1.0); // beats 0,1,2 in 4/4
    m.setTimeSignature('3/4');
    tick(2.0); tick(2.5); tick(3.0); tick(3.5); // re-scheduled in 3/4 → beats 0,1,2,0
    expect(beats).toEqual([0, 1, 2, 0, 1, 2, 0]);
    expect(m.timeSignature.id).toBe('3/4');
    m.dispose();
  });

  it('setAccents updates the active accent set without restart', async () => {
    const flags: boolean[] = [];
    const m = new Metronome({ timeSignature: '4/4' });
    m.on('tick', (e) => flags.push(e.isAccent));
    await m.start();
    tick(0); // beat 0 → accent
    m.setAccents([1, 3]);
    tick(0.5); tick(1.0); tick(1.5); // beats 1,2,3
    expect(flags).toEqual([true, true, false, true]);
    m.dispose();
  });
});

describe('Metronome — event subscriptions', () => {
  it('on() returns an unsubscribe function', async () => {
    const handler = vi.fn();
    const m = new Metronome();
    const unsubscribe = m.on('tick', handler);
    await m.start();
    tick(0);
    expect(handler).toHaveBeenCalledOnce();
    unsubscribe();
    tick(0.5);
    expect(handler).toHaveBeenCalledOnce(); // still 1
    m.dispose();
  });

  it('a throwing handler does not break the loop', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const m = new Metronome();
    m.on('tick', () => { throw new Error('oops'); });
    const ok = vi.fn();
    m.on('tick', ok);
    await m.start();
    tick(0); tick(0.5);
    expect(ok).toHaveBeenCalledTimes(2);
    consoleSpy.mockRestore();
    m.dispose();
  });
});

describe('Metronome — cleanup', () => {
  it('dispose() stops, clears handlers, and disposes voices', async () => {
    const m = new Metronome();
    const handler = vi.fn();
    m.on('tick', handler);
    await m.start();
    m.dispose();
    expect(m.isRunning).toBe(false);
    expect(hoisted.transportMock.stop).toHaveBeenCalledOnce();
    // Re-firing the captured callback after dispose shouldn't invoke handler — handlers cleared.
    const cb = hoisted.getCallback();
    if (cb) {
      try { cb(0); } catch { /* expected — _listeners is empty */ }
    }
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('Metronome — accent toggle', () => {
  it('defaults to accentEnabled=true', () => {
    const m = new Metronome();
    expect(m.accentEnabled).toBe(true);
    m.dispose();
  });

  it('honors accentEnabled=false in constructor', () => {
    const m = new Metronome({ accentEnabled: false });
    expect(m.accentEnabled).toBe(false);
    m.dispose();
  });

  it('event payload isAccent reflects beat position regardless of toggle', async () => {
    // Audio differentiation is gated by the toggle, but the event semantically
    // says "this beat is in the accent set" — UI markers depend on this.
    const accentFlags: boolean[] = [];
    const m = new Metronome({ timeSignature: '4/4', accentEnabled: false });
    m.on('tick', (e) => accentFlags.push(e.isAccent));
    await m.start();
    for (let i = 0; i < 4; i++) tick(i);
    expect(accentFlags).toEqual([true, false, false, false]);
    m.dispose();
  });

  it('accent event still fires when accentEnabled is false', async () => {
    const accents: number[] = [];
    const m = new Metronome({ timeSignature: '4/4', accentEnabled: false });
    m.on('accent', (e) => accents.push(e.beat));
    await m.start();
    for (let i = 0; i < 8; i++) tick(i);
    expect(accents).toEqual([0, 0]); // 2 measures, beat 0 each
    m.dispose();
  });

  it('setAccentEnabled toggles the audio path', async () => {
    const m = new Metronome({ timeSignature: '4/4' });
    expect(m.accentEnabled).toBe(true);
    m.setAccentEnabled(false);
    expect(m.accentEnabled).toBe(false);
    m.setAccentEnabled(true);
    expect(m.accentEnabled).toBe(true);
    m.dispose();
  });
});

describe('Metronome — payload contract', () => {
  it('tick event payload contains all advertised fields', async () => {
    let captured: any;
    const m = new Metronome({ timeSignature: '4/4', bpm: 88 });
    m.on('tick', (e) => { captured = e; });
    await m.start();
    tick(1.234);
    expect(captured).toMatchObject({
      beat: 0,
      measure: 0,
      tickIndex: 0,
      isAccent: true,
      bpm: 88,
      audioTime: 1.234,
    });
    expect(captured.timeSignature.id).toBe('4/4');
    m.dispose();
  });
});

/**
 * Extract the audio times at which the subdivision voice was triggered after a
 * call to the main-tick callback. The subdivision voice is the Synth created with
 * `volume: -6` (see `createDefaultClickVoices`).
 */
function subTickAudioTimes(): number[] {
  const sub = hoisted.findSynthByInitialVolume(-6) as {
    triggerAttackRelease: { mock: { calls: unknown[][] } };
  } | undefined;
  if (!sub) return [];
  return sub.triggerAttackRelease.mock.calls.map((c) => c[2] as number);
}

describe('Metronome — subdivisions', () => {
  it('off (default) schedules no sub-ticks', async () => {
    const m = new Metronome({ bpm: 120 });
    await m.start();
    tick(0);
    expect(subTickAudioTimes()).toHaveLength(0);
    m.dispose();
  });

  it('8ths schedules one sub-tick per beat at the midpoint when swing = 0.5', async () => {
    const m = new Metronome({ bpm: 120, subdivision: '8ths' });
    await m.start();
    // 4/4 at 120 BPM → D = 60/120 = 0.5s. 8ths → 2 sub-ticks per beat; sub-tick
    // at index 1 fires straight-midway, i.e. 0.25s after the main beat.
    tick(0);
    const times = subTickAudioTimes();
    expect(times).toHaveLength(1);
    expect(times[0]).toBeCloseTo(0.25);
    m.dispose();
  });

  it('subdivision event payload carries beat/index/sub-count', async () => {
    vi.useFakeTimers();
    let captured: any;
    const m = new Metronome({ bpm: 120, subdivision: '8ths' });
    m.on('subdivision', (e) => { captured = e; });
    await m.start();
    tick(1.0);
    // setTimeout(... 250ms) for the 8th-note sub-tick at 120 BPM.
    vi.advanceTimersByTime(260);
    expect(captured).toMatchObject({
      beat: 0,
      measure: 0,
      subdivisionIndex: 1,
      subdivisionsPerBeat: 2,
      bpm: 120,
    });
    expect(captured.audioTime).toBeCloseTo(1.25);
    m.dispose();
    vi.useRealTimers();
  });

  it('triplets schedule 2 sub-ticks per beat at 1/3 and 2/3 of the beat', async () => {
    const m = new Metronome({ bpm: 120, subdivision: 'triplets' });
    await m.start();
    tick(0);
    const times = subTickAudioTimes();
    expect(times).toHaveLength(2);
    expect(times[0]).toBeCloseTo(0.5 / 3);
    expect(times[1]).toBeCloseTo((0.5 / 3) * 2);
    m.dispose();
  });

  it('16ths schedule 3 sub-ticks per beat (straight)', async () => {
    const m = new Metronome({ bpm: 120, subdivision: '16ths' });
    await m.start();
    tick(0);
    const times = subTickAudioTimes();
    expect(times).toHaveLength(3);
    const step = 0.5 / 4;
    expect(times[0]).toBeCloseTo(step);
    expect(times[1]).toBeCloseTo(step * 2);
    expect(times[2]).toBeCloseTo(step * 3);
    m.dispose();
  });

  it('sextuplets schedule 5 sub-ticks per beat', async () => {
    const m = new Metronome({ bpm: 120, subdivision: 'sextuplets' });
    await m.start();
    tick(0);
    expect(subTickAudioTimes()).toHaveLength(5);
    m.dispose();
  });

  it('subdivision setting can be toggled at runtime', async () => {
    const m = new Metronome({ bpm: 120 });
    await m.start();
    tick(0);
    expect(subTickAudioTimes()).toHaveLength(0);

    m.setSubdivision('8ths');
    tick(0.5);
    expect(subTickAudioTimes()).toHaveLength(1);

    m.setSubdivision('off');
    tick(1.0);
    // Subdivision-voice mock retains prior calls; subdiv=off should NOT add new ones.
    expect(subTickAudioTimes()).toHaveLength(1);

    m.dispose();
  });

  it('subdivisionChange event fires on setSubdivision', () => {
    const handler = vi.fn();
    const m = new Metronome();
    m.on('subdivisionChange', handler);
    m.setSubdivision('triplets');
    expect(handler).toHaveBeenCalledWith('triplets');
    m.dispose();
  });

  it('setSubdivision is a no-op when value unchanged', () => {
    const handler = vi.fn();
    const m = new Metronome({ subdivision: 'triplets' });
    m.on('subdivisionChange', handler);
    m.setSubdivision('triplets');
    expect(handler).not.toHaveBeenCalled();
    m.dispose();
  });

  it('stop() cancels pending sub-tick events', async () => {
    vi.useFakeTimers();
    const handler = vi.fn();
    const m = new Metronome({ bpm: 120, subdivision: '8ths' });
    m.on('subdivision', handler);
    await m.start();
    tick(0);
    // Sub-tick is scheduled for +250ms. Stop before it fires.
    vi.advanceTimersByTime(100);
    m.stop();
    vi.advanceTimersByTime(500);
    expect(handler).not.toHaveBeenCalled();
    m.dispose();
    vi.useRealTimers();
  });
});

describe('Metronome — swing', () => {
  it('swing on 8ths shifts the up-tick later (75% case)', async () => {
    const m = new Metronome({ bpm: 120, subdivision: '8ths', swing: 0.75 });
    await m.start();
    // D = 0.5s. Pair offset = 2 * 0.75 * (D/N) = 2 * 0.75 * 0.25 = 0.375s.
    tick(0);
    const times = subTickAudioTimes();
    expect(times).toHaveLength(1);
    expect(times[0]).toBeCloseTo(0.375);
    m.dispose();
  });

  it('swing collapses to straight at 0.5 (midpoint)', async () => {
    const m = new Metronome({ bpm: 120, subdivision: '8ths', swing: 0.5 });
    await m.start();
    tick(0);
    expect(subTickAudioTimes()[0]).toBeCloseTo(0.25);
    m.dispose();
  });

  it('clamps swing to [0.5, 0.95]', () => {
    expect(new Metronome({ swing: 0.1 }).swing).toBe(0.5);
    expect(new Metronome({ swing: 0.99 }).swing).toBe(0.95);
    expect(new Metronome({ swing: 0.6 }).swing).toBeCloseTo(0.6);
  });

  it('triplets ignore swing (positions stay evenly spaced)', async () => {
    const m = new Metronome({ bpm: 120, subdivision: 'triplets', swing: 0.75 });
    await m.start();
    tick(0);
    const times = subTickAudioTimes();
    expect(times).toHaveLength(2);
    expect(times[0]).toBeCloseTo(0.5 / 3);
    expect(times[1]).toBeCloseTo((0.5 / 3) * 2);
    m.dispose();
  });

  it('sextuplets ignore swing', async () => {
    const m = new Metronome({ bpm: 120, subdivision: 'sextuplets', swing: 0.75 });
    await m.start();
    tick(0);
    const times = subTickAudioTimes();
    expect(times).toHaveLength(5);
    // All evenly spaced.
    const step = 0.5 / 6;
    for (let i = 0; i < times.length; i++) {
      expect(times[i]).toBeCloseTo(step * (i + 1));
    }
    m.dispose();
  });

  it('16ths with swing shifts only the 2nd and 4th sub-ticks (odd indices)', async () => {
    const m = new Metronome({ bpm: 120, subdivision: '16ths', swing: 0.75 });
    await m.start();
    tick(0);
    const times = subTickAudioTimes();
    expect(times).toHaveLength(3);
    // sub-ticks 1,2,3. D/N = 0.125. swing-pair offset = 2*0.75*0.125 = 0.1875.
    // i=1 (odd, "up" of pair 0): pair-start (0) + 0.1875 = 0.1875.
    // i=2 (even, "down" of pair 1): straight 2*0.125 = 0.25.
    // i=3 (odd, "up" of pair 1): pair-start (2*0.125=0.25) + 0.1875 = 0.4375.
    expect(times[0]).toBeCloseTo(0.1875);
    expect(times[1]).toBeCloseTo(0.25);
    expect(times[2]).toBeCloseTo(0.4375);
    m.dispose();
  });

  it('swingChange event fires on setSwing', () => {
    const handler = vi.fn();
    const m = new Metronome();
    m.on('swingChange', handler);
    m.setSwing(0.67);
    expect(handler).toHaveBeenCalledWith(0.67);
    m.dispose();
  });
});
