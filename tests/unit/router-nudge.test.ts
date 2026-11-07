import { describe, expect, it } from 'vitest';
import { nudgeActive, NUDGE_EVERY_MS, NUDGE_WINDOW_MS } from '@/lib/router-nudge';

describe('nudgeActive', () => {
  it('sigue mientras puede haber una navegación y se apaga con la pestaña quieta', () => {
    expect(nudgeActive(1000, 1000)).toBe(true);
    expect(nudgeActive(1000 + NUDGE_WINDOW_MS - 1, 1000)).toBe(true);
    expect(nudgeActive(1000 + NUDGE_WINDOW_MS, 1000)).toBe(false);
  });

  it('destraba bastante antes que los 5 s que tolera una espera de la interfaz', () => {
    expect(NUDGE_EVERY_MS).toBeLessThanOrEqual(1000);
  });
});
