/**
 * Automatizaciones de una persona que sale del workspace. Lo que armó sigue
 * corriendo a nombre del workspace aunque ella ya no esté, y puede mandar
 * datos afuera (webhooks, flows, robots, agentes con HTTP o MCP). Al sacarla:
 * - webhooks que creó: se apagan y sus entregas pendientes se cancelan;
 * - flows que creó o publicó por última vez, y robots que creó: se apagan;
 * - agentes que creó con salida HTTP o MCP: se apagan; los demás (sin salida
 *   afuera) pasan al owner para no cortar la atención de Chat.
 * El owner recibe un aviso con lo que quedó apagado, para revisarlo y volver
 * a prenderlo si corresponde. Nunca tira.
 */
import { getDb } from './db';

export interface RemovedAutomations {
  webhooks: number;
  deliveries: number;
  flows: number;
  robots: number;
  agents: number;
  agentsReassigned: number;
}

const COPY = {
  en: { title: 'Automations paused', body: '{name} left the workspace. Paused what they created: {list}. Review and turn back on what you need.', w: 'webhooks', f: 'flows', r: 'robots', a: 'agents' },
  es: { title: 'Automatizaciones pausadas', body: '{name} salió del workspace. Pausamos lo que había creado: {list}. Revisalo y volvé a prender lo que necesites.', w: 'webhooks', f: 'flows', r: 'robots', a: 'agentes' },
  pt: { title: 'Automações pausadas', body: '{name} saiu do workspace. Pausamos o que a pessoa criou: {list}. Revise e ligue de novo o que precisar.', w: 'webhooks', f: 'flows', r: 'robots', a: 'agentes' },
};

async function count(sql: string, args: string[]): Promise<number> {
  try {
    return (await getDb().prepare(sql).run(...args)).changes;
  } catch (err) {
    if (/no such table|no such column/i.test(String(err))) return 0;
    throw err;
  }
}

export async function pauseRemovedPersonAutomations(ownerId: string, userId: string): Promise<RemovedAutomations> {
  const out: RemovedAutomations = { webhooks: 0, deliveries: 0, flows: 0, robots: 0, agents: 0, agentsReassigned: 0 };
  if (!userId || userId === ownerId) return out;
  try {
    out.deliveries = await count(
      `UPDATE webhook_deliveries SET status = 'failed', last_error = 'creator_removed', next_attempt_at = NULL
       WHERE status = 'pending' AND webhook_id IN (SELECT id FROM webhooks WHERE user_id = ? AND created_by = ?)`,
      [ownerId, userId],
    );
    out.webhooks = await count('UPDATE webhooks SET active = 0 WHERE user_id = ? AND created_by = ? AND active = 1', [ownerId, userId]);
    // Flows que creó o cuya última versión publicada es suya.
    out.flows = await count(
      `UPDATE flow_flows SET enabled = 0 WHERE user_id = ? AND enabled = 1 AND (created_by = ? OR id IN (
         SELECT v.flow_id FROM flow_versions v WHERE v.user_id = ? AND v.created_by = ?
           AND v.created_at = (SELECT MAX(x.created_at) FROM flow_versions x WHERE x.flow_id = v.flow_id)))`,
      [ownerId, userId, ownerId, userId],
    );
    out.robots = await count('UPDATE robots SET enabled = 0 WHERE user_id = ? AND created_by = ? AND enabled = 1', [ownerId, userId]);
    out.agents = await count(
      `UPDATE agents SET enabled = 0 WHERE user_id = ? AND created_by = ? AND enabled = 1
       AND (instr(tools, 'http') > 0 OR instr(tools, 'mcp') > 0)`,
      [ownerId, userId],
    );
    out.agentsReassigned = await count('UPDATE agents SET created_by = ? WHERE user_id = ? AND created_by = ?', [ownerId, ownerId, userId]);
    const paused = out.webhooks + out.flows + out.robots + out.agents;
    if (paused > 0) {
      const db = getDb();
      const owner = (await db.prepare('SELECT locale FROM users WHERE id = ?').get(ownerId).catch(() => undefined)) as { locale?: string | null } | undefined;
      const person = (await db.prepare('SELECT name, email FROM users WHERE id = ?').get(userId)) as { name: string | null; email: string } | undefined;
      const c = COPY[owner?.locale === 'es' || owner?.locale === 'pt' ? owner.locale : 'en'];
      const list = [
        out.webhooks ? `${out.webhooks} ${c.w}` : '',
        out.flows ? `${out.flows} ${c.f}` : '',
        out.robots ? `${out.robots} ${c.r}` : '',
        out.agents ? `${out.agents} ${c.a}` : '',
      ]
        .filter(Boolean)
        .join(', ');
      const { createNotification } = await import('./notifications');
      await createNotification({
        userId: ownerId,
        type: 'workspace_access',
        title: c.title,
        body: c.body.replace('{name}', person?.name || person?.email || '').replace('{list}', list),
        href: out.webhooks ? '/app/settings/api#webhooks' : out.flows ? '/app/flow' : out.robots ? '/app/robots' : '/app/agents',
        sourceType: 'workspace_member',
        sourceId: userId,
      });
    }
  } catch (err) {
    console.error('[workspace] pause automations', err);
  }
  return out;
}
