import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { workspaceTeamId } from '@/lib/workspace';
import { listMembers } from '@/lib/teams';
import { isWorkspacePerson } from '@/lib/crm-refs';
import { canReadPage, DOC_INTERNAL_WRITE, getDocPageRow, listPageMentionables } from '@/lib/docs';
import type { DocsMentionableUser } from '@/lib/docs-types';
import { notFound, unauthorized } from '@/lib/docs-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Miembros del workspace activo (team activo o solo el owner). Con `?page=`,
 * los mencionables de esa página: los del workspace dueño de la página.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const pageId = req.nextUrl.searchParams.get('page');
  if (pageId) {
    const page = await getDocPageRow(pageId);
    if (!page || !(await canReadPage(page, user, DOC_INTERNAL_WRITE))) {
      return notFound();
    }
    const rows = await listPageMentionables(page);
    // Un guest (o alguien de afuera con la página compartida) no ve los emails del equipo.
    const viewer = user.actingUser?.id ?? user.id;
    const inside = await isWorkspacePerson(page.user_id, viewer);
    return NextResponse.json({ rows: inside ? rows : rows.map((r) => ({ ...r, email: '' })) });
  }

  const rows: DocsMentionableUser[] = workspaceTeamId(user)
    ? (await listMembers(workspaceTeamId(user)!)).map((m) => ({
        id: m.user_id,
        name: m.name,
        email: m.email,
      }))
    : [{ id: user.id, name: user.name, email: user.email }];

  return NextResponse.json({ rows });
}
