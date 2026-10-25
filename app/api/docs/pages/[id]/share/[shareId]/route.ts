import { getDb } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { deleteDocShare, getDocAccess, getDocPageRow, updateDocShareRole } from '@/lib/docs';
import { docShareUpdateSchema } from '@/lib/docs-schema';
import { forbidden, invalidBody, notFound, unauthorized } from '@/lib/docs-http';
import { canShareAccess } from '@/lib/docs-access';
import { auditTargetLabel, logDocsAudit, requestIp } from '@/lib/docs-audit';
import { revokeGuestInvite } from '@/lib/docs-guests';
import type { SessionUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Página y permiso de compartir (acceso total). */
async function shareable(user: SessionUser, pageId: string) {
  const row = await getDocPageRow(pageId);
  const access = row ? await getDocAccess(row, user) : null;
  if (!row || !access) return { error: notFound() } as const;
  if (!canShareAccess(access)) return { error: forbidden() } as const;
  return { row } as const;
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string; shareId: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const body: unknown = await req.json().catch(() => null);
  const parsed = docShareUpdateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);
  const res = await shareable(user, params.id);
  if ('error' in res) return res.error;
  const share = await updateDocShareRole(res.row.user_id, params.id, params.shareId, parsed.data.role);
  if (!share) return notFound();
  await logDocsAudit({
    workspaceId: res.row.user_id,
    actor: user.actingUser ?? user,
    action: 'share.role',
    page: { id: res.row.id, title: res.row.title },
    detail: `${share.kind === 'public' ? 'public' : await auditTargetLabel(share.kind, share.target_id)} · ${share.role}`,
    ip: requestIp(req.headers),
  });
  return NextResponse.json(share);
}

/** Quita un share; `?invite=1` revoca una invitación pendiente (shareId = id de la invitación). */
export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string; shareId: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const res = await shareable(user, params.id);
  if ('error' in res) return res.error;
  const actor = user.actingUser ?? user;
  const ip = requestIp(req.headers);
  if (req.nextUrl.searchParams.get('invite') === '1') {
    const invite = await revokeGuestInvite(params.id, params.shareId);
    if (!invite) return notFound();
    await logDocsAudit({ workspaceId: res.row.user_id, actor, action: 'guest.revoked', page: { id: res.row.id, title: res.row.title }, detail: invite.email, ip });
    return new NextResponse(null, { status: 204 });
  }
  const removed = (await getDb().prepare('SELECT kind, target_id FROM docs_shares WHERE id = ? AND page_id = ?').get(params.shareId, params.id)) as
    | { kind: string; target_id: string | null }
    | undefined;
  if (!(await deleteDocShare(res.row.user_id, params.id, params.shareId))) return notFound();
  const detail = removed ? (removed.kind === 'public' ? 'public' : await auditTargetLabel(removed.kind, removed.target_id)) : params.shareId;
  await logDocsAudit({ workspaceId: res.row.user_id, actor, action: 'share.removed', page: { id: res.row.id, title: res.row.title }, detail, ip });
  return new NextResponse(null, { status: 204 });
}
