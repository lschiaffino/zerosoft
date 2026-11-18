import type { Migration } from '../migrations';

/**
 * Push de Lines y Talk: el cron horario borra los avisos de más de 24 h
 * (pruneNotifications en lib/groups-push.ts, guardan texto del mensaje).
 * Índice por fecha para que ese borrado no recorra toda la tabla.
 *
 * Tolera correr dos veces y en paralelo (IF NOT EXISTS).
 */
export default {
  id: '20261117_2139_groups_notifications_created',
  up: async (c) => {
    await c.execute('CREATE INDEX IF NOT EXISTS idx_groups_notifications_created ON groups_notifications(created_at)');
  },
} satisfies Migration;
