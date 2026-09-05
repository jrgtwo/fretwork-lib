export * from './types';
export * from './presets';
export * from './slots';
export * from './variant-types';
export { useVoiceStore, VOICE_STORAGE_KEY } from './useVoiceStore';
export { resolveActiveVoice } from './resolve-active-voice';
export { buildEffectiveVoice } from './buildEffectiveVoice';
export { Voice } from './Voice';
export { describeGainStructure, GAIN_STRUCTURE_PROBE_INPUTS } from './gain-structure';
export { peakDbFromSamples, createPeakMeter, readPeakDb, PEAK_METER_SIZE } from './peak-meter';
export {
  REFERENCE_LEVEL_DBFS,
  SAMPLE_PACK_PEAK_DBFS,
  sourceTrimDb,
  trimForPeakDb,
  isSourceCalibrated,
} from './levels';
export type {
  GainStructure,
  GainStructureStage,
  GainStructureOptions,
  ShaperResponse,
  SmallSignalGainDb,
} from './gain-structure';
export { MasterBus } from './MasterBus';
export {
  SAMPLE_PACKS,
  getSamplePack,
  detectSamplePack,
  prefetchSampleBanks,
} from './sample-packs';
export type { SamplePack } from './sample-packs';

// Experimental circuit-modelled amps. Additive: the five models in
// `amp-models.ts` and everything using them are untouched.
export {
  CIRCUIT_AMPS,
  getCircuitAmp,
  DEFAULT_CIRCUIT_AMP_ID,
} from './circuit-amp/registry';
export type {
  CircuitAmp,
  CircuitAmpControl,
  CircuitAmpCircuit,
} from './circuit-amp/types';
