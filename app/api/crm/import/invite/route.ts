import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, isWorkspaceAdmin, realUserId } from '@/lib/session';
import { getImportJob } from '@/lib/crm-import-jobs';
import * as teams from '@/lib/teams';
import { createInvite, createTeam, listOwnedTeams, listPendingInvites } from '@/lib/teams';
import type { TeamInviteRow } from '@/lib/db';
import { workspacePeople } from '@/lib/crm-import';
import { crmError, forbidden, limitAction, notFound, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  jobId: z.string().min(1).max(64),
  ownerIds: z.array(z.string().min(1).max(64)).min(1).max(200),
  locale: z.enum(['en', 'es', 'pt']).default('en'),
});

type InviteSender = (invite: TeamInviteRow, opts: { url: string; locale: string; invitedBy: string }) => Promise<boolean | void>;

/**
 * El envío de invitaciones por email del workspace (lib/teams.ts ›
 * sendInviteEmail) cuando exista; hasta entonces, null y se comparte el link.
 */
function inviteSender(): InviteSender | null {
  const fn = (teams as unknown as { sendInviteEmail?: unknown }).sendInviteEmail;
  return typeof fn === 'function' ? (fn as InviteSender) : null;
}

/**
 * Migración del CRM: invita al workspace a los owners del otro CRM que todavía
 * no son miembros (solo los de la vista previa de ese import y con email).
 * Devuelve el link de cada invitación para compartirlo; quien ya es miembro o
 * ya tiene una invitación pendiente no se invita de nuevo.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!isWorkspaceAdmin(user)) return forbidden();
  const limited = await limitAction(realUserId(user), 'import-invite', 20, 3600);
  if (limited) return limited;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return crmError(400, 'invalid_input');
  const job = await getImportJob(user.id, parsed.data.jobId);
  if (!job) return notFound();

  const wanted = new Set(parsed.data.ownerIds);
  const members = new Set((await workspacePeople(user.id)).map((p) => p.email.toLowerCase()));
  const emails = [
    ...new Set(
      job.preview.owners
        .filter((o) => wanted.has(o.id) && o.email && !members.has(o.email.toLowerCase()))
        .map((o) => o.email.toLowerCase()),
    ),
  ];
  if (!emails.length) return NextResponse.json({ invites: [] });

  // El workspace es del owner: su equipo (se crea si todavía no tiene).
  // El equipo del workspace en el que se está trabajando (si no hay ninguno y es el dueño, se crea).
  const owned = user.team && user.team.owner_id === user.id ? null : await listOwnedTeams(user.id);
  const team = (user.team && user.team.owner_id === user.id ? user.team : owned?.[0]) ?? (user.id === realUserId(user) ? await createTeam(user.id, '') : null);
  if (!team) return crmError(409, 'no_team');
  const pending = new Map((await listPendingInvites(team.id)).map((i) => [i.email.toLowerCase(), i]));
  const base = (process.env.NEXTAUTH_URL ?? req.nextUrl.origin).replace(/\/$/, '');
  const send = inviteSender();
  const invites: Array<{ email: string; url: string; existing: boolean; emailed: boolean }> = [];
  for (const email of emails) {
    const prev = pending.get(email);
    const invite = prev ?? (await createInvite(team.id, email, realUserId(user)));
    const url = `${base}/${parsed.data.locale}/invite/${invite.token}`;
    // Con el envío por email del workspace configurado, la invitación sale sola; si no, queda el link para compartir.
    const emailed = send ? await send(invite, { url, locale: parsed.data.locale, invitedBy: realUserId(user) }).then((r) => r !== false).catch(() => false) : false;
    invites.push({ email, url, existing: Boolean(prev), emailed });
  }
  return NextResponse.json({ invites }, { status: 201 });
}
