import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, isWorkspaceAdmin } from '@/lib/session';
import { docsError, forbidden, invalidBody, unauthorized } from '@/lib/docs-http';
import { addSiteDomain, removeSiteDomain, verifySiteDomain } from '@/lib/docs-site';
import { limitByIp } from '@/lib/rate-limit';
import { logDocsAudit, requestIp } from '@/lib/docs-audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ hostname: z.string().trim().min(3).max(253) });

async function admin() {
  const user = await getCurrentUser();
  if (!user) return { error: unauthorized() };
  if (!isWorkspaceAdmin(user)) return { error: forbidden() };
  return { user };
}

/** Agrega el dominio propio del sitio (uno por workspace). Devuelve los registros DNS a crear. */
export async function POST(req: NextRequest) {
  const limited = await limitByIp(req, 'docs-site-domain', 20, 600);
  if (limited) return limited;
  const g = await admin();
  if ('error' in g) return g.error;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  const res = await addSiteDomain(g.user.id, parsed.data.hostname);
  if (!res.ok) return docsError(res.code === 'provider_error' ? 502 : res.code === 'domain_exists' || res.code === 'domain_taken' ? 409 : 400, res.code);
  await logDocsAudit({ workspaceId: g.user.id, actor: g.user.actingUser ?? g.user, action: 'settings.site', detail: `domain=${res.site.hostname}`, ip: requestIp(req.headers) });
  return NextResponse.json({ site: res.site }, { status: 201 });
}

/** Verifica el dominio (TXT de propiedad y que apunte acá). */
export async function PATCH(req: NextRequest) {
  const limited = await limitByIp(req, 'docs-site-verify', 30, 600);
  if (limited) return limited;
  const g = await admin();
  if ('error' in g) return g.error;
  const res = await verifySiteDomain(g.user.id);
  if (res.reason === 'not_found') return docsError(404, 'not_found');
  return NextResponse.json(res);
}

export async function DELETE(req: NextRequest) {
  const g = await admin();
  if ('error' in g) return g.error;
  const ok = await removeSiteDomain(g.user.id);
  if (!ok) return docsError(404, 'not_found');
  await logDocsAudit({ workspaceId: g.user.id, actor: g.user.actingUser ?? g.user, action: 'settings.site', detail: 'domain=removed', ip: requestIp(req.headers) });
  return NextResponse.json({ ok: true });
}
