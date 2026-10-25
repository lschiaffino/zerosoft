import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { deleteTeamspace, listTeamspaceMembers, updateTeamspace } from '@/lib/docs-access';
import { gateTeamspace, teamspaceUpdateSchema } from '@/lib/docs-teamspace-http';
import { forbidden, invalidBody, notFound, unauthorized } from '@/lib/docs-http';
import { logDocsAudit, requestIp } from '@/lib/docs-audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const gate = await gateTeamspace(user, id);
  if (!gate.ok) return notFound();
  return NextResponse.json({ ...gate.ts, my_role: gate.myRole, can_manage: gate.manage, members: await listTeamspaceMembers(id) });
}

/** Nombre, ícono, descripción, tipo (abierto/cerrado/privado) y rol de los miembros: owners o admins. */
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const gate = await gateTeamspace(user, id);
  if (!gate.ok) return notFound();
  if (!gate.manage) return forbidden();
  const body: unknown = await req.json().catch(() => null);
  const parsed = teamspaceUpdateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);
  const ts = await updateTeamspace(id, parsed.data);
  await logDocsAudit({
    workspaceId: user.id,
    actor: user.actingUser ?? user,
    action: 'teamspace.updated',
    detail: `${ts?.name ?? ''} · ${Object.keys(parsed.data).join(',')}`,
    ip: requestIp(req.headers),
  });
  return NextResponse.json(ts);
}

/** Borrar: sus páginas quedan en el workspace (nada se pierde). */
export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const gate = await gateTeamspace(user, id);
  if (!gate.ok) return notFound();
  if (!gate.manage) return forbidden();
  await deleteTeamspace(id);
  await logDocsAudit({ workspaceId: user.id, actor: user.actingUser ?? user, action: 'teamspace.deleted', detail: gate.ts.name, ip: requestIp(req.headers) });
  return new NextResponse(null, { status: 204 });
}
