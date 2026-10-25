import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, realUserId } from '@/lib/session';
import { getDocAccess, getDocPageRow, toDocPage } from '@/lib/docs';
import { canWriteAccess } from '@/lib/docs-access';
import { VERIFY_MAX_DAYS, unverifyDocPage, verifyDocPage } from '@/lib/docs-verify';
import { workspacePeople } from '@/lib/docs-teamspace-http';
import { docsError, forbidden, invalidBody, notFound, unauthorized } from '@/lib/docs-http';
import { logDocsAudit, requestIp } from '@/lib/docs-audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  /** Días de vigencia; null = sin vencimiento. */
  days: z.number().int().min(1).max(VERIFY_MAX_DAYS).nullable(),
  /** Dueño de la página (recibe el aviso al vencer); por defecto el actual o quien verifica. */
  owner_id: z.string().min(1).max(64).nullish(),
});

/**
 * Verificar una página de la wiki: acceso total, o su dueño si puede
 * editarla (como en Notion, verifican los dueños de la página).
 */
async function gate(req: NextRequest, id: string) {
  const user = await getCurrentUser();
  if (!user) return { error: unauthorized() } as const;
  const row = await getDocPageRow(id);
  const access = row ? await getDocAccess(row, user) : null;
  if (!row || !access) return { error: notFound() } as const;
  const isPageOwner = row.page_owner_id === realUserId(user) && canWriteAccess(access);
  if (access !== 'owner' && !isPageOwner) return { error: forbidden() } as const;
  return { user, row, ip: requestIp(req.headers) } as const;
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const g = await gate(req, id);
  if ('error' in g) return g.error;
  const body: unknown = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);
  const ownerId = parsed.data.owner_id ?? null;
  if (ownerId && !(await workspacePeople(g.row.user_id)).has(ownerId)) return docsError(400, 'not_in_workspace');
  const locale = req.cookies.get('NEXT_LOCALE')?.value ?? null;
  await verifyDocPage(g.row, realUserId(g.user), parsed.data.days, ownerId, locale);
  await logDocsAudit({
    workspaceId: g.row.user_id,
    actor: g.user.actingUser ?? g.user,
    action: 'page.verified',
    page: { id: g.row.id, title: g.row.title },
    detail: parsed.data.days == null ? 'indefinitely' : `${parsed.data.days}d`,
    ip: g.ip,
  });
  const fresh = await getDocPageRow(id);
  return NextResponse.json(fresh ? toDocPage(fresh) : null);
}

export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const g = await gate(req, id);
  if ('error' in g) return g.error;
  await unverifyDocPage(g.row);
  await logDocsAudit({ workspaceId: g.row.user_id, actor: g.user.actingUser ?? g.user, action: 'page.unverified', page: { id: g.row.id, title: g.row.title }, ip: g.ip });
  const fresh = await getDocPageRow(id);
  return NextResponse.json(fresh ? toDocPage(fresh) : null);
}
