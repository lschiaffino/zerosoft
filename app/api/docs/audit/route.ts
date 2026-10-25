import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isWorkspaceAdmin } from '@/lib/session';
import { auditToCsv, listDocsAudit } from '@/lib/docs-audit';
import { forbidden, unauthorized } from '@/lib/docs-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isoOrNull(v: string | null, endOfDay = false): string | null {
  if (!v) return null;
  // Fecha sola (YYYY-MM-DD): el día entero.
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return `${v}${endOfDay ? 'T23:59:59.999Z' : 'T00:00:00.000Z'}`;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/**
 * Registro de auditoría de Docs (solo admins). Filtros: from, to, actor,
 * action (o su grupo: page, share, guest, teamspace, settings), page;
 * `before` para paginar. `format=csv` exporta lo filtrado (hasta 5.000 filas).
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!isWorkspaceAdmin(user)) return forbidden();
  const sp = req.nextUrl.searchParams;
  const csv = sp.get('format') === 'csv';
  const filters = {
    from: isoOrNull(sp.get('from')),
    to: isoOrNull(sp.get('to'), true),
    actorId: sp.get('actor') || null,
    action: sp.get('action') || null,
    pageId: sp.get('page') || null,
    before: csv ? null : sp.get('before') || null,
    limit: csv ? 5000 : Math.min(Number(sp.get('limit')) || 50, 200),
  };
  const rows = await listDocsAudit(user.id, filters);
  if (csv) {
    const day = new Date().toISOString().slice(0, 10);
    return new NextResponse(auditToCsv(rows), {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="docs-audit-${day}.csv"`,
        'cache-control': 'no-store',
      },
    });
  }
  const next = rows.length === filters.limit ? rows[rows.length - 1]?.created_at ?? null : null;
  return NextResponse.json({ rows, next });
}
