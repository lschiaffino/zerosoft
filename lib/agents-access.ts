/**
 * Agents — acceso por agente. Owners y admins del workspace editan todos los
 * agentes. Para los miembros (con la app Agents habilitada en el workspace),
 * cada agente define:
 * - qué ven por defecto: 'viewer' (solo lectura, como hasta ahora) o 'none'
 *   (el agente no aparece en la lista, Cmd+K ni la API);
 * - excepciones por persona: 'editor' (edita la configuración, el
 *   conocimiento, los tests y las versiones), 'viewer' o 'none'.
 * Los secretos, servidores MCP, conexiones, aprobaciones y borrar el agente
 * siguen siendo de admins. Sin acceso a la base (lo usa la UI). El guardado
 * vive en agents.access (JSON).
 */
import { z } from 'zod';

export const AGENT_MEMBER_ROLES = ['editor', 'viewer', 'none'] as const;
export type AgentMemberRole = (typeof AGENT_MEMBER_ROLES)[number];
export type AgentAccessLevel = 'edit' | 'view' | 'none';

export const agentAccessSchema = z.object({
  members: z.enum(['viewer', 'none']).default('viewer'),
  people: z.record(z.string().min(1).max(100), z.enum(AGENT_MEMBER_ROLES)).default({}),
});
export type AgentAccessConfig = z.infer<typeof agentAccessSchema>;

export function parseAgentAccess(raw: string | null | undefined): AgentAccessConfig {
  try {
    const parsed = agentAccessSchema.safeParse(raw ? JSON.parse(raw) : {});
    if (parsed.success) return parsed.data;
  } catch {
    /* JSON roto */
  }
  return { members: 'viewer', people: {} };
}

/** Nivel de una persona en un agente, según su rol en el workspace y el acceso del agente. */
export function agentAccessLevel(role: string | null | undefined, personId: string, access: AgentAccessConfig): AgentAccessLevel {
  if (role === 'owner' || role === 'admin') return 'edit';
  if (role === 'guest') return 'none';
  const own = access.people[personId];
  if (own === 'editor') return 'edit';
  if (own === 'viewer') return 'view';
  if (own === 'none') return 'none';
  return access.members === 'none' ? 'none' : 'view';
}

export function agentAccessFor(
  user: { role?: string | null; id: string; actingUser?: { id: string } | null },
  row: { access?: string | null },
): AgentAccessLevel {
  return agentAccessLevel(user.role ?? 'owner', user.actingUser?.id ?? user.id, parseAgentAccess(row.access ?? null));
}
