import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isWorkspaceAdmin, realUserId } from '@/lib/session';
import { TeamspaceLimitError, createTeamspace, getDocsSettings, listTeamspaces, roleRank } from '@/lib/docs-access';
import { teamspaceCreateSchema } from '@/lib/docs-teamspace-http';
import { docsError, forbidden, invalidBody, unauthorized } from '@/lib/docs-http';
import { logDocsAudit, requestIp } from '@/lib/docs-audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Teamspaces que la persona ve (abiertos, cerrados y los privados de los que es miembro). */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  return NextResponse.json({ rows: await listTeamspaces(user.id, realUserId(user)) });
}

/** Crear un teamspace: admins, o miembros que pueden crear páginas en el workspace. Quien lo crea es su owner. */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const body: unknown = await req.json().catch(() => null);
  const parsed = teamspaceCreateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);
  if (!isWorkspaceAdmin(user) && roleRank((await getDocsSettings(user.id)).member_role) < roleRank('edit')) return forbidden();
  if (parsed.data.is_default && !isWorkspaceAdmin(user)) return forbidden();
  try {
    const ts = await createTeamspace(user.id, realUserId(user), parsed.data);
    await logDocsAudit({
      workspaceId: user.id,
      actor: user.actingUser ?? user,
      action: 'teamspace.created',
      detail: `${ts.name} · ${ts.access}`,
      ip: requestIp(req.headers),
    });
    return NextResponse.json(ts, { status: 201 });
  } catch (err) {
    if (err instanceof TeamspaceLimitError) return docsError(400, 'teamspace_limit');
    throw err;
  }
}
