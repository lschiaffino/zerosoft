import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/lib/db';
import { agentError, agentRouteContext } from '@/lib/agents-http';
import { recordAgentChange } from '@/lib/agents';
import { AGENT_MEMBER_ROLES, agentAccessLevel, parseAgentAccess, type AgentAccessConfig } from '@/lib/agents-access';
import { personAppAccess } from '@/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export interface AgentAccessPersonDto {
  id: string;
  name: string;
  email: string;
  /** Rol en el workspace ('owner' | 'admin' | 'member'). */
  role: string;
  /** Tiene la app Agents en el workspace (sin ella no entra, diga lo que diga el agente). */
  hasApp: boolean;
  /** Lo que se le asignó en este agente (null = lo de todos los miembros). */
  assigned: 'editor' | 'viewer' | 'none' | null;
  level: 'edit' | 'view' | 'none';
}

async function accessView(ownerId: string, access: AgentAccessConfig): Promise<{ members: 'viewer' | 'none'; people: AgentAccessPersonDto[] }> {
  const rows = (await getDb()
    .prepare(
      `SELECT u.id, u.name, u.email FROM users u
       WHERE u.id = ? OR u.id IN (SELECT m.user_id FROM team_members m JOIN teams t ON t.id = m.team_id WHERE t.owner_id = ? AND m.role != 'guest')
       ORDER BY COALESCE(u.name, u.email) LIMIT 500`,
    )
    .all(ownerId, ownerId)) as Array<{ id: string; name: string | null; email: string }>;
  const people: AgentAccessPersonDto[] = [];
  for (const r of rows) {
    const a = await personAppAccess(ownerId, r.id);
    if (!a) continue;
    const role = r.id === ownerId ? 'owner' : a.role;
    const hasApp = a.apps === '*' || a.apps.includes('agents');
    people.push({
      id: r.id,
      name: r.name || r.email,
      email: r.email,
      role,
      hasApp,
      assigned: access.people[r.id] ?? null,
      level: hasApp ? agentAccessLevel(role, r.id, access) : 'none',
    });
  }
  return { members: access.members, people };
}

/** Quién ve y quién edita este agente. Lo ve quien edita el agente. */
export async function GET(_req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const ctx = await agentRouteContext(id, { edit: true });
  if ('res' in ctx) return ctx.res;
  return NextResponse.json({ access: await accessView(ctx.user.id, parseAgentAccess(ctx.row.access)) });
}

const schema = z.object({
  members: z.enum(['viewer', 'none']).optional(),
  /** Una persona: su rol en el agente (null = vuelve a lo de todos). */
  person: z.object({ id: z.string().min(1).max(100), role: z.enum(AGENT_MEMBER_ROLES).nullable() }).optional(),
});

/** Cambia el acceso por defecto de los miembros o el de una persona. Solo admins y owners. */
export async function PATCH(req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const ctx = await agentRouteContext(id, { admin: true });
  if ('res' in ctx) return ctx.res;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success || (!parsed.data.members && !parsed.data.person)) return agentError(400, 'invalid_input');
  const access = parseAgentAccess(ctx.row.access);
  if (parsed.data.members) access.members = parsed.data.members;
  if (parsed.data.person) {
    const { id: personId, role } = parsed.data.person;
    // Solo personas del workspace (y no los admins: siempre editan).
    const a = await personAppAccess(ctx.user.id, personId);
    if (!a || personId === ctx.user.id) return agentError(400, 'invalid_person');
    if (a.role === 'admin' || a.role === 'owner') return agentError(400, 'admin_always_edits');
    if (role) access.people[personId] = role;
    else delete access.people[personId];
  }
  await getDb()
    .prepare('UPDATE agents SET access = ?, updated_at = ? WHERE id = ? AND user_id = ?')
    .run(JSON.stringify(access), new Date().toISOString(), id, ctx.user.id);
  await recordAgentChange(ctx.user.id, id, ctx.personId, 'access_changed', {
    ...(parsed.data.members ? { members: parsed.data.members } : {}),
    ...(parsed.data.person ? { role: parsed.data.person.role ?? 'default' } : {}),
  });
  return NextResponse.json({ access: await accessView(ctx.user.id, access) });
}
