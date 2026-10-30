import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { rateLimit } from '@/lib/rate-limit';
import { isResponse, publicBase, requestLocale, teamsCtx, teamsError } from '@/lib/teams-http';
import { loadDirectory } from '@/lib/workspace-directory';
import { inviteMany } from '@/lib/workspace-invites';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET: invitaciones pendientes del workspace activo (solo owner y admins). */
export async function GET(req: NextRequest) {
  const ctx = await teamsCtx('admin');
  if (isResponse(ctx)) return ctx;
  const dir = await loadDirectory(ctx.team, ctx.role, publicBase(req));
  return NextResponse.json({ rows: dir.invites });
}

const schema = z.object({
  // Una lista ("a@x.com, b@y.com") o un array de emails.
  emails: z.union([z.string().max(20_000), z.array(z.string().max(320)).max(200)]),
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
  if (parsed.data.role === 'admin' && ctx.role !== 'owner') return teamsError('forbidden', 403);
  const limit = await rateLimit(`teams:invite:${ctx.realId}`, 30, 3600);
  if (!limit.ok) return teamsError('rate_limited', 429);
  const { results, invalid } = await inviteMany({
    team: ctx.team,
    inviter: { id: ctx.realId, name: ctx.real.name, email: ctx.real.email },
    emails: parsed.data.emails,
    role: parsed.data.role,
    apps: parsed.data.apps,
    groupIds: parsed.data.groupIds,
    locale: requestLocale(req, parsed.data.locale),
    base: publicBase(req),
  });
  if (!results.length && invalid.length) return NextResponse.json({ error: 'invalid_emails', invalid }, { status: 400 });
  return NextResponse.json({ results, invalid }, { status: 201 });
}
