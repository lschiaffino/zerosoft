import { NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { listFavoriteViews } from '@/lib/track-ux';
import { unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Vistas favoritas de la persona (sidebar de Track). */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const rows = await listFavoriteViews(user.team?.id ?? null, user.id, realUserId(user));
  return NextResponse.json({ rows });
}
