import type { MouseEvent as ReactMouseEvent } from 'react';
import type { Highlight, LabelMode, FretworkSettings } from '../../types';
import { fretCenterX } from '../../lib/fretboard';
import { MARKER_R, NECK_LENGTH, NECK_X, stringY } from './layout';

interface Props {
  highlight: Highlight;
  labels: LabelMode;
  settings: FretworkSettings;
  /** Active instrument's string count — needed for vertical positioning. */
  stringCount: number;
  /** Active instrument's fret count — needed for horizontal positioning. */
  fretCount: number;
  /** When true, render with playhead treatment — bright pulsing ring + scale up. */
  isPlayhead?: boolean;
  /** When set, render the sequence number badge instead of the normal label (for
   * custom-pattern programming mode). 1-based. -1 means "not in the sequence". */
  programmingIndex?: number;
  /** Click handler — receives the React event so consumers can read modifier keys
   *  (e.g. shift for chord-stamping). Only attached when clickable. */
  onClick?: (event: ReactMouseEvent) => void;
  /** When true, render this marker translucently — used to "ghost" notes that are
   *  in the active scale but outside the selected CAGED shape. The fretboard skips
   *  rendering ghosted markers entirely when the user has turned ghost markers off. */
  ghosted?: boolean;
}

const CATEGORY_TO_VAR: Record<Highlight['category'], string> = {
  root: 'var(--degree-root)',
  third: 'var(--degree-third)',
  fifth: 'var(--degree-fifth)',
  tone: 'var(--degree-tone)',
};

function resolveColor(highlight: Highlight, settings: FretworkSettings): string {
  // Highlight root takes precedence: always amber when root, regardless of color mode.
  if (settings.highlightRoot && highlight.category === 'root') {
    return `hsl(${CATEGORY_TO_VAR.root})`;
  }
  if (!settings.colorByDegree) {
    return `hsl(${CATEGORY_TO_VAR.tone})`;
  }
  return `hsl(${CATEGORY_TO_VAR[highlight.category]})`;
}

export function NoteMarker({
  highlight,
  labels,
  settings,
  stringCount,
  fretCount,
  isPlayhead,
  programmingIndex,
  onClick,
  ghosted,
}: Props) {
  const { stringIndex, fret } = highlight;
  const cx =
    fret === 0
      ? NECK_X - 16 // open-string marker sits in the headstock area
      : NECK_X + fretCenterX(fret, NECK_LENGTH, fretCount);
  const cy = stringY(stringIndex, stringCount);

  const fill = resolveColor(highlight, settings);
  const isLight = highlight.category === 'tone' || (!settings.colorByDegree && !(settings.highlightRoot && highlight.category === 'root'));
  const textFill = isLight ? 'hsl(24 30% 12%)' : 'hsl(32 25% 96%)';

  // Determine label content + size. Programming-mode sequence number takes precedence.
  let label = '';
  let fontSize = 11;
  const inProgrammingSequence = programmingIndex != null && programmingIndex >= 0;
  if (inProgrammingSequence) {
    label = String((programmingIndex as number) + 1);
    fontSize = (programmingIndex as number) + 1 >= 10 ? 9 : 11;
  } else {
    if (labels === 'notes') label = highlight.noteName;
    else if (labels === 'intervals') label = highlight.intervalLabel;
    fontSize = label.length >= 2 ? 9 : 11;
  }

  const groupClass = [
    'animate-marker-pop',
    'fb-marker',
    isPlayhead ? 'fb-playhead' : '',
    onClick ? 'fb-clickable' : '',
    ghosted ? 'fb-ghosted' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <g
      className={groupClass}
      style={{ transformOrigin: `${cx}px ${cy}px`, opacity: ghosted ? 0.22 : undefined }}
      onClick={onClick}
    >
      <title>{`${highlight.noteName} · ${highlight.intervalLabel} · string ${stringIndex + 1}, fret ${fret}`}</title>
      {/* Drop shadow */}
      <circle cx={cx} cy={cy + 1.5} r={MARKER_R} fill="hsl(0 0% 0%)" opacity={0.45} />
      {/* Playhead pulse ring — outer, animated. Only renders when isPlayhead is true. */}
      {isPlayhead && (
        <circle
          cx={cx}
          cy={cy}
          r={MARKER_R + 6}
          fill="none"
          stroke="hsl(var(--degree-root))"
          strokeWidth={2.5}
          opacity={0.85}
          className="fb-playhead-ring"
        />
      )}
      {/* Body */}
      <circle cx={cx} cy={cy} r={MARKER_R} fill={fill} />
      {/* Inner gloss highlight */}
      <ellipse
        cx={cx}
        cy={cy - MARKER_R * 0.4}
        rx={MARKER_R * 0.7}
        ry={MARKER_R * 0.32}
        fill="hsl(0 0% 100%)"
        opacity={0.28}
      />
      {/* Outline — slightly thicker if this cell is in the programming sequence. */}
      <circle
        cx={cx}
        cy={cy}
        r={MARKER_R}
        fill="none"
        stroke={inProgrammingSequence ? 'hsl(var(--pearl))' : 'hsl(0 0% 0%)'}
        strokeOpacity={inProgrammingSequence ? 0.9 : 0.35}
        strokeWidth={inProgrammingSequence ? 1.6 : 0.8}
      />
      {label && (
        <text
          x={cx}
          y={cy + fontSize * 0.36}
          textAnchor="middle"
          fontSize={fontSize}
          fontFamily={inProgrammingSequence ? '"JetBrains Mono", ui-monospace, monospace' : 'Inter, ui-sans-serif, system-ui, sans-serif'}
          fontWeight={inProgrammingSequence ? 700 : 600}
          fill={textFill}
          pointerEvents="none"
        >
          {label}
        </text>
      )}
    </g>
  );
}
