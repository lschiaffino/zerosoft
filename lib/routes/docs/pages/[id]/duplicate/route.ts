import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { duplicateDocPage } from '@/lib/docs';
import { notFound, unauthorized } from '@/lib/docs-http';
import { isDocOwnerAccess } from '@/lib/docs-guard';
import { logDocsAudit, requestIp } from '@/lib/docs-audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  // Duplicar crea páginas en el árbol del workspace: acceso total a la original.
  const row = await isDocOwnerAccess(user, params.id);
  if (!row) return notFound();

  const page = await duplicateDocPage(user.id, params.id);
  if (!page) return notFound();
  await logDocsAudit({
    workspaceId: user.id,
    actor: user.actingUser ?? user,
    action: 'page.duplicated',
    page: { id: page.id, title: page.title },
    detail: params.id,
    ip: requestIp(req.headers),
  });
  return NextResponse.json(page);
}
