import type { Migration } from '../migrations';

/**
 * Rec: un video restaurado de la papelera de la retención (lib/rec-trash.ts) vuelve a contar su plazo desde que
 * se restauró (retained_at); si no, la retención lo mandaría de vuelta a la papelera en la corrida siguiente.
 *
 * Tolera correr dos veces y en paralelo (ignora "duplicate column").
 */
export default {
  id: '20261118_1225_rec_retained_at',
  up: async (c) => {
    try {
      await c.execute('ALTER TABLE rec_videos ADD COLUMN retained_at TEXT');
    } catch (err) {
      if (!/duplicate column/i.test(String(err))) throw err;
    }
  },
} satisfies Migration;
