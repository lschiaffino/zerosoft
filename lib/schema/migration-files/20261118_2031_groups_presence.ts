import type { Migration } from '../migrations';

/**
 * Lines: el estado de cada persona pasa de disponible sí/no a online / away /
 * offline (groups_availability.status; lib/groups-inbox.ts). Las filas que ya
 * había pasan como estaban: disponible → online, no disponible → offline.
 * `available` sigue escrito (1 solo si online) para quien lea la columna vieja.
 *
 * Las reglas de asignación ganan `reassign_offline` (apagado): cuando alguien
 * pasa a offline, sus chats abiertos se reparten entre los online de la regla.
 *
 * Tolera correr dos veces y en paralelo: ignora "duplicate column" y el
 * backfill solo toca filas sin status.
 */
export default {
  id: '20261118_2031_groups_presence',
  up: async (c) => {
    for (const sql of [
      'ALTER TABLE groups_availability ADD COLUMN status TEXT',
      'ALTER TABLE groups_assign_rules ADD COLUMN reassign_offline INTEGER NOT NULL DEFAULT 0',
    ]) {
      try {
        await c.execute(sql);
      } catch (err) {
        if (!/duplicate column/i.test(String(err))) throw err;
      }
    }
    await c.execute("UPDATE groups_availability SET status = CASE WHEN available = 1 THEN 'online' ELSE 'offline' END WHERE status IS NULL");
  },
} satisfies Migration;
