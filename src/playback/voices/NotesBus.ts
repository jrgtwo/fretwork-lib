/**
 * NotesBus — an independent volume stage for note (voice) playback.
 *
 * Topology:
 *
 *     voice.output ─► NotesBus.gain ─► MasterBus.input ─► … ─► destination
 *
 * Every voice that AUTO-connects to the master routes through here first
 * (practice walk-notes, single-pattern playback, Sound Lab auditions). The
 * composition arranger opts OUT of auto-connect (it inserts its own per-track
 * gains + a per-composition master), so it does NOT pass through this bus —
 * its notes-volume is the composition master fader instead.
 *
 * This is deliberately SEPARATE from `MasterBus`'s global master gain: the
 * metronome click bypasses MasterBus entirely (`.toDestination()`), so this
 * gain only ever scales the ringing notes, never the click. That makes it the
 * "notes volume" the Practice / Patterns ribbons expose, independent of both
 * the metronome click volume and the global master.
 *
 * Linear 0–1 level (symmetric with the click VolumeSlider), default 1.0
 * (unity). Not persisted — matches the metronome click volume.
 */
import * as Tone from 'tone';
import { MasterBus } from './MasterBus';

function clampLevel(v: number): number {
  if (!Number.isFinite(v)) return 1;
  return Math.max(0, Math.min(1, v));
}

class NotesBusImpl {
  private _gain: Tone.Gain | null = null;
  /** Linear 0–1. Applied to the gain node once it exists. */
  private _level = 1;

  /** Build the gain on first audio use and wire it into the master bus. */
  private _ensure(): Tone.Gain {
    if (this._gain) return this._gain;
    const gain = new Tone.Gain(this._level);
    MasterBus.connectVoice(gain);
    this._gain = gain;
    return gain;
  }

  /** Connection point for auto-connecting voices (mirrors MasterBus.connectVoice). */
  connectVoice(node: Tone.ToneAudioNode): void {
    node.connect(this._ensure());
  }

  /** Disconnect a voice. Safe even if it was never connected. */
  disconnectVoice(node: Tone.ToneAudioNode): void {
    if (!this._gain) return;
    try {
      node.disconnect(this._gain);
    } catch {
      // Already disconnected — fine.
    }
  }

  /** Current notes level, linear 0–1. */
  getLevel(): number {
    return this._level;
  }

  /** Set the notes level (linear 0–1). Ramps to avoid pops. Safe before the
   *  gain is built — the value is applied when the bus initialises. */
  setLevel(v: number): void {
    const next = clampLevel(v);
    this._level = next;
    if (this._gain) this._gain.gain.rampTo(next, 0.02);
  }
}

export const NotesBus = new NotesBusImpl();
