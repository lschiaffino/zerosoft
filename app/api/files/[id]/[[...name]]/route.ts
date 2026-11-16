import { getFileRow } from '@/lib/files/store';
import { serveFileRow } from '@/lib/files/serve';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * /api/files/<id>/<nombre>: el único camino a un archivo guardado con
 * lib/files/store.ts. Sin sesión, 401; con sesión y sin permiso sobre ese
 * archivo (otro workspace, sin la app, Inbox de otra persona, o 'internal'),
 * 404. El nombre del final es cosmético. ?download=1 lo baja.
 */
type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return serveFileRow(req, await getFileRow(id).catch(() => null));
}

export async function HEAD(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return serveFileRow(req, await getFileRow(id).catch(() => null), { head: true });
}
