import type { Migration } from '../migrations';

/**
 * Archivos de la suite (lib/files/store.ts): cada foto, audio, documento o
 * adjunto es una fila con su workspace, su dueño, su app y quién lo puede
 * leer. Se sirven solo por /api/files/<id>, nunca por la URL del storage.
 * scope: un permiso más fino que el workspace ("chat-widget:<id>"), que
 * chequea lib/files/scopes.ts.
 * legacy_key: el archivo de antes (pathname del Blob público o /uploads/…)
 * que registró la migración, para resolver las URLs viejas.
 */
export default {
  id: '20261115_0430_stored_files',
  up: async (c) => {
    await c.execute(`CREATE TABLE IF NOT EXISTS stored_files (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      user_id TEXT,
      app TEXT,
      folder TEXT NOT NULL,
      access TEXT NOT NULL,
      scope TEXT,
      ref TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT 'file',
      mime TEXT NOT NULL DEFAULT 'application/octet-stream',
      size INTEGER NOT NULL DEFAULT 0,
      header TEXT,
      legacy_key TEXT,
      created_at TEXT NOT NULL
    )`);
    await c.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_stored_files_legacy ON stored_files (legacy_key)');
    await c.execute('CREATE INDEX IF NOT EXISTS idx_stored_files_ws ON stored_files (workspace_id, app)');
  },
} satisfies Migration;
