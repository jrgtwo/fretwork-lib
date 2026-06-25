import { useMemo } from 'react';
import { useFretworkStore } from '../../store/useFretworkStore';
import { getTuningsForInstrument } from '../../lib/tunings';
import { SelectControl } from './SelectControl';

export function TuningSelect() {
  const tuning = useFretworkStore((s) => s.tuning);
  const setTuning = useFretworkStore((s) => s.setTuning);
  const instrumentId = useFretworkStore((s) => s.instrumentId);

  // Filter to tunings that belong to the active instrument.
  const options = useMemo(
    () => getTuningsForInstrument(instrumentId).map((t) => ({ value: t.id, label: t.name })),
    [instrumentId],
  );

  return <SelectControl label="Tuning" value={tuning} options={options} onChange={setTuning} />;
}
