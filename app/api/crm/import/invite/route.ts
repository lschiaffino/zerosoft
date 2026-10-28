import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, isWorkspaceAdmin, realUserId } from '@/lib/session';
import { getImportJob } from '@/lib/crm-import-jobs';
import { listPendingInvites } from '@/lib/teams';
import { workspacePeople } from '@/lib/crm-import';
import { crmError, forbidden, limitAction, notFound, unauthorized } from '@/lib/crm-http';
import { rateLimit } from '@/lib/rate-limit';
import { ensureWorkspace } from '@/lib/workspace';
import { inviteMany } from '@/lib/workspace-invites';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Un email por owner, sin espacios ni separadores: inviteMany parte la lista por espacios.
const EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

const schema = z.object({
  jobId: z.string().min(1).max(64),
  ownerIds: z.array(z.string().min(1).max(64)).min(1).max(200),
  locale: z.enum(['en', 'es', 'pt']).default('en'),
});

/**
 * Migración del CRM: invita al workspace a los owners del otro CRM que todavía
 * no son miembros (solo los de la vista previa de ese import y con email).
 * Pasa por las invitaciones del workspace (lib/workspace-invites.ts): mismo
 * email obligatorio para aceptar, mismos topes de envío y el email de la
 * marca; si el email no sale, queda el link para compartirlo. Quien ya es
 * miembro no se invita; una invitación pendiente se reusa.
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
        .filter((o) => wanted.has(o.id) && o.email && EMAIL_RE.test(o.email) && !members.has(o.email.toLowerCase()))
        .map((o) => o.email.toLowerCase()),
    ),
  ];
  if (!emails.length) return NextResponse.json({ invites: [] });

  // Mismo límite que Ajustes › Miembros.
  const invLimit = await rateLimit(`teams:invite:${realUserId(user)}`, 30, 3600);
  if (!invLimit.ok) return crmError(429, 'rate_limited');
  // El workspace activo (la ficha del owner o el equipo en el que se trabaja).
  const team = user.workspace ?? (await ensureWorkspace(user.id));
  const pending = new Set((await listPendingInvites(team.id)).map((i) => i.email.toLowerCase()));
  const real = user.actingUser ?? user;
  const { results } = await inviteMany({
    team,
    inviter: { id: real.id, name: real.name, email: real.email },
    emails,
    role: 'member',
    locale: parsed.data.locale,
    base: (process.env.NEXTAUTH_URL ?? req.nextUrl.origin).replace(/\/$/, ''),
  });
  const invites = results
    .filter((r) => r.url)
    .map((r) => ({ email: r.email, url: r.url as string, existing: pending.has(r.email), emailed: r.status === 'sent', status: r.status }));
  // Los que cortó el tope de invitaciones: se devuelven aparte para avisarlo.
  const skipped = results.filter((r) => !r.url).map((r) => ({ email: r.email, status: r.status }));
  return NextResponse.json({ invites, skipped }, { status: 201 });
}
