import type { FretInstrumentId, VoicePreset } from './types';
import type { VariantRef } from './variant-types';
import { Voice } from './Voice';
import { resolveActiveVoice } from './resolve-active-voice';

export function buildEffectiveVoice(
  instrumentId: FretInstrumentId,
  options?: { autoConnectToMaster?: boolean; voiceRef?: VariantRef | null },
): { voice: Voice; preset: VoicePreset } {
  const preset = resolveActiveVoice(instrumentId, options?.voiceRef ?? null);
  const voice = new Voice(preset, options);
  return { voice, preset };
}
