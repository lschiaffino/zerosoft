import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { desktopBadge } from '@/lib/desktop-badge';
import { jsonError } from '@/lib/write-limit';
import { recordLifecycleEvent } from '@/lib/lifecycle/signals';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Contador del dock y avisos nuevos para la app de escritorio (la consulta
 * cada 30 s con su sesión). ?since=<ISO de la respuesta anterior>. También
 * dice quién tiene la sesión (Ajustes › Cuenta del escritorio).
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  const since = req.nextUrl.searchParams.get('since')?.slice(0, 40) ?? null;
  // La primera consulta de cada arranque (sin since): la app está instalada, aunque se haya entrado
  // con email dentro de la ventana y no por el login del navegador (lib/desktop-auth.ts).
  if (!since) await recordLifecycleEvent(realUserId(user), 'desktop_installed');
  const badge = await desktopBadge(user, since);
  // En un workspace ajeno, `user` es el dueño: la cuenta que se muestra es la de quien inició sesión.
  const me = user.actingUser ?? user;
  return NextResponse.json({ ...badge, user: { email: me.email, name: me.name ?? '' } }, { headers: { 'cache-control': 'no-store' } });
}
