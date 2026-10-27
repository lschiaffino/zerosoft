import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { rateLimit } from '@/lib/rate-limit';
import { resolveDocAccess } from '@/lib/docs';
import { docsError, notFound, unauthorized } from '@/lib/docs-http';
import { docsAllowed } from '@/lib/docs-guard';
import { logDocsAudit, requestIp } from '@/lib/docs-audit';
import { collectExportPages, exportSinglePage, exportTree, isExportFormat, PdfUnicodeError } from '@/lib/docs-export';
import { requestLocale } from '@/lib/request-locale';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Export de una página: ?format=md|html|pdf (PDF generado en el servidor).
 * ?subpages=1 suma las subpáginas que la persona puede abrir y devuelve un
 * zip con el árbol, los links entre páginas y los archivos adjuntos.
 */
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const format = req.nextUrl.searchParams.get('format') ?? 'md';
  if (!isExportFormat(format)) return docsError(400, 'invalid_format');
  const subpages = req.nextUrl.searchParams.get('subpages') === '1';
  // Un zip con subpáginas puede ser pesado: tope por persona.
  if (subpages && process.env.RATE_LIMIT_DISABLED !== 'true' && !(await rateLimit(`docs-export-tree:${realUserId(user)}`, 30, 600)).ok) {
    return docsError(429, 'rate_limited');
  }
  // Ni "publicada" ni el link público alcanzan: el export es del workspace.
  const res = await resolveDocAccess(user, id, { includePublished: false });
  if (!res || res.row.archived === 1) return notFound();
  // Exportar desactivado en Ajustes › Seguridad: solo admins del workspace.
  if (!(await docsAllowed(user, res.row.user_id, 'allow_export'))) return docsError(403, 'export_disabled');
  const locale = requestLocale(req.cookies.get('NEXT_LOCALE')?.value, req.headers.get('accept-language'));
  const ctx = {
    actor: user,
    origin: req.nextUrl.origin,
    format,
    locale,
    footer: new Date().toISOString().slice(0, 10),
  } as const;
  let out;
  try {
    out = subpages ? await exportTree(await collectExportPages(user, id, true), ctx, res.row.title || 'export') : await exportSinglePage(res.row, ctx);
  } catch (err) {
    // Otros alfabetos en un PDF de una página: el editor ofrece Imprimir (PDF del navegador).
    if (err instanceof PdfUnicodeError) return docsError(422, 'pdf_unicode');
    throw err;
  }
  await logDocsAudit({
    workspaceId: res.row.user_id,
    actor: user.actingUser ?? user,
    action: 'page.exported',
    page: { id, title: res.row.title },
    detail: subpages ? `${format}+subpages (${out.pages}${out.htmlFallback ? `, ${out.htmlFallback} html` : ''})` : format,
    ip: requestIp(req.headers),
  });
  return new NextResponse(new Uint8Array(out.body), {
    headers: {
      'content-type': out.contentType,
      'content-disposition': `attachment; filename="${out.filename.replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(out.filename)}`,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}
