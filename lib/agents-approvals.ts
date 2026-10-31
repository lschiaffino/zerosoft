/**
 * Agents — acciones que esperan la aprobación de alguien del equipo.
 * Server-only.
 *
 * Cuando el dueño marca una herramienta en tools.requireApproval, el agente
 * valida todo como siempre pero en vez de ejecutar deja la acción en
 * agent_pending_actions (con el input ya validado), avisa al equipo y le dice
 * al visitante que está pendiente. En la pestaña Conversaciones alguien la
 * aprueba (corre performAgentAction con la configuración actual del agente) o
 * la rechaza. La decisión queda como una llamada más en agent_tool_calls:
 * así el agente la ve en su historial la próxima vez que el visitante escribe.
 */
import { localized } from './notification-copy';
import { getDb, type AgentConversationRow } from './db';
import { isApprovableTool, type AgentPendingActionDto, type ApprovableAgentTool } from './agents-config';
import { performAgentAction, type AgentActionContext } from './agent-tools';

interface PendingRow {
  id: string;
  agent_id: string;
  user_id: string;
  conversation_id: string;
  tool: string;
  input: string;
  status: AgentPendingActionDto['status'];
  result: string | null;
  decided_by: string;
  decided_at: string | null;
  created_at: string;
}

function parse(v: string | null): unknown {
  if (!v) return null;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

function toDto(r: PendingRow): AgentPendingActionDto {
  return {
    id: r.id,
    conversationId: r.conversation_id,
    tool: r.tool as ApprovableAgentTool,
    input: parse(r.input),
    status: r.status,
    result: parse(r.result),
    decidedBy: r.decided_by,
    decidedAt: r.decided_at,
    createdAt: r.created_at,
  };
}

/** Encola la acción y avisa al equipo. Devuelve el id. */
export async function queueAgentAction(
  actx: Pick<AgentActionContext, 'agent' | 'workspaceId' | 'conversationId'>,
  tool: ApprovableAgentTool,
  input: Record<string, unknown>,
): Promise<string> {
  const id = crypto.randomUUID();
  await getDb()
    .prepare(
      `INSERT INTO agent_pending_actions (id, agent_id, user_id, conversation_id, tool, input, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
    )
    .run(id, actx.agent.id, actx.workspaceId, actx.conversationId, tool, JSON.stringify(input).slice(0, 8000), new Date().toISOString());
  const { createNotification } = await import('./notifications');
  await createNotification({
    userId: actx.workspaceId,
    type: 'chat_message',
    title: localized('agentNeedsApproval', { agent: actx.agent.name }),
    body: approvalSummary(tool, input).slice(0, 140),
    href: `/app/agents/${actx.agent.id}?tab=conversations&c=${actx.conversationId}`,
    sourceType: 'agent_conversation',
    sourceId: actx.conversationId,
    meta: { approval: true, agentId: actx.agent.id, actionId: id },
  }).catch(() => {});
  return id;
}

/** Una línea para la notificación (en inglés, como el resto de los avisos de Agents). */
export function approvalSummary(tool: ApprovableAgentTool, input: Record<string, unknown>): string {
  const s = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : '');
  switch (tool) {
    case 'crm_upsert_contact':
      return `Save ${s('email')} as a CRM contact`;
    case 'crm_log_note':
      return `Add a note to ${s('email')}`;
    case 'cal_book_meeting':
      return `Book a meeting for ${s('email')} at ${s('start')}`;
    case 'track_create_issue':
      return `Create the issue "${s('title')}"`;
    case 'run_flow':
      return `Run a flow`;
    case 'http_request':
      return `${s('method')} ${s('url')}`;
    case 'docs_write_page':
      return s('operation') === 'create' ? `Create the page "${s('title')}"` : `Edit a Docs page (${s('operation') || 'append'})`;
    case 'docs_write_row':
      return s('rowId') ? `Update a row in a Docs database` : `Add the row "${s('title')}" to a Docs database`;
    case 'mcp_call':
      return `${s('server')}: ${s('tool')}`;
  }
}

/** Página que una acción de Docs edita (la página, la base o la página madre al crear). */
function docsTarget(input: unknown): string | null {
  const i = (input ?? {}) as { pageId?: unknown; parentId?: unknown };
  if (typeof i.pageId === 'string' && i.pageId) return i.pageId;
  if (typeof i.parentId === 'string' && i.parentId) return i.parentId;
  return null;
}

/**
 * Acciones de Docs: solo las ve en detalle y las decide quien puede editar la
 * página destino; al aprobarlas la escritura corre con su acceso.
 */
async function canDecideDocs(workspaceId: string, personId: string, input: unknown, agentDocsActorId?: string | null): Promise<boolean> {
  const target = docsTarget(input);
  const { docsActorFor, pageFor } = await import('./docs-platform-access');
  const actor = await docsActorFor(workspaceId, personId);
  if (!actor) return false;
  if (target) return Boolean(await pageFor(actor, target, { write: true }));
  // Crear sin página madre: la persona con cuyo acceso trabaja el agente, o quien puede crear páginas en la raíz.
  if ((input as { operation?: unknown } | null)?.operation !== 'create') return false;
  if (agentDocsActorId && agentDocsActorId === personId) return true;
  if (actor.role === 'owner' || actor.role === 'admin') return true;
  const { getDocsSettings, roleRank } = await import('./docs-access');
  return roleRank((await getDocsSettings(workspaceId)).member_role) >= roleRank('edit');
}

async function agentDocsActor(workspaceId: string, agentId: string): Promise<string | null> {
  const { getAgentRow, toAgentDto } = await import('./agents');
  const row = await getAgentRow(workspaceId, agentId);
  return row ? (toAgentDto(row).tools.docsActorId ?? null) : null;
}

export async function listAgentActions(
  workspaceId: string,
  agentId: string,
  opts: { conversationId?: string; status?: AgentPendingActionDto['status']; viewerId?: string } = {},
): Promise<AgentPendingActionDto[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT * FROM agent_pending_actions
       WHERE user_id = ? AND agent_id = ? AND (? IS NULL OR conversation_id = ?) AND (? IS NULL OR status = ?)
       ORDER BY created_at DESC LIMIT 200`,
    )
    .all(
      workspaceId,
      agentId,
      opts.conversationId ?? null,
      opts.conversationId ?? null,
      opts.status ?? null,
      opts.status ?? null,
    )) as PendingRow[];
  const out: AgentPendingActionDto[] = [];
  const docsActorId = rows.some((r) => r.tool.startsWith('docs_')) ? await agentDocsActor(workspaceId, agentId) : null;
  for (const r of rows) {
    const dto = toDto(r);
    if (opts.viewerId !== undefined && r.tool.startsWith('docs_') && !(await canDecideDocs(workspaceId, opts.viewerId, dto.input, docsActorId))) {
      out.push({ ...dto, input: { hidden: true }, result: null, locked: true });
    } else out.push(dto);
  }
  return out;
}

