import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/session';
import { getDocAccess, getDocPageRow } from '@/lib/docs';
import { docsAllowed } from '@/lib/docs-guard';
import { docsError, forbidden, invalidBody, notFound, unauthorized } from '@/lib/docs-http';
import { getPagePublishSettings, updatePagePublishSettings } from '@/lib/docs-site';
import { logDocsAudit, requestIp } from '@/lib/docs-audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  allow_duplicate: z.boolean().optional(),
  seo_description: z.string().max(400).nullable().optional(),
  seo_noindex: z.boolean().optional(),
});

/** Ajustes de la página publicada: duplicar como plantilla y SEO. Quien puede publicar (acceso total). */
async function guard(id: string) {
  const user = await getCurrentUser();
  if (!user) return { error: unauthorized() };
  const row = await getDocPageRow(id);
  const access = row ? await getDocAccess(row, user, { includePublished: false, includePublicLink: false }) : null;
  if (!row || !access) return { error: notFound() };
  if (access !== 'owner') return { error: forbidden() };
  return { user, row };
}

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const g = await guard((await props.params).id);
  if ('error' in g) return g.error;
  return NextResponse.json(await getPagePublishSettings(g.row.id));
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const g = await guard((await props.params).id);
  if ('error' in g) return g.error;
  if (!(await docsAllowed(g.user, g.row.user_id, 'allow_publish'))) return docsError(403, 'publish_disabled');
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  const next = await updatePagePublishSettings(g.row.id, parsed.data);
  if (parsed.data.allow_duplicate !== undefined) {
    await logDocsAudit({
      workspaceId: g.row.user_id,
      actor: g.user.actingUser ?? g.user,
      action: 'settings.site',
      page: { id: g.row.id, title: g.row.title },
      detail: `allow_duplicate=${parsed.data.allow_duplicate}`,
      ip: requestIp(req.headers),
    });
  }
  return NextResponse.json(next);
}
