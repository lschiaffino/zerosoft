import type { NextRequest } from 'next/server';
import { withViewer } from '@/lib/bi/http';
import { BiStoreError, databaseConfig, databaseInputSchema, deleteDatabase, getDatabase, updateDatabase } from '@/lib/bi/store';
import { isBiAdmin } from '@/lib/bi/access';
import { ExternalDbError, introspect } from '@/lib/bi/external';
import { RunError } from '@/lib/bi/run';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

/** Cambia la conexión (solo admins). Sin contraseña queda la guardada; se vuelve a probar. */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  return withViewer(req, 'write', async (viewer, body) => {
    if (!isBiAdmin(viewer)) throw new BiStoreError('admin_only', 403);
    const cur = await getDatabase(viewer, id);
    if (!cur) throw new BiStoreError('not_found', 404);
    const input = databaseInputSchema.parse({ ...cur, ...body });
    const saved = await databaseConfig(viewer.workspaceId, id);
    // La contraseña guardada solo viaja al mismo destino: otro host, puerto, motor o usuario la pide de nuevo.
    const moved = input.host !== cur.host || input.port !== cur.port || input.engine !== cur.engine || input.username !== cur.username;
    if (moved && !input.password) throw new BiStoreError('password_required');
    let tables;
    try {
      tables = await introspect({ ...input, password: input.password || saved?.password || '' });
    } catch (err) {
      if (err instanceof ExternalDbError) throw new RunError(err.code, err.detail);
      throw err;
    }
    return { database: await updateDatabase(viewer, id, input, tables) };
  });
}

/** Desconecta la base. Las preguntas que la usan quedan sin fuente. */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  return withViewer(req, 'write', async (viewer) => {
    await deleteDatabase(viewer, id);
    return { ok: true };
  });
}
