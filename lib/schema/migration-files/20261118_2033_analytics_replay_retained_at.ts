import type { Migration } from '../migrations';

/**
 * Analytics: una grabación restaurada de la papelera (lib/analytics/trash.ts) vuelve a contar su retención desde
 * que se restauró (retained_at, en ms); si no, la limpieza la mandaría de vuelta a la papelera enseguida y la
 * lista la escondería por vieja.
 *
 * Tolera correr dos veces y en paralelo (ignora "duplicate column").
 */
export default {
  id: '20261118_2033_analytics_replay_retained_at',
  up: async (c) => {
    try {
      await c.execute('ALTER TABLE analytics_replay_recordings ADD COLUMN retained_at INTEGER');
    } catch (err) {
      if (!/duplicate column/i.test(String(err))) throw err;
    }
  },
} satisfies Migration;
