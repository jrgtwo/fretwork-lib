import { NECK_LENGTH, NECK_X, stringY } from './layout';

interface Props {
  stringCount: number;
  /** Active instrument id — drives the per-instrument string thickness profile. */
  instrumentId?: string;
}

/**
 * String thickness profiles per instrument. Bass strings are noticeably thicker than
 * guitar's; ukulele strings (typically nylon) are thin and roughly uniform.
 */
function getThicknessProfile(instrumentId: string): { lowest: number; highest: number; woundCount: number } {
  switch (instrumentId) {
    case 'bass':
      return { lowest: 4.6, highest: 2.6, woundCount: 4 }; // thicker, all wound
    case 'ukulele':
      return { lowest: 1.6, highest: 1.4, woundCount: 0 }; // thin, all plain (nylon)
    case 'guitar':
    default:
      return { lowest: 3.4, highest: 1.4, woundCount: 3 }; // existing guitar profile
  }
}

/**
 * Renders N strings as horizontal lines spanning the neck. Index 0 is the bottom-most
 * (physical) string — low E for guitar/bass, high G for reentrant ukulele.
 *
 * Thicker strings (bass/wound guitar) get more stroke width and a slightly cooler
 * color. Higher-pitched strings get a brighter steel/nickel color.
 */
export function Strings({ stringCount, instrumentId = 'guitar' }: Props) {
  const profile = getThicknessProfile(instrumentId);
  const lines: React.ReactElement[] = [];
  for (let i = 0; i < stringCount; i++) {
    const t = stringCount > 1 ? i / (stringCount - 1) : 0; // 0 at bottom-most, 1 at top-most
    const width = profile.lowest + t * (profile.highest - profile.lowest);
    const isWound = i < profile.woundCount;
    const stroke = isWound ? 'hsl(34 12% 70%)' : 'hsl(40 18% 86%)';
    const y = stringY(i, stringCount);
    lines.push(
      <line
        key={`str-${i}`}
        x1={NECK_X - 6}
        x2={NECK_X + NECK_LENGTH + 8}
        y1={y}
        y2={y}
        stroke={stroke}
        strokeWidth={width}
        strokeLinecap="round"
        opacity={0.92}
      />,
    );
  }
  return <g>{lines}</g>;
}
