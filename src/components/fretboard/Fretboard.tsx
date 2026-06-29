import { useCallback, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { fretX } from '../../lib/fretboard';
import { noteAt } from '../../lib/theory';
import type { Highlight } from '../../types';
import { cn } from '../../lib/utils';
import { FretLines } from './FretLines';
import { Strings } from './Strings';
import { Headstock } from './Headstock';
import { CapoBar } from './CapoBar';
import { NoteMarker } from './NoteMarker';
import { VIEWBOX_H, VIEWBOX_W, NECK_X, NECK_LENGTH, TOP_PAD, STRING_AREA, getStringSpacing } from './layout';
import { usePlaybackStore } from '../../playback/usePlaybackStore';
import { cellsEqual } from '../../playback/types';
import { useFretboardModel } from './useFretboardModel';

// Set of fret numbers that always show a marker in inlayGrid mode: open strings
// (fret 0) plus all standard inlay positions (3, 5, 7, 9, 12, 15, 17, 19, 21).

export interface FretboardProps {
  /**
   * When provided, overrides the default click-to-program behavior. Click events on
   * any cell — regardless of `isProgramming` state — are routed here instead. Used by
   * the Patterns page to wire fretboard taps into its step-stamping store. When
   * undefined (default), the legacy programming-mode behavior remains intact.
   */
  onCellClickOverride?: (cell: { stringIndex: number; fret: number }, modifiers: { shift: boolean }) => void;
  /**
   * When true, renders a neutral marker on EVERY fret×string cell instead of just
   * the scale/arpeggio-derived highlights. Scale color-coding, CAGED filtering, and
   * key-based labels are all suppressed; the fretboard becomes a blank grid that
   * exists only to be played and to display playback state. Used by the Patterns
   * page where there is no "active scale" concept.
   */
  neutralGrid?: boolean;
  /**
   * Cells to highlight with the playhead treatment (bright color + pulse ring). Used
   * by the Patterns page to light up currently-sounding events from its scheduler.
   * Supports chords (multiple cells at once). When undefined and not in `neutralGrid`
   * mode, the legacy single-cell playhead from `usePlaybackStore.currentPlayheadCell`
   * is used instead.
   */
  activeCells?: ReadonlyArray<{ stringIndex: number; fret: number }>;
  /**
   * The dim "context" layer for Practice's Pattern mode: every cell a pattern
   * visits (its footprint), drawn as ghosted neutral markers behind the bright
   * activity layer. Makes no theory claim — it's just the pattern's own cells.
   * Cells that are currently active (in `activeCells`) are drawn bright instead,
   * not dimmed here. Independent of the scale highlight set.
   */
  footprintCells?: ReadonlyArray<{ stringIndex: number; fret: number }>;
  /**
   * When true, clicks on the fretboard always invoke `onCellClickOverride` regardless
   * of the legacy `isProgramming` flag. Used by the Patterns page to keep its editor
   * decoupled from Practice's programming state.
   */
  alwaysClickable?: boolean;
  /**
   * Caller-supplied override of the internally-computed scale highlights. When
   * provided, the component uses this set as its "active highlights" instead of
   * deriving them from `useFretworkStore`. Consumers that drive highlights from
   * a non-global source (e.g., the pattern editor's pattern-specific key) pass
   * this. Has no effect in `neutralGrid` mode.
   */
  highlights?: readonly Highlight[];
  /**
   * Render every fret × string cell as a visible marker (like `neutralGrid`),
   * but apply the normal degree-colored styling to cells in the active
   * highlights set and a dimmed/ghosted styling to the rest. Mutually
   * exclusive with `neutralGrid`. Used by the Patterns editor's fretboard
   * input when the pattern has a key set — in-key cells stand out by color,
   * out-of-key cells stay clickable but visually de-emphasized.
   */
  dimNonHighlighted?: boolean;
  /**
   * When true, renders neutral markers only at fret 0 (open notes) and at the
   * standard inlay frets (3, 5, 7, 9, 12, 15, 17, 19, 21). Plus, whichever cell
   * is currently being hovered — providing a "where would I stamp?" preview at
   * any fret while keeping the default view uncluttered. Mutually exclusive
   * with `neutralGrid` and `dimNonHighlighted`. Used by the Patterns editor
   * when the pattern has no key set.
   */
  inlayGrid?: boolean;
}

export function Fretboard({
  onCellClickOverride,
  neutralGrid,
  activeCells,
  footprintCells,
  alwaysClickable,
  highlights: highlightsProp,
  dimNonHighlighted,
  inlayGrid,
}: FretboardProps = {}) {
  const {
    instrumentId,
    fretCount,
    stringCount,
    tuning,
    capo,
    effectiveKey,
    type,
    labels,
    settings,
    leftHanded,
    openStrings,
    renderHighlights,
    renderedKeys,
    inShapeKeys,
    activeCellKeys,
    playheadCell,
    activityOnlyHighlights,
    footprintHighlights,
    isProgramming,
    customSequence,
    playback,
  } = useFretboardModel({
    highlights: highlightsProp,
    neutralGrid,
    dimNonHighlighted,
    activeCells,
    footprintCells,
  });

  const onCellClick = useCallback(
    (cell: { stringIndex: number; fret: number }, shift: boolean) => {
      if (onCellClickOverride) {
        onCellClickOverride(cell, { shift });
        return;
      }
      if (!isProgramming) return;
      playback?.addCustomCell(cell);
      // Mirror to store for the UI to re-render with the new badge.
      usePlaybackStore.setState((s) => {
        if (s.customSequence.some((c) => cellsEqual(c, cell))) {
          return s;
        }
        return { customSequence: [...s.customSequence, cell] };
      });
    },
    [isProgramming, playback, onCellClickOverride],
  );

  const clickable = alwaysClickable || isProgramming || Boolean(onCellClickOverride);

  const [hoverCell, setHoverCell] = useState<{ stringIndex: number; fret: number } | null>(null);

  return (
    <div className={cn('w-full overflow-x-auto scrollbar-thin', leftHanded && 'fb-left-handed')}>
      <svg
        viewBox={`0 0 ${VIEWBOX_W} ${VIEWBOX_H}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`Fretboard showing ${effectiveKey} ${type} in ${tuning.name}`}
        className="w-full min-w-[820px] h-auto select-none"
        style={{ filter: 'drop-shadow(0 30px 40px rgba(0,0,0,0.35))' }}
      >
        <defs>
          <linearGradient id="wood-grain" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--rosewood-light))" />
            <stop offset="50%" stopColor="hsl(var(--rosewood))" />
            <stop offset="100%" stopColor="hsl(var(--rosewood-dark))" />
          </linearGradient>
          <pattern id="grain-stripes" width="4" height={VIEWBOX_H} patternUnits="userSpaceOnUse">
            <rect width="4" height={VIEWBOX_H} fill="transparent" />
            <line x1="0" y1="0" x2="0" y2={VIEWBOX_H} stroke="hsl(0 0% 0%)" strokeOpacity={0.05} strokeWidth={1} />
          </pattern>
        </defs>

        {/* Neck base */}
        <rect
          x={NECK_X - 6}
          y={TOP_PAD - 4}
          width={NECK_LENGTH + 16}
          height={STRING_AREA + 8}
          fill="url(#wood-grain)"
          rx={3}
        />
        <rect
          x={NECK_X - 6}
          y={TOP_PAD - 4}
          width={NECK_LENGTH + 16}
          height={STRING_AREA + 8}
          fill="url(#grain-stripes)"
          rx={3}
        />

        <FretLines fretCount={fretCount} stringCount={stringCount} />
        <CapoBar capo={capo} fretCount={fretCount} />
        <Strings stringCount={stringCount} instrumentId={instrumentId} />
        <Headstock openStrings={openStrings} />

        {/* Click-target grid — transparent rectangles for every fret × string. Only
            rendered when an explicit override handler is provided (i.e., the Patterns
            page wants ANY fret clickable, not just the scale-highlighted ones). For
            Practice page (no override), this layer is skipped so the legacy "only
            click the highlighted cells when programming" behavior remains. */}
        {clickable && onCellClickOverride && (() => {
          const cellH = getStringSpacing(stringCount);
          const cells: React.ReactElement[] = [];
          for (let s = 0; s < stringCount; s++) {
            const cy = TOP_PAD + (stringCount - 1 - s) * cellH;
            // y position: center the click target on the string line
            const y = cy - cellH / 2;
            for (let f = 0; f <= fretCount; f++) {
              let x: number;
              let w: number;
              if (f === 0) {
                // Open-string cell lives in the headstock area.
                x = 0;
                w = NECK_X;
              } else {
                const left = NECK_X + fretX(f - 1, NECK_LENGTH, fretCount);
                const right = NECK_X + fretX(f, NECK_LENGTH, fretCount);
                x = left;
                w = right - left;
              }
              cells.push(
                <rect
                  key={`hit-${s}-${f}`}
                  x={x}
                  y={y}
                  width={w}
                  height={cellH}
                  fill="transparent"
                  className="fb-cell-hit"
                  onClick={(e: ReactMouseEvent) =>
                    onCellClick({ stringIndex: s, fret: f }, e.shiftKey || e.metaKey)
                  }
                  onMouseEnter={() => setHoverCell({ stringIndex: s, fret: f })}
                  onMouseLeave={() =>
                    setHoverCell((cur) =>
                      cur && cur.stringIndex === s && cur.fret === f ? null : cur,
                    )
                  }
                  style={{ cursor: 'pointer' }}
                />,
              );
            }
          }
          return <g aria-hidden>{cells}</g>;
        })()}

        {renderHighlights.map((h) => {
          const cellKey = `${h.stringIndex}:${h.fret}`;
          const isPlayhead =
            (activeCellKeys && activeCellKeys.has(cellKey)) ||
            (playheadCell != null && cellsEqual(playheadCell, h));
          let programmingIndex = -1;
          if (!neutralGrid && isProgramming) {
            for (let i = 0; i < customSequence.length; i++) {
              const c = customSequence[i];
              if (cellsEqual(c, h)) {
                programmingIndex = i;
                break;
              }
            }
          }
          // CAGED shape filter — only applies in the standard (non-neutral) mode.
          const inShape = inShapeKeys ? inShapeKeys.has(cellKey) : true;
          if (!inShape && !settings.showGhostMarkers) return null;

          // NeutralGrid forces every cell to render as a neutral tone; other modes
          // use the highlight's own degree styling.
          const effectiveLabels = neutralGrid ? 'notes' : labels;
          const effectiveSettings = neutralGrid
            ? { ...settings, colorByDegree: false, highlightRoot: false }
            : settings;

          return (
            <NoteMarker
              key={`${h.stringIndex}-${h.fret}`}
              highlight={h}
              labels={effectiveLabels}
              settings={effectiveSettings}
              stringCount={stringCount}
              fretCount={fretCount}
              isPlayhead={isPlayhead}
              programmingIndex={
                !neutralGrid && isProgramming ? programmingIndex : undefined
              }
              onClick={
                clickable
                  ? (e: ReactMouseEvent) =>
                      onCellClick(
                        { stringIndex: h.stringIndex, fret: h.fret },
                        e.shiftKey || e.metaKey,
                      )
                  : undefined
              }
              ghosted={!inShape}
            />
          );
        })}

        {/* Context layer — the pattern's footprint (territory), drawn dim/ghosted
            behind the activity layer so the playing notes read as a route on top. */}
        {footprintHighlights.map((h) => (
          <g key={`footprint-${h.stringIndex}-${h.fret}`} pointerEvents="none">
            <NoteMarker
              highlight={h}
              labels="notes"
              settings={{ ...settings, colorByDegree: false, highlightRoot: false }}
              stringCount={stringCount}
              fretCount={fretCount}
              isPlayhead={false}
              ghosted
            />
          </g>
        ))}

        {/* Activity layer — playing/playhead cells not already drawn above.
            Rendered with the bright playhead treatment and neutral (no-degree)
            styling, since they live outside the displayed scale context. */}
        {activityOnlyHighlights.map((h) => (
          <NoteMarker
            key={`active-${h.stringIndex}-${h.fret}`}
            highlight={h}
            labels="notes"
            settings={{ ...settings, colorByDegree: false, highlightRoot: false }}
            stringCount={stringCount}
            fretCount={fretCount}
            isPlayhead
            ghosted={false}
          />
        ))}

        {(inlayGrid || dimNonHighlighted) && hoverCell &&
          !renderedKeys.has(`${hoverCell.stringIndex}:${hoverCell.fret}`) && (() => {
          // Build a synthetic Highlight for the hovered cell — provides a "where would
          // I stamp?" preview for cells that aren't already rendered (out-of-key in
          // dim mode; any non-inlay cell in inlay-only mode). Wrap in
          // pointer-events:none so the marker itself doesn't intercept mouse events
          // from the underlying click-target rect, which would otherwise cause a
          // hover-flicker loop.
          const openNote = openStrings[hoverCell.stringIndex];
          if (!openNote) return null;
          const hoverHighlight: Highlight = {
            stringIndex: hoverCell.stringIndex,
            fret: hoverCell.fret,
            noteName: noteAt(openNote, hoverCell.fret),
            intervalLabel: '',
            degreeNumber: 0,
            category: 'tone',
          };
          return (
            <g pointerEvents="none">
              <NoteMarker
                key="hover-marker"
                highlight={hoverHighlight}
                labels="notes"
                settings={{ ...settings, colorByDegree: false, highlightRoot: false }}
                stringCount={stringCount}
                fretCount={fretCount}
                isPlayhead={false}
                ghosted={false}
              />
            </g>
          );
        })()}
      </svg>
    </div>
  );
}
