import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { listMembers } from '@/lib/teams';
import type { DocsMentionableUser } from '@/lib/docs-types';
import { unauthorized } from '@/lib/docs-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Miembros mencionables del workspace activo (team activo o solo el owner). */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const rows: DocsMentionableUser[] = user.team
    ? (await listMembers(user.team.id)).map((m) => ({
        id: m.user_id,
        name: m.name,
        email: m.email,
      }))
    : [{ id: user.id, name: user.name, email: user.email }];

  return NextResponse.json({ rows });
}
