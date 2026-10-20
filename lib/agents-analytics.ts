/**
 * Agents — métricas de la pestaña Analítica: resolución (el agente contestó y
 * nadie tuvo que intervenir), derivaciones, corridas que llegaron al tope de
 * pasos, errores por herramienta, pulgares y temas (lib/agents-topics.ts, sin
 * modelo). Sin el playground: son conversaciones de prueba del equipo.
 * Las corridas salen de agent_runs (056); antes de esa migración no hay.
 */
import { getDb } from './db';
import { clusterTopics, type TopicClusters } from './agents-topics';

export const ANALYTICS_RANGES = [7, 30, 90] as const;
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number];

export function parseAnalyticsRange(raw: string | null | undefined): AnalyticsRange {
  const n = Number(raw);
  return ANALYTICS_RANGES.includes(n as AnalyticsRange) ? (n as AnalyticsRange) : 30;
}

export interface ToolMetric {
  tool: string;
  calls: number;
  errors: number;
  avgMs: number;
  lastError: string | null;
}

export interface AgentAnalytics {
  days: AnalyticsRange;
  from: string;
  conversations: number;
  /** Con al menos una respuesta del agente. */
  answered: number;
  /** Contestadas por el agente y sin derivar. */
  resolved: number;
  handedOff: number;
  resolutionRate: number | null;
  handoffRate: number | null;
  runs: number;
  stepLimits: number;
  toolCalls: number;
  toolErrors: number;
  toolErrorRate: number | null;
  tools: ToolMetric[];
  thumbsUp: number;
  thumbsDown: number;
  channels: Array<{ channel: string; conversations: number }>;
  topics: TopicClusters;
}

function rate(n: number, d: number): number | null {
  return d > 0 ? n / d : null;
}

export async function getAgentAnalytics(
  workspaceId: string,
  agentId: string,
  days: AnalyticsRange = 30,
  now = new Date(),
): Promise<AgentAnalytics> {
  const db = getDb();
  const from = new Date(now.getTime() - days * 86_400_000).toISOString();

  const conv = (await db
    .prepare(
      `SELECT COUNT(*) AS total,
         COALESCE(SUM(handed_off), 0) AS handed_off,
         COALESCE(SUM(answered), 0) AS answered,
         COALESCE(SUM(CASE WHEN answered = 1 AND handed_off = 0 THEN 1 ELSE 0 END), 0) AS resolved
       FROM (
         SELECT c.handed_off,
           CASE WHEN c.chat_conversation_id IS NOT NULL
             THEN EXISTS (SELECT 1 FROM chat_messages m WHERE m.conversation_id = c.chat_conversation_id AND m.sender_type = 'bot')
             ELSE EXISTS (SELECT 1 FROM agent_messages m WHERE m.conversation_id = c.id AND m.role = 'assistant' AND m.author_id IS NULL)
           END AS answered
         FROM agent_conversations c
         WHERE c.user_id = ? AND c.agent_id = ? AND c.channel != 'playground' AND c.created_at >= ?
       )`,
    )
    .get(workspaceId, agentId, from)) as { total: number; handed_off: number; answered: number; resolved: number };

  const channels = (await db
    .prepare(
      `SELECT channel, COUNT(*) AS conversations FROM agent_conversations
       WHERE user_id = ? AND agent_id = ? AND channel != 'playground' AND created_at >= ?
       GROUP BY channel ORDER BY conversations DESC`,
    )
    .all(workspaceId, agentId, from)) as Array<{ channel: string; conversations: number }>;

  const runs = (await db
    .prepare(
      `SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN status = 'step_limit' THEN 1 ELSE 0 END), 0) AS step_limits
       FROM agent_runs WHERE user_id = ? AND agent_id = ? AND channel != 'playground' AND created_at >= ?`,
    )
    .get(workspaceId, agentId, from)) as { total: number; step_limits: number };

  const tools = (await db
    .prepare(
      `SELECT t.tool AS tool, COUNT(*) AS calls,
         COALESCE(SUM(CASE WHEN t.error IS NOT NULL THEN 1 ELSE 0 END), 0) AS errors,
         COALESCE(AVG(t.duration_ms), 0) AS avg_ms,
         (SELECT e.error FROM agent_tool_calls e JOIN agent_conversations ec ON ec.id = e.conversation_id
          WHERE e.agent_id = t.agent_id AND e.tool = t.tool AND e.error IS NOT NULL AND ec.channel != 'playground' AND e.created_at >= ?
          ORDER BY e.created_at DESC LIMIT 1) AS last_error
       FROM agent_tool_calls t
       JOIN agent_conversations c ON c.id = t.conversation_id
       WHERE t.user_id = ? AND t.agent_id = ? AND c.channel != 'playground' AND t.created_at >= ?
       GROUP BY t.tool
       ORDER BY errors DESC, calls DESC`,
    )
    .all(from, workspaceId, agentId, from)) as Array<{ tool: string; calls: number; errors: number; avg_ms: number; last_error: string | null }>;

  const feedback = (await db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN f.rating = 1 THEN 1 ELSE 0 END), 0) AS up,
              COALESCE(SUM(CASE WHEN f.rating = -1 THEN 1 ELSE 0 END), 0) AS down
       FROM agent_feedback f JOIN agent_conversations c ON c.id = f.conversation_id
       WHERE f.user_id = ? AND f.agent_id = ? AND c.channel != 'playground' AND f.created_at >= ?`,
    )
    .get(workspaceId, agentId, from)) as { up: number; down: number };

  // Temas: el título es el primer mensaje del visitante (hasta 80 caracteres).
  const docs = (await db
    .prepare(
      `SELECT title, handed_off FROM agent_conversations
       WHERE user_id = ? AND agent_id = ? AND channel != 'playground' AND created_at >= ?
       ORDER BY created_at DESC LIMIT 2000`,
    )
    .all(workspaceId, agentId, from)) as Array<{ title: string; handed_off: number }>;

  const total = Number(conv?.total ?? 0);
  const handedOff = Number(conv?.handed_off ?? 0);
  const resolved = Number(conv?.resolved ?? 0);
  const toolCalls = tools.reduce((n, t) => n + Number(t.calls), 0);
  const toolErrors = tools.reduce((n, t) => n + Number(t.errors), 0);
  return {
    days,
    from,
    conversations: total,
    answered: Number(conv?.answered ?? 0),
    resolved,
    handedOff,
    resolutionRate: rate(resolved, total),
    handoffRate: rate(handedOff, total),
    runs: Number(runs?.total ?? 0),
    stepLimits: Number(runs?.step_limits ?? 0),
    toolCalls,
    toolErrors,
    toolErrorRate: rate(toolErrors, toolCalls),
    tools: tools.map((t) => ({
      tool: t.tool,
      calls: Number(t.calls),
      errors: Number(t.errors),
      avgMs: Math.round(Number(t.avg_ms)),
      lastError: t.last_error ? t.last_error.slice(0, 200) : null,
    })),
    thumbsUp: Number(feedback?.up ?? 0),
    thumbsDown: Number(feedback?.down ?? 0),
    channels: channels.map((c) => ({ channel: c.channel, conversations: Number(c.conversations) })),
    topics: clusterTopics(docs.map((d) => ({ text: d.title, handedOff: Number(d.handed_off) === 1 }))),
  };
}
