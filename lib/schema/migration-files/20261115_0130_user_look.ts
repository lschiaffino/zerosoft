import type { Migration } from '../migrations';

/**
 * Ajustes › Apariencia: el aspecto de la interfaz de cada persona
 * (lines, classic o liquid; lib/look.ts). Sin valor, lines.
 */
export default {
  id: '20261115_0130_user_look',
  up: async (c) => {
    try {
      await c.execute("ALTER TABLE users ADD COLUMN look TEXT NOT NULL DEFAULT 'lines'");
    } catch (err) {
      if (!/duplicate column/i.test(String(err))) throw err;
    }
  },
} satisfies Migration;
