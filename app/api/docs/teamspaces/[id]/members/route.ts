import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { listTeamspaceMembers, removeTeamspaceMember, setTeamspaceMember } from '@/lib/docs-access';
import { gateTeamspace, teamspaceMemberSchema, workspacePeople } from '@/lib/docs-teamspace-http';
import { docsError, forbidden, invalidBody, notFound, unauthorized } from '@/lib/docs-http';
import { auditTargetLabel, logDocsAudit, requestIp } from '@/lib/docs-audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Agregar a alguien (owners o admins) o unirse uno mismo a un teamspace
 * abierto. Solo personas del workspace (dueño o miembros de sus equipos).
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const gate = await gateTeamspace(user, id);
  if (!gate.ok) return notFound();
  const body: unknown = await req.json().catch(() => null);
  const parsed = teamspaceMemberSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);
  const me = realUserId(user);
  const self = parsed.data.user_id === me;
  const role = parsed.data.role ?? 'member';
  if (!gate.manage && !(self && gate.ts.access === 'open' && role === 'member')) return forbidden();
  if (!(await workspacePeople(user.id)).has(parsed.data.user_id)) return docsError(400, 'not_in_workspace');
  await setTeamspaceMember(id, parsed.data.user_id, role);
  await logDocsAudit({
    workspaceId: user.id,
    actor: user.actingUser ?? user,
    action: 'teamspace.member_added',
    detail: `${gate.ts.name} · ${await auditTargetLabel('user', parsed.data.user_id)} · ${role}`,
    ip: requestIp(req.headers),
  });
  return NextResponse.json({ rows: await listTeamspaceMembers(id) }, { status: 201 });
}

/** Sacar a alguien (owners o admins) o salir uno mismo (`?user=<id>`). */
export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const gate = await gateTeamspace(user, id);
  if (!gate.ok) return notFound();
  const target = req.nextUrl.searchParams.get('user') ?? '';
  const me = realUserId(user);
  if (target !== me && !gate.manage) return forbidden();
  const res = await removeTeamspaceMember(id, target);
  if (res === 'not_found') return notFound();
  if (res === 'last_owner') return docsError(400, 'last_owner');
  await logDocsAudit({
    workspaceId: user.id,
    actor: user.actingUser ?? user,
    action: 'teamspace.member_removed',
    detail: `${gate.ts.name} · ${await auditTargetLabel('user', target)}`,
    ip: requestIp(req.headers),
  });
  return NextResponse.json({ rows: await listTeamspaceMembers(id) });
}
