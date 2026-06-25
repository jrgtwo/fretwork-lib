import { HEADSTOCK_WIDTH, stringY, TOP_PAD, STRING_AREA } from './layout';

interface Props {
  /** Effective open-string pitches (capo-aware), in physical bottom-to-top order. */
  openStrings: readonly string[];
}

/**
 * Left-side strip showing each string's open pitch (e.g. "E2"). Capo-aware via
 * `openStrings`. Visually rendered as a darker wood block to read as the headstock.
 *
 * Iterates `openStrings` directly so the same component works for any string count.
 */
export function Headstock({ openStrings }: Props) {
  const stringCount = openStrings.length;
  const labels: React.ReactElement[] = [];
  for (let i = 0; i < stringCount; i++) {
    const y = stringY(i, stringCount);
    labels.push(
      <text
        key={`open-${i}`}
        x={HEADSTOCK_WIDTH - 12}
        y={y + 4}
        textAnchor="end"
        fontSize={12}
        fontFamily='"JetBrains Mono", ui-monospace, monospace'
        fill="hsl(var(--pearl))"
        opacity={0.75}
      >
        {openStrings[i]}
      </text>,
    );
  }

  return (
    <g>
      <rect
        x={0}
        y={TOP_PAD - 6}
        width={HEADSTOCK_WIDTH - 2}
        height={STRING_AREA + 12}
        fill="hsl(var(--charcoal-raised))"
        rx={3}
      />
      <rect
        x={0}
        y={TOP_PAD - 6}
        width={4}
        height={STRING_AREA + 12}
        fill="hsl(var(--pearl))"
        opacity={0.4}
      />
      {labels}
    </g>
  );
}
