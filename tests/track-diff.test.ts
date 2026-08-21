import { describe, it, expect } from 'vitest';
import { diffTracks } from '../src/patterns/scheduler/track-diff';
import {
  createEmptyComposition,
  createEmptyPattern,
  addPlacement,
} from '../src/patterns';

function oneTrackComp() {
  let comp = createEmptyComposition();
  comp = addPlacement(comp, createEmptyPattern()).composition;
  return comp;
}

describe('diffTracks', () => {
  it('flags a placements-reference change as restream', () => {
    const prev = oneTrackComp();
    const next = {
      ...prev,
      tracks: prev.tracks.map((t) => ({ ...t, placements: [...t.placements] })),
    };
    expect(diffTracks(prev, next)[0]).toEqual({
      trackId: prev.tracks[0].id,
      action: 'restream',
    });
  });

  it('flags a voiceRef change as voice', () => {
    const prev = oneTrackComp();
    const next = {
      ...prev,
      tracks: prev.tracks.map((t) => ({ ...t, voiceRef: { kind: 'default', slotId: 'x' } })),
    };
    expect(diffTracks(prev, next)[0].action).toBe('voice');
  });

  it('flags a volume change as gain', () => {
    const prev = oneTrackComp();
    const next = {
      ...prev,
      tracks: prev.tracks.map((t) => ({ ...t, volumeDb: -6 })),
    };
    expect(diffTracks(prev, next)[0].action).toBe('gain');
  });

  /* CP-19: pan rides the same audio-rate node family as volume/mute/solo, so
     it belongs in the gain bucket. Both 'gain' and 'none' fall through to
     `applyTrackState`, so the sound is the same either way — what this pins is
     that pan is never read as something HEAVIER, which is the restream path. */
  it('flags a pan change as gain', () => {
    const prev = oneTrackComp();
    const next = {
      ...prev,
      tracks: prev.tracks.map((t) => ({ ...t, pan: -0.5 })),
    };
    expect(diffTracks(prev, next)[0].action).toBe('gain');
  });

  it('still flags a placements change as restream when pan changed too', () => {
    const prev = oneTrackComp();
    const next = {
      ...prev,
      tracks: prev.tracks.map((t) => ({ ...t, pan: 1, placements: [...t.placements] })),
    };
    expect(diffTracks(prev, next)[0].action).toBe('restream');
  });

  it('flags an unchanged track as none', () => {
    const prev = oneTrackComp();
    expect(diffTracks(prev, prev)[0].action).toBe('none');
  });

  it('prioritizes restream over voice when both change', () => {
    const prev = oneTrackComp();
    const next = {
      ...prev,
      tracks: prev.tracks.map((t) => ({
        ...t,
        placements: [...t.placements],
        voiceRef: { kind: 'default', slotId: 'x' },
      })),
    };
    expect(diffTracks(prev, next)[0].action).toBe('restream');
  });
});
