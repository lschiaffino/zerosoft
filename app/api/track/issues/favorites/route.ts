import { NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { listFavoriteIssues } from '@/lib/track-issue-favorites';
import { unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Issues favoritos de la persona (sidebar de Track). */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  return NextResponse.json({ rows: await listFavoriteIssues(user.team?.id ?? null, user.id, realUserId(user)) });
}
