import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { DbServerError, loadDatabase, runRemoteActions } from '@/lib/docs-db-server';
import { remoteActions } from '@/lib/docs-db-ops';
import { sanitizeActions } from '@/lib/docs-sanitize';
import { docsDbRunSchema } from '@/lib/docs-schema';
import type { DbAction } from '@/lib/docs-types';
import { docsError, invalidBody, unauthorized } from '@/lib/docs-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type Params = { params: Promise<{ pageId: string; blockId: string }> };

/**
 * Botón de una fila: corre las acciones de afuera (notificar, webhook,
 * agregar fila en otra base). Las que cambian la propia fila ya las aplicó
 * el editor. Hace falta poder editar la página (como en Notion).
 */
export async function POST(req: NextRequest, props: Params) {
  const { pageId, blockId } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const parsed = docsDbRunSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  const actor = { ...user, realId: realUserId(user) };
  try {
    const loaded = await loadDatabase(user, pageId, blockId, { edit: true });
    const prop = loaded.db.properties.find((p) => p.id === parsed.data.prop_id);
    const label = prop?.button?.label || prop?.name || 'Button';
    const actions = remoteActions(sanitizeActions(parsed.data.actions as DbAction[]));
    const results = await runRemoteActions(actions, {
      actor,
      page: loaded.page,
      blockId,
      db: loaded.db,
      rowId: parsed.data.row_id,
      rowSnapshot: parsed.data.row,
      source: `button:${parsed.data.prop_id}`,
      sourceName: label,
    });
    return NextResponse.json({ results });
  } catch (err) {
    if (err instanceof DbServerError) return docsError(err.status, err.code);
    throw err;
  }
}
