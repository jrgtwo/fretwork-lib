/**
 * Pattern registry. Order in this array determines display order in the dropdown.
 */
import type { PlaybackPattern } from '../types';
import { ascendingPitchPattern, ASCENDING_PITCH_ID } from './ascending-pitch';
import { stringByStringPattern, STRING_BY_STRING_ID } from './string-by-string';
import { upAndDownPattern, UP_AND_DOWN_ID } from './up-and-down';
import { CAGED_PATTERNS, CAGED_PATTERN_IDS } from './caged';
import { customPattern, CUSTOM_PATTERN_ID } from './custom';

export const PLAYBACK_PATTERNS: readonly PlaybackPattern[] = [
  ascendingPitchPattern,
  stringByStringPattern,
  upAndDownPattern,
  ...CAGED_PATTERNS,
  customPattern,
];

const BY_ID = new Map(PLAYBACK_PATTERNS.map((p) => [p.id, p]));

export function getPlaybackPattern(id: string): PlaybackPattern | undefined {
  return BY_ID.get(id);
}

export const DEFAULT_PATTERN_ID = ASCENDING_PITCH_ID;

export {
  ASCENDING_PITCH_ID,
  STRING_BY_STRING_ID,
  UP_AND_DOWN_ID,
  CUSTOM_PATTERN_ID,
  CAGED_PATTERN_IDS,
};
