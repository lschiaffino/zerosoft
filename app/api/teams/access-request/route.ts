import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isProductKey } from '@/lib/products';
import { rateLimit } from '@/lib/rate-limit';
import { getMemberRole } from '@/lib/teams';
import { canManage, isResponse, teamsCtx, teamsError } from '@/lib/teams-http';
import { canUseApp, userCanUseApp } from '@/lib/workspace';
import { askForApp, notifyAppsDenied, pendingRequests, resolveRequests } from '@/lib/workspace-access-request';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const askSchema = z.object({ app: z.string().max(20) });

/**
 * POST { app }: pedirle a quien puede resolverlo acceso a una app que no tengo
 * (pantalla "no tenés acceso"). Mientras el pedido siga sin responder, repetirlo
 * dentro de las 24 horas no vuelve a avisar.
 */
export async function POST(req: NextRequest) {
  const ctx = await teamsCtx();
  if (isResponse(ctx)) return ctx;
  const parsed = askSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success || !isProductKey(parsed.data.app)) return teamsError('invalid_input');
  const app = parsed.data.app;
  // En tu propio workspace, o si ya la tenés, no hay nada que pedir.
  if (!ctx.user.actingUser || userCanUseApp(ctx.user, app)) return teamsError('already_has_access', 409);
  const burst = await rateLimit(`teams:access-request:${ctx.realId}`, 20, 3600);
  if (!burst.ok) return teamsError('rate_limited', 429);
  const { already } = await askForApp(ctx.team, { id: ctx.realId, name: ctx.real.name, email: ctx.real.email, role: ctx.role }, app);
  return NextResponse.json(already ? { ok: true, already: true } : { ok: true });
}

const denySchema = z.object({
  personId: z.string().min(1).max(128),
  /** El workspace que la pantalla cree estar editando. */
  workspaceId: z.string().max(128),
});

/**
 * DELETE { personId, workspaceId }: rechazar lo pendiente de esa persona. Se le
 * avisa, los avisos de los demás se cierran y puede volver a pedirlo. Un admin
 * solo responde por apps que tiene.
 */
export async function DELETE(req: NextRequest) {
  const ctx = await teamsCtx('admin');
  if (isResponse(ctx)) return ctx;
  const parsed = denySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return teamsError('invalid_input');
  const { personId, workspaceId } = parsed.data;
  if (workspaceId !== ctx.team.id) return teamsError('wrong_workspace', 409);
  const target = await getMemberRole(ctx.team.id, personId);
  if (!target) return teamsError('not_found', 404);
  if (!canManage(ctx.role, target)) return teamsError('forbidden', 403);
  const mine = ((await pendingRequests(ctx.team.id)).get(personId) ?? []).filter((a) => canUseApp({ role: ctx.role, apps: ctx.user.apps ?? '*' }, a));
  if (!mine.length) return teamsError('not_found', 404);
  const denied = await resolveRequests(ctx.team.id, personId, mine, 'denied', ctx.realId);
  await notifyAppsDenied(ctx.team, personId, ctx.real, denied).catch(() => undefined);
  return NextResponse.json({ ok: true, denied });
}
