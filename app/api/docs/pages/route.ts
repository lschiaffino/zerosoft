import { after, NextRequest, NextResponse } from 'next/server';
import { emitEvent } from '@/lib/events';
import { getCurrentUser } from '@/lib/session';
import { createDocPage, listDocPageSummaries } from '@/lib/docs';
import { docPageCreateSchema } from '@/lib/docs-schema';
import { unauthorized, invalidBody } from '@/lib/docs-http';

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
  const rows = await listDocPageSummaries(user.id, { archived: false, limit: limit + 1, offset });
  const more = rows.length > limit;
  return NextResponse.json({ rows: more ? rows.slice(0, limit) : rows, nextOffset: more ? offset + limit : null });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body: unknown = await req.json().catch(() => null);
  const parsed = docPageCreateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  const page = await createDocPage(user.id, parsed.data);
  after(() => emitEvent(user.id, 'page.created', { page: { id: page.id, title: page.title, parentId: page.parent_id } }));
  return NextResponse.json(page, { status: 201 });
}
