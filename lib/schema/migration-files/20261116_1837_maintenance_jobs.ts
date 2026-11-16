import type { Migration } from '../migrations';

/**
 * Trabajos de mantenimiento de una vez que corre el cron de cada minuto (lib/maintenance-jobs.ts, prendidos con
 * MAINTENANCE_JOBS). Una fila por trabajo y modo: estado, cursor para retomar y cuentas (sin teléfonos, nombres,
 * URLs ni contenido). `maintenance_job_seen` guarda hashes de lo ya contado en una corrida, para no contar dos veces.
 *
 * Tolera correr dos veces y en paralelo (IF NOT EXISTS).
 */
export default {
  id: '20261116_1837_maintenance_jobs',
  up: async (c) => {
    await c.execute(`CREATE TABLE IF NOT EXISTS maintenance_jobs (
      job TEXT NOT NULL,
      mode TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      state TEXT NOT NULL DEFAULT '{}',
      report TEXT NOT NULL DEFAULT '{}',
      ticks INTEGER NOT NULL DEFAULT 0,
      errors INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      locked_until INTEGER,
      started_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      finished_at INTEGER,
      PRIMARY KEY (job, mode)
    )`);
    await c.execute(`CREATE TABLE IF NOT EXISTS maintenance_job_seen (
      run TEXT NOT NULL,
      ns TEXT NOT NULL,
      h TEXT NOT NULL,
      PRIMARY KEY (run, ns, h)
    ) WITHOUT ROWID`);
  },
} satisfies Migration;
