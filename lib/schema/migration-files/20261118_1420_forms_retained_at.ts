import type { Migration } from '../migrations';

/**
 * Forms: una respuesta restaurada de la papelera (lib/forms/trash.ts) vuelve a contar su retención desde que se
 * restauró (retained_at); si no, la limpieza horaria la mandaría de vuelta a la papelera enseguida.
 *
 * Tolera correr dos veces y en paralelo (ignora "duplicate column").
 */
export default {
  id: '20261118_1420_forms_retained_at',
  up: async (c) => {
    try {
      await c.execute('ALTER TABLE forms_responses ADD COLUMN retained_at TEXT');
    } catch (err) {
      if (!/duplicate column/i.test(String(err))) throw err;
    }
  },
} satisfies Migration;
