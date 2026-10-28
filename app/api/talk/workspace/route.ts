import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/session';
import { safeInternalPath } from '@/lib/return-path';
import { TALK_WS_COOKIE, resolveTalkActor } from '@/lib/talk-guests';
import { talkActor } from '@/lib/talk';
import { jsonError } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const COOKIE = { httpOnly: true, sameSite: 'lax' as const, path: '/', maxAge: 365 * 86_400 };

/** ¿Puede usar Talk en ese workspace? (el suyo, o uno donde es invitada). */
async function allowed(ws: string): Promise<boolean | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  if (ws === talkActor(user).workspaceId) return true;
  return (await resolveTalkActor(user, { workspaceId: ws })).workspaceId === ws;
}

function withCookie(res: NextResponse, ws: string, own: boolean) {
  if (own) res.cookies.delete(TALK_WS_COOKIE);
  else res.cookies.set(TALK_WS_COOKIE, ws, { ...COOKIE, secure: process.env.NODE_ENV === 'production' });
  return res;
}

/** Cambia el workspace de Talk y vuelve a `next` (links de avisos de otro workspace). */
export async function GET(req: NextRequest) {
  const ws = req.nextUrl.searchParams.get('ws') ?? '';
  const next = safeInternalPath(req.nextUrl.searchParams.get('next')) ?? '/app/talk';
  const ok = await allowed(ws);
  if (ok === null) return jsonError(401, 'unauthorized');
  if (!ok) return NextResponse.redirect(new URL('/app/talk', req.url));
  const user = (await getCurrentUser())!;
  return withCookie(NextResponse.redirect(new URL(next, req.url)), ws, ws === talkActor(user).workspaceId);
}

/** { workspaceId } desde el selector del sidebar. */
export async function POST(req: NextRequest) {
  const body = z.object({ workspaceId: z.string().max(64) }).safeParse(await req.json().catch(() => null));
  if (!body.success) return jsonError(400, 'invalid_input');
  const ws = body.data.workspaceId;
  const ok = await allowed(ws);
  if (ok === null) return jsonError(401, 'unauthorized');
  if (!ok) return jsonError(403, 'forbidden');
  const user = (await getCurrentUser())!;
  return withCookie(NextResponse.json({ ok: true }), ws, ws === talkActor(user).workspaceId);
}
