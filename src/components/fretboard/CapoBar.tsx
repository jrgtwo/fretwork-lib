import { fretX } from '../../lib/fretboard';
import { NECK_LENGTH, NECK_X, STRING_AREA, TOP_PAD } from './layout';

interface Props {
  capo: number;
  fretCount: number;
}

/**
 * Visual capo: a bar drawn at the capo's fret position, plus a translucent overlay
 * that dims the area to the LEFT of the capo (those positions are not playable).
 */
export function CapoBar({ capo, fretCount }: Props) {
  if (capo <= 0 || capo > fretCount) return null;

  const x = NECK_X + fretX(capo, NECK_LENGTH, fretCount);
  const xPrev = NECK_X + fretX(capo - 1, NECK_LENGTH, fretCount);
  const capoX = (x + xPrev) / 2;

  return (
    <g>
      {/* Dimming overlay covering nut → capo */}
      <rect
        x={NECK_X - 6}
        y={TOP_PAD - 4}
        width={x - (NECK_X - 6)}
        height={STRING_AREA + 8}
        fill="hsl(var(--charcoal-deep))"
        opacity={0.55}
        pointerEvents="none"
      />
      {/* Capo bar — drawn at the midpoint of the capoed fret, where a real capo would clamp */}
      <rect
        x={capoX - 7}
        y={TOP_PAD - 14}
        width={14}
        height={STRING_AREA + 28}
        rx={4}
        fill="hsl(var(--charcoal-raised))"
        stroke="hsl(var(--nickel))"
        strokeWidth={0.8}
        opacity={0.9}
      />
      {/* Subtle highlight on the capo for depth */}
      <rect
        x={capoX - 5}
        y={TOP_PAD - 12}
        width={3}
        height={STRING_AREA + 24}
        rx={1}
        fill="hsl(var(--pearl))"
        opacity={0.25}
      />
    </g>
  );
}
