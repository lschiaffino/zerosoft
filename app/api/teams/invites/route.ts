import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { rateLimit } from '@/lib/rate-limit';
import { can, canGiveApps } from '@/lib/permissions';
import { createInvite } from '@/lib/teams';
import { parseApps } from '@/lib/workspace';
import { audit } from '@/lib/workspace-admin';
import { inviteUrl } from '@/lib/workspace-invites';
import { isResponse, publicBase, requestLocale, teamsCtx, teamsError } from '@/lib/teams-http';
import { loadDirectory } from '@/lib/workspace-directory';
import { inviteMany } from '@/lib/workspace-invites';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET: invitaciones pendientes del workspace activo (solo owner y admins). */
export async function GET(req: NextRequest) {
  const ctx = await teamsCtx('admin');
  if (isResponse(ctx)) return ctx;
  const dir = await loadDirectory(ctx.team, ctx.role, publicBase(req), ctx.user.apps ?? '*', ctx.realId);
  return NextResponse.json({ rows: dir.invites });
}

const schema = z.object({
  // Una lista ("a@x.com, b@y.com") o un array de emails.
  emails: z.union([z.string().max(20_000), z.array(z.string().max(320)).max(200)]).optional(),
  /** Link de invitación sin email (de un solo uso, nunca de admin). */
  link: z.boolean().optional(),
  role: z.enum(['admin', 'member', 'guest']).optional(),
  apps: z.union([z.literal('*'), z.array(z.string().max(20)).max(64)]).optional(),
  groupIds: z.array(z.string().max(64)).max(50).optional(),
  locale: z.enum(['en', 'es', 'pt']).optional(),
});

/**
 * POST: invita por email. Cada persona recibe un link de un solo uso que
 * vence a los 14 días. Si el email no sale, la respuesta lo dice por persona
 * y trae el link para copiarlo.
 */
export async function POST(req: NextRequest) {
  const ctx = await teamsCtx('admin');
  if (isResponse(ctx)) return ctx;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return teamsError('invalid_input');
  const role = parsed.data.role ?? 'member';
  if (!can(ctx.user, 'members.invite', { nextRole: role })) return teamsError('forbidden', 403);
  // Sin apps en el pedido (invitar desde una app): las de quien invita, nunca más.
  const actorApps = ctx.user.apps ?? '*';
  const apps = parsed.data.apps ?? actorApps;
  const offered = role === 'guest' ? [] : parseApps(apps);
  if (!canGiveApps(ctx.user, offered)) return teamsError('apps_not_yours', 403);
  const limit = await rateLimit(`teams:invite:${ctx.realId}`, 30, 3600);
  if (!limit.ok) return teamsError('rate_limited', 429);
  if (parsed.data.link) {
    if (role === 'admin') return teamsError('admin_link');
    const { getDb } = await import('@/lib/db');
    const groupIds: string[] = [];
    for (const id of (role === 'guest' ? [] : parsed.data.groupIds ?? []).slice(0, 50)) {
      if (await getDb().prepare('SELECT 1 AS x FROM workspace_groups WHERE id = ? AND workspace_id = ?').get(id, ctx.team.owner_id)) groupIds.push(id);
    }
    const locale = requestLocale(req, parsed.data.locale);
    const inv = await createInvite(ctx.team.id, '', ctx.realId, { role, apps: offered, groupIds, locale });
    await audit({ teamId: ctx.team.id, actorId: ctx.realId, action: 'invite.create', after: { link: true, role, apps: offered, inviteId: inv.id } });
    return NextResponse.json({ results: [{ email: '', status: 'skipped', inviteId: inv.id, url: inviteUrl(publicBase(req), inv.token, locale) }], invalid: [] }, { status: 201 });
  }
  if (parsed.data.emails === undefined) return teamsError('invalid_input');
  const { results, invalid } = await inviteMany({
    team: ctx.team,
    inviter: { id: ctx.realId, name: ctx.real.name, email: ctx.real.email },
    emails: parsed.data.emails,
    role,
    apps,
    groupIds: parsed.data.groupIds,
    locale: requestLocale(req, parsed.data.locale),
    base: publicBase(req),
  });
  const sent = results.filter((r) => r.inviteId).map((r) => r.email);
  if (sent.length) await audit({ teamId: ctx.team.id, actorId: ctx.realId, targetLabel: sent.join(', '), action: 'invite.create', after: { emails: sent, role, apps: offered } });
  if (!results.length && invalid.length) return NextResponse.json({ error: 'invalid_emails', invalid }, { status: 400 });
  return NextResponse.json({ results, invalid }, { status: 201 });
}
