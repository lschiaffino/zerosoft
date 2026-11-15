import type { Migration } from '../migrations';

/**
 * Send: botón propio en el visor de un link (como el "custom button" de
 * DocSend). Un texto corto y una URL http(s); vacíos, el visor no muestra nada.
 * Los clics quedan en send_events (type 'button_click').
 */
export default {
  id: '20261115_1338_send_link_button',
  up: async (c) => {
    for (const sql of [
      "ALTER TABLE send_links ADD COLUMN button_label TEXT NOT NULL DEFAULT ''",
      "ALTER TABLE send_links ADD COLUMN button_url TEXT NOT NULL DEFAULT ''",
    ]) {
      try {
        await c.execute(sql);
      } catch (err) {
        if (!/duplicate column/i.test(String(err))) throw err;
      }
    }
  },
} satisfies Migration;
