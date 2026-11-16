import type { Migration } from '../migrations';

/**
 * Archivos de WhatsApp que duran (lib/inbox/media-store.ts, lib/wa-media-jobs.ts).
 *
 * - inbox_media_files: la copia privada (cifrada) del archivo de un mensaje de Inbox. Hasta ahora Inbox pedía el
 *   archivo al servidor de WhatsApp en cada vista; si ese servidor perdía el mensaje (la línea se volvió a vincular),
 *   el archivo no se podía ver más. Va en una tabla aparte (no en la fila del mensaje) para que borrar un mensaje,
 *   un chat o una cuenta por cualquier camino deje la fila huérfana y el repaso horario borre el archivo.
 * - wa_media_jobs: la cola de archivos por bajar (Inbox y Lines), con reintentos espaciados. Una fila por mensaje;
 *   el cron la reclama (claimed_until) antes de trabajar.
 */
export default {
  id: '20261115_1810_wa_media_store',
  up: async (c) => {
    await c.execute(`CREATE TABLE IF NOT EXISTS inbox_media_files (
      message_id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      file_ref TEXT NOT NULL,
      mime TEXT NOT NULL DEFAULT '',
      filename TEXT NOT NULL DEFAULT '',
      size INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    )`);
    await c.execute('CREATE INDEX IF NOT EXISTS idx_inbox_media_files_owner ON inbox_media_files(owner_id)');
    await c.execute(`CREATE TABLE IF NOT EXISTS wa_media_jobs (
      app TEXT NOT NULL,
      message_id TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      next_at TEXT NOT NULL,
      claimed_until TEXT,
      last_kind TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      PRIMARY KEY (app, message_id)
    )`);
    await c.execute('CREATE INDEX IF NOT EXISTS idx_wa_media_jobs_due ON wa_media_jobs(next_at)');
    await c.execute('CREATE INDEX IF NOT EXISTS idx_wa_media_jobs_scope ON wa_media_jobs(app, scope_id, next_at)');
  },
} satisfies Migration;
