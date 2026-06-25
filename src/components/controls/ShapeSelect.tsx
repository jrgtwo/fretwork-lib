import { useMemo } from 'react';
import { useFretworkStore } from '../../store/useFretworkStore';
import { SelectControl } from './SelectControl';
import { getInstrument } from '../../lib/instruments';
import { getTuning } from '../../lib/tunings';
import { getScale } from '../../lib/scales';
import { getArpeggio } from '../../lib/arpeggios';
import { computeHighlights, buildGrid } from '../../lib/fretboard';
import {
  getCagedShapeSetForInput,
  getCagedPositionMap,
} from '../../playback/patterns/caged';
import type { ResolveInput } from '../../playback/types';
import type { CagedShape, CagedShapeId } from '../../playback/patterns/caged-shapes-data';
import type { IntervalSet } from '../../types';

const FULL_SCALE_VALUE = '__full__';

/**
 * CAGED shape (Position) selector. Renders for both scales and arpeggios modes
 * (CAGED applies to both — arpeggios use the same five fret-window templates,
 * filtered to only the arpeggio's pitch classes). Hidden when:
 *  - the active scale/arpeggio doesn't have a CAGED shape set (e.g. blues)
 *  - the active instrument isn't guitar (CAGED is a guitar tradition; bass/uke
 *    fall back to the full view)
 *
 * Options are dynamically labelled `Position N — X shape` per the active key,
 * using `getCagedPositionMap` so they match the labelling everywhere else
 * (Sound Lab, playback dropdown).
 */
export function ShapeSelect() {
  const mode = useFretworkStore((s) => s.mode);
  const instrumentId = useFretworkStore((s) => s.instrumentId);
  const key = useFretworkStore((s) => s.key);
  const type = useFretworkStore((s) => s.type);
  const tuningId = useFretworkStore((s) => s.tuning);
  const capo = useFretworkStore((s) => s.capo);
  const shapeId = useFretworkStore((s) => s.shapeId);
  const setShapeId = useFretworkStore((s) => s.setShapeId);

  // Compute Position N → CAGED letter for the active state. Memoized so we don't
  // re-resolve every render.
  const sortedShapes = useMemo<readonly { id: CagedShapeId; letter: CagedShape['letter']; position: number }[]>(() => {
    if (mode !== 'scales' && mode !== 'arpeggios') return [];
    if (instrumentId !== 'guitar') return [];
    const tuning = getTuning(tuningId);
    if (!tuning || tuning.instrumentId !== 'guitar') return [];
    const instrument = getInstrument(instrumentId);
    const fretCount = instrument?.fretCount ?? 22;
    const intervals: IntervalSet = mode === 'scales'
      ? ((getScale(type)?.intervals ?? [0]) as IntervalSet)
      : ((getArpeggio(type)?.intervals ?? [0]) as IntervalSet);
    const grid = buildGrid(tuning, capo, fretCount);
    const highlights = computeHighlights(grid, key, intervals, capo);
    const input: ResolveInput = {
      highlights,
      tuning,
      key,
      capo,
      mode,
      instrumentId,
      fretCount,
      scaleType: mode === 'scales' ? type : undefined,
      arpeggioType: mode === 'arpeggios' ? type : undefined,
    };
    const set = getCagedShapeSetForInput(input);
    if (!set) return [];
    const positions = getCagedPositionMap(input);
    const out: { id: CagedShapeId; letter: CagedShape['letter']; position: number }[] = [];
    for (const shape of set) {
      const pos = positions.get(shape.id);
      if (pos != null) out.push({ id: shape.id, letter: shape.letter, position: pos });
    }
    out.sort((a, b) => a.position - b.position);
    return out;
  }, [mode, instrumentId, key, type, tuningId, capo]);

  const options = useMemo(
    () => [
      { value: FULL_SCALE_VALUE, label: 'Full scale' },
      ...sortedShapes.map((s) => ({
        value: s.id,
        label: `Position ${s.position} — ${s.letter} shape`,
      })),
    ],
    [sortedShapes],
  );

  if (sortedShapes.length === 0) return null;

  return (
    <SelectControl
      label="Position"
      value={shapeId ?? FULL_SCALE_VALUE}
      options={options}
      onChange={(next) => setShapeId(next === FULL_SCALE_VALUE ? null : next)}
      triggerClassName="w-[170px]"
    />
  );
}
