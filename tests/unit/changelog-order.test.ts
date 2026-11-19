import { describe, expect, it } from 'vitest';
import { changelogOrder } from '../../scripts/gen-fragments.mjs';

describe('orden del changelog', () => {
  it('el día más nuevo primero y, dentro del día, la hora más tarde primero', () => {
    expect(
      changelogOrder([
        '2026-11-18-zeta.ts',
        '2026-11-19-0900-morning.ts',
        '2026-11-19-youtube-card.ts',
        '2026-11-19-2315-latest.ts',
        '2026-11-19-1430-afternoon.ts',
      ]),
    ).toEqual(['2026-11-19-2315-latest.ts', '2026-11-19-1430-afternoon.ts', '2026-11-19-0900-morning.ts', '2026-11-19-youtube-card.ts', '2026-11-18-zeta.ts']);
  });

  it('sin hora, el orden de siempre (alfabético al revés dentro del día)', () => {
    expect(changelogOrder(['2026-11-19-a.ts', '2026-11-19-b.ts'])).toEqual(['2026-11-19-b.ts', '2026-11-19-a.ts']);
  });
});
