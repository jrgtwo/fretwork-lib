import {
  fretX,
  SINGLE_INLAY_FRETS,
  DOUBLE_INLAY_FRETS,
} from '../../lib/fretboard';
import {
  NECK_LENGTH,
  NECK_X,
  STRING_AREA,
  TOP_PAD,
  getStringSpacing,
} from './layout';

const HIGHLIGHTED_FRET_NUMBERS = new Set([3, 5, 7, 9, 12, 15, 17, 19, 21]);

interface Props {
  fretCount: number;
  stringCount: number;
}

/**
 * Renders fret lines, inlay dots, and the highlighted-fret number labels above the
 * neck. The fret count + string count come from the active instrument; both inlay
 * positions and fret-number labels are clipped to the active fret count.
 */
export function FretLines({ fretCount, stringCount }: Props) {
  const top = TOP_PAD;
  const bottom = TOP_PAD + STRING_AREA;
  const inlayY = top + STRING_AREA / 2;
  const stringSpacing = getStringSpacing(stringCount);

  const fretLines: React.ReactElement[] = [];
  // Nut: thick double line at fret 0 (NECK_X)
  fretLines.push(
    <rect
      key="nut"
      x={NECK_X - 4}
      y={top}
      width={5}
      height={STRING_AREA}
      fill="hsl(var(--pearl))"
      opacity={0.9}
    />,
  );

  for (let f = 1; f <= fretCount; f++) {
    const x = NECK_X + fretX(f, NECK_LENGTH, fretCount);
    fretLines.push(
      <line
        key={`fret-${f}`}
        x1={x}
        y1={top}
        x2={x}
        y2={bottom}
        stroke="hsl(var(--nickel))"
        strokeWidth={1.6}
        strokeOpacity={0.85}
      />,
    );
  }

  // Inlay dots — placed at the midpoint between fret (n-1) and fret n. Cap to fretCount.
  const inlays: React.ReactElement[] = [];
  for (const f of SINGLE_INLAY_FRETS) {
    if (f > fretCount) continue;
    const x = NECK_X + (fretX(f - 1, NECK_LENGTH, fretCount) + fretX(f, NECK_LENGTH, fretCount)) / 2;
    inlays.push(
      <circle
        key={`inlay-${f}`}
        cx={x}
        cy={inlayY}
        r={5}
        fill="hsl(var(--pearl))"
        opacity={0.18}
      />,
    );
  }
  for (const f of DOUBLE_INLAY_FRETS) {
    if (f > fretCount) continue;
    const x = NECK_X + (fretX(f - 1, NECK_LENGTH, fretCount) + fretX(f, NECK_LENGTH, fretCount)) / 2;
    const offset = stringSpacing * 1.4;
    inlays.push(
      <circle key={`inlay-${f}-top`} cx={x} cy={inlayY - offset} r={5} fill="hsl(var(--pearl))" opacity={0.18} />,
      <circle key={`inlay-${f}-bot`} cx={x} cy={inlayY + offset} r={5} fill="hsl(var(--pearl))" opacity={0.18} />,
    );
  }

  // Fret numbers above the neck — only highlight the conventional positions, capped.
  const fretNumbers: React.ReactElement[] = [];
  for (let f = 1; f <= fretCount; f++) {
    if (!HIGHLIGHTED_FRET_NUMBERS.has(f)) continue;
    const x = NECK_X + (fretX(f - 1, NECK_LENGTH, fretCount) + fretX(f, NECK_LENGTH, fretCount)) / 2;
    fretNumbers.push(
      <text
        key={`fn-${f}`}
        x={x}
        y={top - 12}
        textAnchor="middle"
        fontSize={11}
        fontFamily='"JetBrains Mono", ui-monospace, monospace'
        fill="hsl(var(--muted-foreground))"
        opacity={0.85}
      >
        {f}
      </text>,
    );
  }

  return (
    <g>
      {inlays}
      {fretLines}
      {fretNumbers}
    </g>
  );
}
