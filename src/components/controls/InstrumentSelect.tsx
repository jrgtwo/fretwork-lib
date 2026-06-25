import { useMemo } from 'react';
import { useFretworkStore } from '../../store/useFretworkStore';
import { INSTRUMENTS } from '../../lib/instruments';
import { SelectControl } from './SelectControl';

/**
 * Instrument picker — sits as the leftmost control in the TopBar. Switching
 * instruments resets the active tuning to the new instrument's default and clamps
 * the capo to its fret range. Patterns that aren't applicable on the new instrument
 * (CAGED on bass/ukulele) gracefully grey out.
 */
export function InstrumentSelect() {
  const instrumentId = useFretworkStore((s) => s.instrumentId);
  const setInstrumentId = useFretworkStore((s) => s.setInstrumentId);
  const options = useMemo(
    () => INSTRUMENTS.map((i) => ({ value: i.id, label: i.name })),
    [],
  );
  return (
    <SelectControl
      label="Instrument"
      value={instrumentId}
      options={options}
      onChange={setInstrumentId}
    />
  );
}
