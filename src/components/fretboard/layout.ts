/**
 * Shared layout constants for the fretboard SVG. All units are viewBox units
 * (unitless), interpreted as pixels at 1:1 zoom but scaled responsively in CSS.
 *
 * String count is NOT hardcoded — `getStringSpacing()` and `stringY()` accept a count
 * parameter so the same layout works for guitar (6), bass (4), and ukulele (4).
 */

export const HEADSTOCK_WIDTH = 78;
export const NECK_LENGTH = 1100;
export const VIEWBOX_W = HEADSTOCK_WIDTH + NECK_LENGTH + 24;

export const TOP_PAD = 38;
export const STRING_AREA = 220;
export const BOTTOM_PAD = 22;
export const VIEWBOX_H = TOP_PAD + STRING_AREA + BOTTOM_PAD;

/** Vertical distance between adjacent strings, given the active string count. */
export function getStringSpacing(stringCount: number): number {
  return STRING_AREA / Math.max(1, stringCount - 1);
}

/**
 * Y coordinate of a given string index. Index 0 is the BOTTOM (matching tab convention
 * where the highest-pitch string for guitar sits at the top of the diagram). For
 * reentrant tunings (e.g. ukulele G-C-E-A), index 0 is still the visual bottom even
 * though it isn't the lowest pitch.
 */
export function stringY(stringIndex: number, stringCount: number): number {
  return TOP_PAD + (stringCount - 1 - stringIndex) * getStringSpacing(stringCount);
}

/** Where the playable neck starts horizontally (right edge of headstock). */
export const NECK_X = HEADSTOCK_WIDTH;

/** Marker radius used by NoteMarker. */
export const MARKER_R = 14;
