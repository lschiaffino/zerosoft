import { after, NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { DbServerError, applyRemoteOps, databaseForClient, loadDatabase, runDbEffects } from '@/lib/docs-db-server';
import { docsDbOpsSchema } from '@/lib/docs-schema';
import type { DbOp } from '@/lib/docs-db-ops';
import { docsError, invalidBody, unauthorized } from '@/lib/docs-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ pageId: string; blockId: string }> };

/** Base de otra página (sin cuerpos de fila) para relaciones, rollups y vistas vinculadas. */
export async function GET(_req: NextRequest, props: Params) {
  const { pageId, blockId } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  try {
    const loaded = await loadDatabase(user, pageId, blockId);
    return NextResponse.json({
      db: databaseForClient(loaded),
      page: { id: loaded.page.id, title: loaded.page.title, icon: loaded.page.icon ?? null },
      access: loaded.access,
      updated_at: loaded.page.updated_at,
    });
  } catch (err) {
    if (err instanceof DbServerError) return docsError(err.status, err.code);
    throw err;
  }
}

/**
 * Operaciones sobre la base (editar celdas, agregar filas, propiedades…)
 * con los permisos de su página: hace falta poder editarla. Las
 * automatizaciones de esa base corren igual que al guardar la página.
 */
export async function POST(req: NextRequest, props: Params) {
  const { pageId, blockId } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const parsed = docsDbOpsSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  const actor = { ...user, realId: realUserId(user) };
  try {
    const res = await applyRemoteOps(actor, pageId, blockId, parsed.data.ops as DbOp[]);
    if (res.effects.length) after(() => runDbEffects(res.effects, actor).catch(() => {}));
    return NextResponse.json({ db: res.db, updated_at: res.updated_at });
  } catch (err) {
    if (err instanceof DbServerError) return docsError(err.status, err.code);
    throw err;
  }
}
