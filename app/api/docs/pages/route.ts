import { after, NextRequest, NextResponse } from 'next/server';
import { emitEvent } from '@/lib/events';
import { getCurrentUser } from '@/lib/session';
import { createDocPage, listDocPageSummaries } from '@/lib/docs';
import { docPageCreateSchema } from '@/lib/docs-schema';
import { forbidden, unauthorized, invalidBody } from '@/lib/docs-http';
import { canCreateDocPage, docsHidden } from '@/lib/docs-guard';
import { logDocsAudit, requestIp } from '@/lib/docs-audit';
import { pageVisibleToWorkspace } from '@/lib/docs-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Tamaño de página por defecto y máximo de GET /api/docs/pages. */
const DOCS_PAGES_LIMIT = 200;
const DOCS_PAGES_MAX = 500;

/**
 * Lista liviana (sin el contenido de cada página) y paginada:
 * ?limit=<1..500>&offset=<n>. `nextOffset` es null en la última página.
 * El contenido se pide por página en /api/docs/pages/:id.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const sp = req.nextUrl.searchParams;
  const limit = Math.min(Math.max(Number(sp.get('limit')) || DOCS_PAGES_LIMIT, 1), DOCS_PAGES_MAX);
  const offset = Math.max(Math.floor(Number(sp.get('offset')) || 0), 0);
  // Uno de más para saber si hay otra página sin un COUNT aparte.
  const rows = await listDocPageSummaries(user.id, { archived: false, limit: limit + 1, offset, hide: await docsHidden(user) });
  const more = rows.length > limit;
  return NextResponse.json({ rows: more ? rows.slice(0, limit) : rows, nextOffset: more ? offset + limit : null });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body: unknown = await req.json().catch(() => null);
  const parsed = docPageCreateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  // Miembros con rol de lectura o comentario no crean páginas en el workspace.
  if (!(await canCreateDocPage(user, parsed.data))) return forbidden();
  const page = await createDocPage(user.id, parsed.data);
  // Las páginas de teamspaces cerrados o privados no disparan flows: el flow corre con el acceso de otra persona.
  after(async () => {
    if (await pageVisibleToWorkspace(page.teamspace_id)) await emitEvent(user.id, 'page.created', { page: { id: page.id, title: page.title, parentId: page.parent_id } });
  });
  await logDocsAudit({
    workspaceId: user.id,
    actor: user.actingUser ?? user,
    action: 'page.created',
    page: { id: page.id, title: page.title },
    ip: requestIp(req.headers),
  });
  return NextResponse.json(page, { status: 201 });
}
