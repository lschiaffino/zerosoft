import { NextResponse } from 'next/server';
import { getCurrentUser, type SessionUser } from '../session';

/** Sesión para las rutas del asistente: sin sesión 401, guest 403. */
export async function assistantUser(): Promise<SessionUser | NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (user.role === 'guest') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  return user;
}

export function owner(user: SessionUser) {
  return { workspaceId: user.id, personId: user.actingUser?.id ?? user.id };
}

export function localeOf(raw: unknown): string {
  return raw === 'es' || raw === 'pt' ? raw : 'en';
}
