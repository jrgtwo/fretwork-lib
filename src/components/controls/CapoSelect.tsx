import { useMemo } from 'react';
import { useFretworkStore } from '../../store/useFretworkStore';
import { getInstrument } from '../../lib/instruments';
import { SelectControl } from './SelectControl';

/**
 * Capo position selector. The fret range is derived from the active instrument:
 * guitar/bass cap at fret 11, ukulele at fret 12. We don't expose the full fret
 * count as capo positions — beyond ~12 makes the playable region too narrow to be
 * useful.
 */
const MAX_CAPO_FRETS_BY_INSTRUMENT: Record<string, number> = {
  guitar: 11,
  bass: 11,
  ukulele: 12,
};

export function CapoSelect() {
  const capo = useFretworkStore((s) => s.capo);
  const setCapo = useFretworkStore((s) => s.setCapo);
  const instrumentId = useFretworkStore((s) => s.instrumentId);

  const maxCapo = useMemo(() => {
    const fromTable = MAX_CAPO_FRETS_BY_INSTRUMENT[instrumentId];
    if (fromTable != null) return fromTable;
    // Fallback: use the instrument's fret count, capped at 12.
    const inst = getInstrument(instrumentId);
    return Math.min(12, inst?.fretCount ?? 11);
  }, [instrumentId]);

  const options = useMemo(() => {
    const arr: { value: string; label: string }[] = [];
    for (let f = 0; f <= maxCapo; f++) {
      arr.push({ value: String(f), label: f === 0 ? 'Off' : `Fret ${f}` });
    }
    return arr;
  }, [maxCapo]);

  return (
    <SelectControl
      label="Capo"
      value={String(capo)}
      options={options}
      onChange={(v) => setCapo(parseInt(v, 10))}
    />
  );
}
