import type { Migration } from '../migrations';

/**
 * Ajustes › Apariencia: el aspecto de la interfaz de cada persona
 * (current, lines, classic, liquid, retro; lib/look.ts). Sin valor, el
 * default (current): nadie cambia de aspecto sin elegirlo.
 *
 * Tolera correr dos veces y en paralelo (columna repetida).
 */
export default {
  id: '20261117_0610_user_ui_look',
  up: async (c) => {
    try {
      await c.execute('ALTER TABLE users ADD COLUMN ui_look TEXT');
    } catch (err) {
      if (!/duplicate column/i.test(String(err))) throw err;
    }
  },
} satisfies Migration;
