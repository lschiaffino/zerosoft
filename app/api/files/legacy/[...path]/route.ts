import { fileRowForLegacyKey } from '@/lib/files/store';
import { serveFileRow } from '@/lib/files/serve';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * /api/files/legacy/<pathname del Blob de antes>: una URL vieja (guardada en
 * un mensaje, un email o un favorito) se resuelve a su archivo registrado por
 * la migración y se sirve con el mismo permiso que /api/files/<id>. Si no
 * está registrada, 404.
 */
type Ctx = { params: Promise<{ path: string[] }> };

async function rowFor(ctx: Ctx) {
  const { path } = await ctx.params;
  if (!Array.isArray(path) || path.length === 0 || path.length > 6) return null;
  // Los pathnames de antes son de caracteres seguros ([A-Za-z0-9._-]): no hace falta decodificar.
  const key = path.join('/');
  if (key.includes('..') || key.length > 600) return null;
  return fileRowForLegacyKey(key).catch(() => null);
}

export async function GET(req: Request, ctx: Ctx) {
  return serveFileRow(req, await rowFor(ctx));
}

export async function HEAD(req: Request, ctx: Ctx) {
  return serveFileRow(req, await rowFor(ctx), { head: true });
}
