import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, isWorkspaceAdmin } from '@/lib/session';
import { forbidden, invalidBody, unauthorized } from '@/lib/docs-http';
import { getDocsSite, siteAnalytics, updateDocsSite } from '@/lib/docs-site';
import { logDocsAudit, requestIp } from '@/lib/docs-audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  indexing: z.boolean().optional(),
  locale: z.enum(['en', 'es', 'pt']).nullable().optional(),
});

/**
 * Sitio publicado del workspace: ajustes (indexación, idioma del dominio,
 * dominio) y, con ?analytics=1, las visitas de los últimos 30 días. Los ven
 * y cambian los admins del workspace.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!isWorkspaceAdmin(user)) return forbidden();
  const site = await getDocsSite(user.id);
  if (req.nextUrl.searchParams.get('analytics') === '1') {
    const days = Math.min(Math.max(Number(req.nextUrl.searchParams.get('days')) || 30, 7), 90);
    return NextResponse.json({ site, analytics: await siteAnalytics(user.id, days) });
  }
  return NextResponse.json({ site });
}

export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!isWorkspaceAdmin(user)) return forbidden();
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  const site = await updateDocsSite(user.id, parsed.data);
  await logDocsAudit({
    workspaceId: user.id,
    actor: user.actingUser ?? user,
    action: 'settings.site',
    detail: Object.entries(parsed.data)
      .map(([k, v]) => `${k}=${String(v)}`)
      .join(', '),
    ip: requestIp(req.headers),
  });
  return NextResponse.json({ site });
}
