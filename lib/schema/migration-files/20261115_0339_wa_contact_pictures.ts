import type { Migration } from '../migrations';

/**
 * Inbox y Lines: la foto de perfil de cada contacto de la libreta (wa_contacts), para los remitentes y
 * participantes de los grupos. `picture`: la copia guardada en nuestro storage (la URL de WhatsApp vence);
 * `picture_src`: la URL de WhatsApp sin la firma (para no bajar de nuevo la misma foto); `picture_at`: cuándo
 * se pidió por última vez (lib/wa-contact-pictures.ts la vuelve a pedir pasada una semana).
 */
export default {
  id: '20261115_0339_wa_contact_pictures',
  up: async (c) => {
    for (const sql of [
      "ALTER TABLE wa_contacts ADD COLUMN picture TEXT NOT NULL DEFAULT ''",
      "ALTER TABLE wa_contacts ADD COLUMN picture_src TEXT NOT NULL DEFAULT ''",
      'ALTER TABLE wa_contacts ADD COLUMN picture_at TEXT',
    ]) {
      try {
        await c.execute(sql);
      } catch (err) {
        if (!/duplicate column/i.test(String(err))) throw err;
      }
    }
  },
} satisfies Migration;
