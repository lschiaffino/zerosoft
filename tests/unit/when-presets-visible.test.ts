import { describe, expect, it } from 'vitest';
import { presetDate, SNOOZE_PRESETS, visiblePresets } from '@/lib/when-presets';

describe('presets visibles', () => {
  it('dos presets en la misma hora se muestran una vez (el primero)', () => {
    // Un domingo a media mañana: "mañana a la mañana" y "la semana que viene" suelen caer el lunes a la misma hora.
    const sunday = new Date(2026, 10, 15, 10, 24);
    const shown = visiblePresets(sunday);
    const times = shown.map((p) => presetDate(p, sunday).getTime());
    expect(new Set(times).size).toBe(times.length);
    expect(shown[0]).toBe(SNOOZE_PRESETS[0]);
  });
  it('un día común muestra todos los que no se repiten, en orden', () => {
    const wed = new Date(2026, 10, 18, 10, 0);
    const shown = visiblePresets(wed);
    expect(shown).toEqual(SNOOZE_PRESETS.filter((p) => shown.includes(p)));
  });
});
