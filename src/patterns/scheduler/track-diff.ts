/**
 * Pure per-track live-update decision for composition playback. Given the
 * previous and next composition snapshots (same track ids, same order —
 * structural add/remove is handled separately by the caller), decide what live
 * audio op each track needs. No Tone, no side effects.
 */

import type { Composition } from '../types';

export type TrackAction = 'restream' | 'voice' | 'gain' | 'none';
export interface TrackDiff {
  trackId: string;
  action: TrackAction;
}

/** Priority: placement content change > voice/instrument change > gain-state
 *  change (volume/mute/solo) > none. A track present in `next` but not `prev`
 *  is treated as `restream` (defensive; the caller normally rebuilds on a
 *  structural change before reaching here). */
export function diffTracks(prev: Composition, next: Composition): TrackDiff[] {
  return next.tracks.map((t, i) => {
    const p = prev.tracks[i];
    let action: TrackAction = 'none';
    if (!p || t.placements !== p.placements) {
      action = 'restream';
    } else if (t.voiceRef !== p.voiceRef || t.instrumentId !== p.instrumentId) {
      action = 'voice';
    } else if (
      t.volumeDb !== p.volumeDb ||
      t.muted !== p.muted ||
      t.soloed !== p.soloed
    ) {
      action = 'gain';
    }
    return { trackId: t.id, action };
  });
}