/** Pendientes por conversación (para marcar la lista). */
export async function pendingCountsByConversation(workspaceId: string, agentId: string): Promise<Map<string, number>> {
  const rows = (await getDb()
    .prepare(
      `SELECT conversation_id AS id, COUNT(*) AS n FROM agent_pending_actions
       WHERE user_id = ? AND agent_id = ? AND status = 'pending' GROUP BY conversation_id`,
    )
    .all(workspaceId, agentId)) as Array<{ id: string; n: number }>;
  return new Map(rows.map((r) => [r.id, Number(r.n)]));
}

export type DecideResult =
  | { ok: true; action: AgentPendingActionDto }
  | { ok: false; error: 'not_found' | 'already_decided' | 'agent_not_found' | 'not_allowed' };

/**
 * Aprueba (y ejecuta) o rechaza una acción pendiente. El claim es atómico:
 * dos personas apretando a la vez no la ejecutan dos veces.
 */
export async function decideAgentAction(
  workspaceId: string,
  agentId: string,
  actionId: string,
  decision: 'approve' | 'reject',
  actorEmail: string,
  /** Persona que decide: en Docs tiene que poder editar la página, y la escritura corre con su acceso. */
  approverId?: string,
): Promise<DecideResult> {
  const db = getDb();
  const row = (await db
    .prepare('SELECT * FROM agent_pending_actions WHERE id = ? AND user_id = ? AND agent_id = ?')
    .get(actionId, workspaceId, agentId)) as PendingRow | undefined;
  if (!row || !isApprovableTool(row.tool)) return { ok: false, error: 'not_found' };
  const isDocs = row.tool.startsWith('docs_');
  if (isDocs && approverId !== undefined && !(await canDecideDocs(workspaceId, approverId, parse(row.input), await agentDocsActor(workspaceId, agentId)))) {
    return { ok: false, error: 'not_allowed' };
  }
  const ts = new Date().toISOString();
  const claimed = await db
    .prepare(
      `UPDATE agent_pending_actions SET status = ?, decided_by = ?, decided_at = ? WHERE id = ? AND status = 'pending'`,
    )
    .run(decision === 'approve' ? 'approved' : 'rejected', actorEmail, ts, actionId);
  if (!claimed.changes) return { ok: false, error: 'already_decided' };

  const input = (parse(row.input) ?? {}) as Record<string, unknown>;
  let output: Record<string, unknown>;
  let status: AgentPendingActionDto['status'] = decision === 'approve' ? 'approved' : 'rejected';
  if (decision === 'approve') {
    const { getAgentRow, toAgentDto, loadSecretHeaders } = await import('./agents');
    const agentRow = await getAgentRow(workspaceId, agentId);
    const conv = (await db.prepare('SELECT * FROM agent_conversations WHERE id = ?').get(row.conversation_id)) as
      | AgentConversationRow
      | undefined;
    if (!agentRow || !conv) {
      await db.prepare("UPDATE agent_pending_actions SET status = 'failed', result = ? WHERE id = ?").run(JSON.stringify({ error: 'agent_not_found' }), actionId);
      return { ok: false, error: 'agent_not_found' };
    }
    try {
      output = await performAgentAction(
        {
          agent: toAgentDto(agentRow),
          workspaceId,
          conversationId: conv.id,
          channel: conv.channel,
          secretHeaders: loadSecretHeaders(agentRow),
          conversationCreatedBy: conv.created_by ?? null,
          mcpServers: agentRow.mcp_servers ?? '[]',
        },
        row.tool,
        input,
        // Docs: con el acceso de quien aprueba (se revalida la página al escribir).
        isDocs && approverId !== undefined ? approverId : undefined,
      );
    } catch (err) {
      output = { error: err instanceof Error && /^[a-z_]+$/.test(err.message) ? err.message : 'tool_failed' };
    }
    if (typeof output.error === 'string') status = 'failed';
  } else {
    output = { rejected: true };
  }
  await db.prepare('UPDATE agent_pending_actions SET status = ?, result = ? WHERE id = ?').run(status, JSON.stringify(output).slice(0, 8000), actionId);

  // La decisión entra al historial de herramientas que el agente ve en su próximo turno.
  const error = typeof output.error === 'string' ? output.error : null;
  // Docs: se registra con el acceso de quién corrió (solo esa persona ve el detalle).
  let capturedBy: string | null = null;
  if (isDocs && approverId !== undefined) capturedBy = approverId;
  else if (isDocs) {
    const { getAgentRow, toAgentDto } = await import('./agents');
    const { docsActorOf } = await import('./agent-tools');
    const agentRow = await getAgentRow(workspaceId, agentId);
    const conv = (await db.prepare('SELECT channel, created_by FROM agent_conversations WHERE id = ?').get(row.conversation_id)) as
      | Pick<AgentConversationRow, 'channel' | 'created_by'>
      | undefined;
    if (agentRow && conv) capturedBy = docsActorOf(conv.channel, conv.created_by, toAgentDto(agentRow).tools);
  }
  await db
    .prepare(
      `INSERT INTO agent_tool_calls (id, agent_id, user_id, conversation_id, run_id, tool, input, output, error, duration_ms, created_at, captured_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    )
    .run(
      crypto.randomUUID(),
      agentId,
      workspaceId,
      row.conversation_id,
      `approval:${actionId}`,
      row.tool,
      row.input,
      JSON.stringify({ approval: status, decidedBy: actorEmail, ...output }).slice(0, 8000),
      // Un rechazo no es un error de la herramienta: el agente tiene que verlo.
      status === 'failed' ? error : null,
      ts,
      capturedBy,
    )
    .catch(() => {});
  const updated = (await db.prepare('SELECT * FROM agent_pending_actions WHERE id = ?').get(actionId)) as PendingRow;
  return { ok: true, action: toDto(updated) };
}
