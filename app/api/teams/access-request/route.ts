import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isProductKey } from '@/lib/products';
import { rateLimit } from '@/lib/rate-limit';
import { userCanUseApp } from '@/lib/workspace';
import { isResponse, teamsCtx, teamsError } from '@/lib/teams-http';
import { notifyAppAccessRequest } from '@/lib/workspace-access-request';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ app: z.string().max(20) });

/**
 * POST { app }: pedirle a quien administra el workspace activo acceso a una
 * app que no tengo (pantalla "no tenés acceso"). Llega como aviso al owner y
 * a los admins. Un pedido por app por día (UTC); repetirlo responde ok sin
 * volver a avisar.
 */
export async function POST(req: NextRequest) {
  const ctx = await teamsCtx();
  if (isResponse(ctx)) return ctx;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success || !isProductKey(parsed.data.app)) return teamsError('invalid_input');
  const app = parsed.data.app;
  // En tu propio workspace, o si ya la tenés, no hay nada que pedir.
  if (!ctx.user.actingUser || userCanUseApp(ctx.user, app)) return teamsError('already_has_access', 409);
  const burst = await rateLimit(`teams:access-request:${ctx.realId}`, 20, 3600);
  if (!burst.ok) return teamsError('rate_limited', 429);
  const once = await rateLimit(`teams:access-request:${ctx.realId}:${ctx.team.id}:${app}`, 1, 86_400);
  if (!once.ok) return NextResponse.json({ ok: true, already: true });
  await notifyAppAccessRequest(ctx.team, { id: ctx.realId, name: ctx.real.name, email: ctx.real.email }, app);
  return NextResponse.json({ ok: true });
}
