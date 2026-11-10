import type { NextRequest } from 'next/server';
import { withViewer } from '@/lib/bi/http';
import { isBiAdmin } from '@/lib/bi/access';
import { introspect } from '@/lib/bi/external';
import { BiStoreError, createDatabase, databaseInputSchema, listDatabases } from '@/lib/bi/store';
import { RunError } from '@/lib/bi/run';
import { ExternalDbError } from '@/lib/bi/external';

export const dynamic = 'force-dynamic';

/** Bases externas del workspace (sin credenciales). */
export async function GET(req: NextRequest) {
  return withViewer(req, 'read', async (viewer) => ({ databases: await listDatabases(viewer) }));
}

/** Conecta una base (solo admins): prueba la conexión y lee el esquema antes de guardar. */
export async function POST(req: NextRequest) {
  return withViewer(
    req,
    'write',
    async (viewer, body) => {
      if (!isBiAdmin(viewer)) throw new BiStoreError('admin_only', 403);
      const input = databaseInputSchema.parse(body);
      let tables;
      try {
        tables = await introspect({ ...input, password: input.password ?? '' });
      } catch (err) {
        if (err instanceof ExternalDbError) throw new RunError(err.code, err.detail);
        throw err;
      }
      return { database: await createDatabase(viewer, input, tables) };
    },
    201,
  );
}
