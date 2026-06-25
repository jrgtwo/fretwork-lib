/**
 * Public surface of `lib/src/patterns`. Re-exported from `lib/src/index.ts`.
 */
export type {
  Tick,
  StepLength,
  ArticulationId,
  DynamicMark,
  PatternEvent,
  Lane,
  PatternTimeSignature,
  GrooveSpec,
  TempoEvent,
  TimeSignatureEvent,
  Pattern,
  Placement,
  Composition,
  Collection,
  Library,
} from './types';

export { effectiveBpm, effectiveTimeSignature, isAutomated } from './automation';

export { generateId, generateUuid } from './ids';

export {
  PPQ,
  stepLengthToTicks,
  ticksPerBar,
  ticksPerBeat,
  secondsPerTick,
  ticksToSeconds,
  defaultPatternDurationTicks,
  snapTick,
} from './timebase';

export {
  createEmptyPattern,
  clonePattern,
  snapshotPatternForPlacement,
  sortedEvents,
  nextEventStartOnString,
  prevEventEndOnString,
  stampEvent,
  resizeEvent,
  resizeEventsBy,
  moveEvent,
  moveEventsBy,
  setEventFret,
  deleteEvents,
  addLane,
  setPatternName,
  setPatternInstrument,
  setPatternDuration,
  fitPatternDuration,
  setPatternTimeSignature,
  setPatternSuggestedBpm,
  setPatternGroove,
  applyPatternMetadata,
  updateEventArticulations,
} from './pattern-ops';
export type {
  PatternMetadataPatch,
  EventDragSnapshot,
  EventResizeSnapshot,
  PatternEventArticulationPatch,
  PatternEventSlideType,
  PatternEventBendType,
} from './pattern-ops';

export {
  createEmptyComposition,
  createEmptyTrack,
  migrateCompositionToTracks,
  totalDurationTicks,
  addPlacement,
  addPlacementToTrack,
  findPlacement,
  movePlacement,
  splitPlacement,
  duplicatePlacements,
  setPlacementRepeat,
  removePlacement,
  setCompositionName,
  setCompositionInstrument,
  setCompositionBpm,
  setCompositionTimeSignature,
  setPlacementSnapshot,
  flattenComposition,
  flattenTrack,
  placementEffectiveLength,
  placementEndTick,
  pushPlacementsForward,
  applyCompositionMetadata,
  setCompositionTempoMode,
  setCompositionGroove,
  setCompositionGrooveMode,
  setPlacementTranspose,
  resizePlacement,
  setCompositionLoop,
  addTrack,
  removeTrack,
  setTrackName,
  setTrackInstrument,
  setTrackVoiceRef,
  setTrackVolumeDb,
  setTrackMuted,
  setTrackSoloed,
  setMasterVolumeDb,
} from './composition-ops';
export type { CompositionMetadataPatch } from './composition-ops';
export { MAX_COMPOSITION_TRACKS } from './types';
export type { Track } from './types';

export { patternFootprint } from './pattern-footprint';
export type { FootprintCell } from './pattern-footprint';

export {
  MAX_FOLDER_DEPTH,
  createEmptyCollection,
  setCollectionName,
  setCollectionParent,
  applyCollectionMetadata,
  getCollectionDepth,
  wouldCreateCycle,
} from './collection-ops';
export type { CollectionMetadataPatch } from './collection-ops';
export type { FlattenedEvent } from './composition-ops';

export {
  GROOVE_PRESETS,
  presetMatching,
} from './groove';
export type { GroovePresetId, GroovePreset } from './groove';

export { resolveEffectivePlayback } from './scheduler/resolvePlayback';
export type { EffectivePlayback } from './scheduler/resolvePlayback';

export { MultiTrackPlayback } from './scheduler/MultiTrackPlayback';
export { CompositionTrackSource } from './scheduler/CompositionTrackSource';
export { wrapTick, currentIterationOffset } from './scheduler/loop-region';
export { applyTempoAutomation } from './scheduler/tempoAutomation';
export type { BpmSetter } from './scheduler/tempoAutomation';
export { applyTimeSignatureAutomation } from './scheduler/timeSignatureAutomation';
export type { TimeSignatureSetter } from './scheduler/timeSignatureAutomation';
export { mergeTrackPlacementsAutomation } from './scheduler/mergeTrackPlacementsAutomation';

export { selectCompositionsUsingPattern } from './store/usePatternsStore';

export { planCagedInsert, isCagedInsertApplicable } from './caged-insert';
export type {
  CagedInsertRequest,
  CagedInsertMode,
  CagedInsertPlan,
  CagedTraversal,
  PlannedNote,
  ChordQuality,
} from './caged-insert';

export {
  BUILTIN_PATTERNS,
  BUILTIN_PATTERN_GROUPS,
  BUILTIN_COMPOSITIONS,
  BUILTIN_COLLECTION,
  BUILTIN_COLLECTIONS,
  BUILTIN_COLLECTION_ID,
  isBuiltinId,
} from './builtin';
