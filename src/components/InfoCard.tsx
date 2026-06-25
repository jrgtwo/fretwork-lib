import { useMemo } from 'react';
import { useFretworkStore } from '../store/useFretworkStore';
import { getScale } from '../lib/scales';
import { getArpeggio } from '../lib/arpeggios';
import { spellInKey, intervalLabel } from '../lib/theory';
import type { IntervalSet } from '../types';

interface DerivedInfo {
  title: string;
  tag: string;
  intervals: IntervalSet;
  rootForSpelling: string;
}

function deriveInfo(state: ReturnType<typeof useFretworkStore.getState>): DerivedInfo {
  const { mode, key, type } = state;
  if (mode === 'scales') {
    const scale = getScale(type);
    return {
      title: scale ? `${key} ${scale.name.replace(/ \(.*\)/, '')} Scale` : '',
      tag: scale?.tag ?? '',
      intervals: scale?.intervals ?? [],
      rootForSpelling: key,
    };
  }
  if (mode === 'arpeggios') {
    const arp = getArpeggio(type);
    return {
      title: arp ? `${key} ${arp.name} Arpeggio` : '',
      tag: arp?.tag ?? '',
      intervals: arp?.intervals ?? [],
      rootForSpelling: key,
    };
  }
  return {
    title: `${type} note`,
    tag: 'All instances across the neck',
    intervals: [0],
    rootForSpelling: type,
  };
}

export function InfoCard() {
  const state = useFretworkStore();
  const info = useMemo(() => deriveInfo(state), [state]);

  if (info.intervals.length === 0) return null;

  return (
    <div className="rounded-lg border border-border/50 bg-card/60 p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight">
          <span className="text-degree-root">{info.title.split(' ')[0]}</span>
          <span className="text-foreground"> {info.title.split(' ').slice(1).join(' ').toUpperCase()}</span>
        </h2>
        <span className="text-xs font-mono text-muted-foreground tabular-nums">
          {info.intervals.length}
        </span>
      </div>
      {info.tag && (
        <p className="text-xs font-mono uppercase tracking-[0.14em] text-muted-foreground mt-1">
          {info.tag}
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2">
        {info.intervals.map((iv, idx) => {
          const note = spellInKey(info.rootForSpelling, iv);
          const interval = intervalLabel(iv);
          return (
            <div key={`${iv}-${idx}`} className="flex flex-col items-center min-w-[48px]">
              <span className="text-2xl font-semibold tracking-tight">{note}</span>
              <span className="text-[10px] font-mono text-muted-foreground tabular-nums">
                {interval}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
