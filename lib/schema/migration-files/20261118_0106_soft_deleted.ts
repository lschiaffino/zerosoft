import type { Migration } from '../migrations';

/**
 * Borrado suave de las limpiezas por inactividad y retención (lib/soft-delete.ts): en vez de borrar en duro, la
 * limpieza guarda un snapshot del registro (y lo que su borrado se lleva puesto) acá y saca las filas de sus
 * tablas, así ninguna lista, búsqueda ni API lo ve. Se puede restaurar hasta purge_at; el cron horario purga lo
 * vencido (con sus archivos). Una fila por registro (único por app, tipo e id).
 *
 * Tolera correr dos veces y en paralelo (IF NOT EXISTS).
 */
export default {
  id: '20261118_0106_soft_deleted',
  up: async (c) => {
    await c.execute(`CREATE TABLE IF NOT EXISTS soft_deleted (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      app TEXT NOT NULL,
      kind TEXT NOT NULL,
      record_id TEXT NOT NULL,
      scope_id TEXT,
      label TEXT NOT NULL DEFAULT '',
      reason TEXT NOT NULL DEFAULT 'retention',
      snapshot TEXT NOT NULL,
      files TEXT NOT NULL DEFAULT '[]',
      deleted_at TEXT NOT NULL,
      purge_at TEXT NOT NULL,
      purge_claimed_at TEXT
    )`);
    await c.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_soft_deleted_record ON soft_deleted (app, kind, record_id)');
    await c.execute('CREATE INDEX IF NOT EXISTS idx_soft_deleted_ws ON soft_deleted (workspace_id, app, deleted_at)');
    await c.execute('CREATE INDEX IF NOT EXISTS idx_soft_deleted_purge ON soft_deleted (purge_at)');
  },
} satisfies Migration;
