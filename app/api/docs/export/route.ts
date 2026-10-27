import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { docsError, unauthorized } from '@/lib/docs-http';
import { docsAllowed } from '@/lib/docs-guard';
import { limitByIp } from '@/lib/rate-limit';
import { logDocsAudit, requestIp } from '@/lib/docs-audit';
import { collectExportPages, exportTree, isExportFormat } from '@/lib/docs-export';
import { requestLocale } from '@/lib/request-locale';
import { getUserById } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Un workspace grande tarda: tope del plan (el resto de Docs usa el default).
export const maxDuration = 300;

/**
 * Export del workspace entero (Ajustes › Docs): ?format=md|html|pdf. Un zip
 * con todas las páginas que la persona puede abrir (sin teamspaces que no
 * ve), su árbol y los adjuntos. Respeta "Permitir exportar".
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const limited = await limitByIp(req, 'docs-export-workspace', 10, 600);
  if (limited) return limited;
  const format = req.nextUrl.searchParams.get('format') ?? 'md';
  if (!isExportFormat(format)) return docsError(400, 'invalid_format');
  if (!(await docsAllowed(user, user.id, 'allow_export'))) return docsError(403, 'export_disabled');
  const pages = await collectExportPages(user, null, true);
  if (pages.length === 0) return docsError(404, 'nothing_to_export');
  const owner = await getUserById(user.id);
  const name = owner?.name || owner?.handle || 'workspace';
  const out = await exportTree(
    pages,
    {
      actor: user,
      origin: req.nextUrl.origin,
      format,
      locale: requestLocale(req.cookies.get('NEXT_LOCALE')?.value, req.headers.get('accept-language')),
      footer: new Date().toISOString().slice(0, 10),
    },
    `${name} docs`,
  );
  await logDocsAudit({
    workspaceId: user.id,
    actor: user.actingUser ?? user,
    action: 'settings.exported',
    detail: `${format} (${out.pages})`,
    ip: requestIp(req.headers),
  });
  return new NextResponse(new Uint8Array(out.body), {
    headers: {
      'content-type': out.contentType,
      'content-disposition': `attachment; filename="${out.filename.replace(/"/g, '')}"`,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}
