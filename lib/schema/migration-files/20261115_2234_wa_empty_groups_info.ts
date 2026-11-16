import type { Migration } from '../migrations';

/**
 * Inbox: los grupos de WhatsApp sin mensajes vuelven a pedir sus datos en la próxima pasada del cron
 * (lib/inbox/wa-meta.ts refreshStaleInfo). Con la hora y el creador que da WhatsApp, cada uno recibe el
 * aviso "Creaste el grupo" o "Ana creó el grupo" con esa hora (lib/wa-group-system.ts): el recién creado
 * queda arriba de la lista y los viejos del historial quedan abajo. Sin esto esperaban hasta 3 días.
 * Solo borra info_at (no toca datos); correrla dos veces da lo mismo.
 */
export default {
  id: '20261115_2234_wa_empty_groups_info',
  up: async (c) => {
    await c.execute("UPDATE inbox_threads SET info_at = NULL WHERE kind = 'group' AND channel = 'whatsapp' AND last_message_at IS NULL AND info_at IS NOT NULL");
  },
} satisfies Migration;
