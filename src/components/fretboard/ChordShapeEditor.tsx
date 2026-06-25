import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFretworkStore } from '../../store/useFretworkStore';
import { getInstrument, DEFAULT_INSTRUMENT_ID } from '../../lib/instruments';
import { fretX } from '../../lib/fretboard';
import { VIEWBOX_W, NECK_X, NECK_LENGTH } from './layout';
import { Fretboard } from './Fretboard';
import { toggleGripCell } from './grip-edit';
import type { Grip } from '../../lib/chord-voicing';

export interface ChordShapeEditorProps {
  /** Current grip (≤ one note per string). */
  value: Grip;
  /** Called with the next grip on every selection edit. */
  onChange: (next: Grip) => void;
  /**
   * Fret the window opens centered on (auto-position seed). Defaults to the
   * lowest fret in the grip, or 0 when the grip is empty. A one-time seed — the
   * user can scroll anywhere afterward.
   */
  initialFret?: number;
  /** Audition hook, fired when a note is *added* (not when removed). */
  onAudition?: (cell: { stringIndex: number; fret: number }) => void;
  /** Visible window width in frets. Sized to the widest six frets by default. */
  windowFrets?: number;
}

/**
 * Windowed chord-shape editor: the real `<Fretboard>` (unchanged geometry)
 * shown through a viewport as wide as the first `windowFrets` frets, scrolled
 * across the neck. Click a cell to toggle it into the grip; the selection stays
 * lit. The grip is at most one note per string (see `toggleGripCell`).
 *
 * Reads instrument/tuning from the global fretboard store (same as `<Fretboard>`),
 * so the caller should have the intended instrument active.
 */
export function ChordShapeEditor({
  value,
  onChange,
  initialFret,
  onAudition,
  windowFrets = 6,
}: ChordShapeEditorProps) {
  const instrumentId = useFretworkStore((s) => s.instrumentId);
  const instrument = getInstrument(instrumentId) ?? getInstrument(DEFAULT_INSTRUMENT_ID)!;
  const fretCount = instrument.fretCount;

  const scrollRef = useRef<HTMLDivElement>(null);

  // viewBox width of the visible window: from the nut (x=0, includes open
  // strings) through `windowFrets`. The inner neck is rendered `ratio` wider
  // than the viewport so exactly that many frets fill it.
  const { ratio, windowViewBoxW } = useMemo(() => {
    const w = NECK_X + fretX(windowFrets, NECK_LENGTH, fretCount);
    return { ratio: VIEWBOX_W / w, windowViewBoxW: w };
  }, [windowFrets, fretCount]);

  const seedFret = useMemo(() => {
    if (initialFret != null) return initialFret;
    const frets = value.cells.map((c) => c.fret).filter((f) => f > 0);
    return frets.length ? Math.min(...frets) : 0;
  }, [initialFret, value]);

  // Auto-position: scroll so the seed fret sits ~one fret in from the left edge.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const innerWidth = el.scrollWidth;
    const leftViewBox = NECK_X + fretX(Math.max(0, seedFret - 1), NECK_LENGTH, fretCount);
    el.scrollLeft = (leftViewBox / VIEWBOX_W) * innerWidth;
    // Only re-seed when the seed fret changes (not on every grip edit).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedFret, fretCount]);

  const handleClick = (cell: { stringIndex: number; fret: number }) => {
    const next = toggleGripCell(value, cell);
    onChange(next);
    const added = next.cells.length > value.cells.length;
    if (added) onAudition?.(cell);
  };

  return (
    <div ref={scrollRef} className="w-full overflow-x-auto scrollbar-thin">
      <div style={{ width: `${ratio * 100}%`, minWidth: `${windowViewBoxW}px` }}>
        <Fretboard
          neutralGrid
          alwaysClickable
          activeCells={value.cells}
          onCellClickOverride={handleClick}
        />
      </div>
    </div>
  );
}
