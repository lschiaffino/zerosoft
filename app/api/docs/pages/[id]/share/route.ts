import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { createDocShare, getDocAccess, getDocPageRow } from '@/lib/docs';
import { docShareCreateSchema } from '@/lib/docs-schema';
import { createDocsShareNotification } from '@/lib/notifications';
import { docsError, forbidden, invalidBody, notFound, unauthorized } from '@/lib/docs-http';
import { canShareAccess } from '@/lib/docs-access';
import { docsAllowed } from '@/lib/docs-guard';
import { GuestInviteLimitError, createGuestInvite, existingUserByEmail } from '@/lib/docs-guests';
import { auditTargetLabel, logDocsAudit, requestIp } from '@/lib/docs-audit';
import { isMember, listOwnedTeams } from '@/lib/teams';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Compartir con una persona (por id o email), un equipo o el link. Quien
 * comparte necesita acceso total a la página. Un email sin cuenta queda como
 * invitación pendiente (invitado externo) si Ajustes › Seguridad lo permite.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body: unknown = await req.json().catch(() => null);
  const parsed = docShareCreateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  const row = await getDocPageRow(params.id);
  const access = row ? await getDocAccess(row, user) : null;
  if (!row || !access) return notFound();
  if (!canShareAccess(access)) return forbidden();

  const { kind, role = 'view' } = parsed.data;
  // El link "cualquiera con cuenta" y compartir con equipos del workspace: solo el workspace.
  if (kind !== 'user' && access !== 'owner') return forbidden();
  const actor = user.actingUser ?? user;
  const ip = requestIp(req.headers);
  let targetId = parsed.data.target_id ?? null;

  if (kind === 'user' && !targetId && parsed.data.email) {
    const target = await existingUserByEmail(parsed.data.email);
    if (target) targetId = target.id;
    else {
      // Sin cuenta: invitado externo (como "Skip for now" en Notion).
      if (!(await docsAllowed(user, row.user_id, 'allow_guests'))) return docsError(403, 'guests_disabled');
      try {
        const { invite } = await createGuestInvite({
          page: row,
          email: parsed.data.email,
          role,
          invitedBy: actor,
          locale: req.cookies.get('NEXT_LOCALE')?.value,
        });
        await logDocsAudit({ workspaceId: row.user_id, actor, action: 'guest.invited', page: { id: row.id, title: row.title }, detail: `${invite.email} · ${role}`, ip });
        return NextResponse.json({ invite }, { status: 201 });
      } catch (err) {
        if (err instanceof GuestInviteLimitError) return docsError(400, 'invite_limit');
        throw err;
      }
    }
  }
  if (kind !== 'public' && !targetId) return docsError(400, 'invalid_input');
  // Alguien de afuera del workspace con cuenta: también es un invitado (necesita el permiso).
  if (kind === 'user' && targetId && targetId !== row.user_id) {
    const insider = await isWorkspacePerson(row.user_id, targetId);
    if (!insider && !(await docsAllowed(user, row.user_id, 'allow_guests'))) return docsError(403, 'guests_disabled');
  }

  const share = await createDocShare(row.user_id, params.id, kind, targetId, role);
  if (!share) return notFound();
  await logDocsAudit({
    workspaceId: row.user_id,
    actor,
    action: 'share.added',
    page: { id: row.id, title: row.title },
    detail: `${kind === 'public' ? 'public' : await auditTargetLabel(kind, targetId)} · ${share.role}`,
    ip,
  });

  if (kind === 'user' && targetId && targetId !== realUserId(user)) {
    await createDocsShareNotification({
      pageId: params.id,
      actor: { id: actor.id, email: actor.email, name: actor.name },
      targetUserId: targetId,
    }).catch(() => {});
  }
  return NextResponse.json(share, { status: 201 });
}

/** Dueño del workspace o miembro de alguno de sus equipos. */
async function isWorkspacePerson(workspaceId: string, userId: string): Promise<boolean> {
  if (workspaceId === userId) return true;
  for (const team of await listOwnedTeams(workspaceId)) if (await isMember(team.id, userId)) return true;
  return false;
}
