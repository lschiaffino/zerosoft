/**
 * Agents — herramientas que el modelo puede llamar. Cada una:
 * - está acotada al workspace del agente (todo se filtra por user_id),
 * - valida su input con zod (el SDK rechaza inputs inválidos),
 * - nunca tira: devuelve { error: '<code>' } para que el modelo siga,
 * - queda registrada en agent_tool_calls (input, output, error, duración).
 * En modo simulación (dryRun: playground y casos de prueba) las herramientas
 * que escriben validan todo igual pero no ejecutan: devuelven
 * { simulated: true, wouldRun } con lo que habrían hecho.
 * Las que el dueño marcó en tools.requireApproval validan todo y quedan en
 * la cola de aprobación (lib/agents-approvals.ts): el agente le dice al
 * visitante que alguien del equipo tiene que aprobarlo, y la acción corre
 * (performAgentAction) recién cuando lo aprueban en Conversaciones.
 * Server-only.
 */
import { tool, type Tool } from 'ai';
import { withVisibleContent } from './docs-visible';
import { z } from 'zod';
import { getDb } from './db';
import { aiKnowledgeFilterSql } from './docs-access';
import type { AgentChannel, AgentConversationRow, AgentToolCallRow, RobotRow } from './db';
import {
  AGENT_HTTP_METHODS,
  type AgentDto,
  type AgentHttpMethod,
  type AgentStreamEvent,
  type AgentToolCallDto,
  type AgentToolKey,
  type ApprovableAgentTool,
} from './agents-config';
import { rankKnowledge, type KnowledgeDoc } from './knowledge-search';
import { extractDocsText, listCannedResponses } from './chat-data';
import { safeFetch, UnsafeUrlError } from './safe-fetch';

export interface AgentRunContext {
  agent: AgentDto;
  workspaceId: string;
  conversation: AgentConversationRow;
  channel: AgentChannel;
  runId: string;
  onEvent?: (event: AgentStreamEvent) => void;
  /** Herramientas llamadas en esta corrida (para la respuesta / la UI). */
  toolCalls: AgentToolCallDto[];
  /** Se marca cuando el agente deriva a un humano. */
  handoff: boolean;
  /** Motivo de la derivación (lo da el modelo o la palabra clave), para el disparador agent.handoff. */
  handoffReason?: string;
  /** Todo lo que escribió el visitante en esta conversación (para validar datos que dice ser suyos). */
  visitorText?: string;
  /** Simulación: las herramientas que escriben no se ejecutan (playground, tests). */
  dryRun?: boolean;
  /** Headers secretos de http_request ya descifrados. Nunca van al modelo ni al registro. */
  secretHeaders?: Array<{ name: string; domain: string; value: string }>;
}

type ToolOutput = Record<string, unknown>;

/** run_robot: cuánto espera su turno en la cola del workspace y tope de la corrida. */
const AGENT_ROBOT_WAIT_MS = 10_000;
const AGENT_ROBOT_TIMEOUT_MS = 60_000;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_IN_TEXT_RE = /[^\s@<>()[\]{},;:"'`]+@[^\s@<>()[\]{},;:"'`]+/g;

/** Emails que aparecen en lo que escribió el visitante (minúsculas, sin puntuación final). */
function emailsInText(text: string): Set<string> {
  const found = new Set<string>();
  for (const m of text.matchAll(EMAIL_IN_TEXT_RE)) {
    const e = m[0].replace(/[.!?…]+$/u, '').toLowerCase();
    if (EMAIL_RE.test(e)) found.add(e);
  }
  return found;
}

/**
 * Las herramientas que buscan o escriben un contacto por email solo aceptan un
 * email que el propio visitante escribió (completo, no como parte de otro).
 * Así el agente no sirve para tocar contactos ajenos, averiguar qué emails
 * están en el CRM ni mandarle confirmaciones a terceros. El playground es el
 * dueño probando: no aplica.
 */
function visitorGaveEmail(ctx: AgentRunContext, email: string): boolean {
  if (ctx.channel === 'playground') return true;
  return emailsInText(ctx.visitorText ?? '').has(email.trim().toLowerCase());
}

/** Resultado de una herramienta de escritura en modo simulación. */
export function simulated(wouldRun: Record<string, unknown>, extra: Record<string, unknown> = {}): ToolOutput {
  return {
    simulated: true,
    wouldRun,
    ...extra,
    note: 'Dry run: nothing was executed. Continue the conversation as if this action succeeded.',
  };
}

/** Saca de un texto cualquier aparición de los valores secretos. */
export function redactSecrets(text: string, secrets: string[]): string {
  let out = text;
  for (const v of secrets) {
    if (v.length >= 4) out = out.split(v).join('[redacted]');
  }
  return out;
}

function toJson(value: unknown, max = 8000): string {
  const s = JSON.stringify(value ?? null) ?? 'null';
  return s.length > max ? JSON.stringify({ truncated: true, preview: s.slice(0, max) }) : s;
}

/** Envuelve una herramienta: registro, eventos para la UI y errores como datos. */
function logged<I>(ctx: AgentRunContext, name: AgentToolKey, fn: (input: I) => Promise<ToolOutput>) {
  return async (input: I): Promise<ToolOutput> => {
    const id = crypto.randomUUID();
    const started = Date.now();
    ctx.onEvent?.({ type: 'tool-start', id, tool: name, input });
    let output: ToolOutput;
    let error: string | null = null;
    try {
      output = await fn(input);
      if (output && typeof output.error === 'string') error = output.error;
    } catch (err) {
      error = err instanceof Error && /^[a-z_]+$/.test(err.message) ? err.message : 'tool_failed';
      output = { error };
    }
    const durationMs = Date.now() - started;
    const createdAt = new Date().toISOString();
    try {
      await getDb()
        .prepare(
          `INSERT INTO agent_tool_calls (id, agent_id, user_id, conversation_id, run_id, tool, input, output, error, duration_ms, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          ctx.agent.id,
          ctx.workspaceId,
          ctx.conversation.id,
          ctx.runId,
          name,
          toJson(input, 4000),
          toJson(output),
          error,
          durationMs,
          createdAt,
        );
    } catch (err) {
      console.error('[agents] tool log failed', err);
    }
    ctx.toolCalls.push({ id, tool: name, input, output, error, durationMs, runId: ctx.runId, createdAt });
    ctx.onEvent?.({ type: 'tool-end', id, tool: name, output, error, durationMs });
    return output;
  };
}

// ---------- Conocimiento ----------

type KnowledgeKind = 'doc' | 'url' | 'canned';

export async function searchAgentKnowledge(
  agent: AgentDto,
  workspaceId: string,
  query: string,
  k = 5,
): Promise<Array<{ kind: KnowledgeKind; title: string; text: string; source?: string; score: number }>> {
  const db = getDb();
  const docs: Array<KnowledgeDoc<KnowledgeKind> & { chunk?: boolean; titleExtra?: string }> = [];
  const cfg = agent.knowledge;
  const pages = new Map<string, { id: string; title: string; content: string }>();
  if (cfg.allPublicDocs) {
    const rows = (await db
      .prepare(
        `SELECT id, title, content FROM docs_pages WHERE user_id = ? AND archived = 0 AND (is_public = 1 OR published = 1)${aiKnowledgeFilterSql()} ORDER BY updated_at DESC LIMIT 200`,
      )
      .all(workspaceId)) as Array<{ id: string; title: string; content: string }>;
    for (const r of rows) pages.set(r.id, r);
  }
  if (cfg.docsPageIds.length) {
    const ph = cfg.docsPageIds.map(() => '?').join(', ');
    const rows = (await db
      // Elegidas a mano en el agente: tampoco las de teamspaces cerrados o privados sin permiso de IA.
      .prepare(`SELECT id, title, content FROM docs_pages WHERE user_id = ? AND archived = 0 AND id IN (${ph})${aiKnowledgeFilterSql()}`)
      .all(workspaceId, ...cfg.docsPageIds)) as Array<{ id: string; title: string; content: string }>;
    for (const r of rows) pages.set(r.id, r);
  }
  // Sincronizados: solo si su origen también es conocimiento del agente (lib/docs-visible.ts).
  for (const p of await withVisibleContent(workspaceId, [...pages.values()], { knowledge: cfg.docsPageIds })) {
    docs.push({ kind: 'doc', title: p.title || 'Untitled', text: extractDocsText(p.content, 12_000) });
  }
  const urls = (await db
    .prepare("SELECT url, title, content FROM agent_knowledge_urls WHERE agent_id = ? AND user_id = ? AND status = 'ok'")
    .all(agent.id, workspaceId)) as Array<{ url: string; title: string; content: string }>;
  for (const u of urls) docs.push({ kind: 'url', title: u.title || u.url, text: u.content, source: u.url });
  if (cfg.cannedFromWidgetId) {
    const widget = await db
      .prepare('SELECT id FROM chat_widgets WHERE id = ? AND user_id = ?')
      .get(cfg.cannedFromWidgetId, workspaceId);
    if (widget) {
      for (const r of await listCannedResponses(cfg.cannedFromWidgetId)) {
        docs.push({ kind: 'canned', title: r.title, text: r.body, titleExtra: r.shortcut, chunk: false });
      }
    }
  }
  return rankKnowledge(docs, query, k);
}

// ---------- Herramientas ----------

export interface BuiltAgentTools {
  tools: Record<string, Tool>;
  enabled: AgentToolKey[];
  /** Derivación directa (palabras clave), con el mismo registro que la herramienta. */
  handoff: ((reason: string) => Promise<ToolOutput>) | null;
}

function hostAllowed(host: string, domains: string[]): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  return domains.some((d) => h === d || h.endsWith(`.${d}`));
}

async function findContact(workspaceId: string, email: string) {
  return (await getDb()
    .prepare(
      'SELECT id, first_name, last_name, email, lifecycle_stage, company_id FROM crm_contacts WHERE user_id = ? AND lower(email) = lower(?) ORDER BY created_at ASC LIMIT 1',
    )
    .get(workspaceId, email.trim())) as
    | { id: string; first_name: string; last_name: string; email: string; lifecycle_stage: string; company_id: string | null }
    | undefined;
}

export async function buildAgentTools(ctx: AgentRunContext): Promise<BuiltAgentTools> {
  const { agent, workspaceId } = ctx;
  const cfg = agent.tools;
  const on = new Set(cfg.enabled);
  const tools: Record<string, Tool> = {};
  const enabled: AgentToolKey[] = [];
  const add = (key: AgentToolKey, t: Tool) => {
    tools[key] = t;
    enabled.push(key);
  };

  if (on.has('search_knowledge')) {
    add(
      'search_knowledge',
      tool({
        description:
          "Search this business's knowledge base (docs pages, saved web pages and canned answers). Returns the most relevant passages. Use it before answering questions about the business.",
        inputSchema: z.object({ query: z.string().trim().min(2).max(300).describe('What to look for, in a few keywords') }),
        execute: logged(ctx, 'search_knowledge', async ({ query }: { query: string }) => {
          const results = await searchAgentKnowledge(agent, workspaceId, query);
          return {
            results: results.map((r) => ({ title: r.title, kind: r.kind, source: r.source ?? null, text: r.text })),
            ...(results.length === 0 ? { note: 'no relevant knowledge found' } : {}),
          };
        }),
      }),
    );
  }

  if (on.has('crm_find_contact')) {
    add(
      'crm_find_contact',
      tool({
        description:
          "Look up the visitor in the CRM by the email address THEY gave you. Returns only whether they exist, their first name and lifecycle stage.",
        inputSchema: z.object({ email: z.string().trim().max(200) }),
        execute: logged(ctx, 'crm_find_contact', async ({ email }: { email: string }) => {
          if (!EMAIL_RE.test(email)) return { error: 'invalid_email' };
          // Solo el email que el propio visitante escribió: evita usar al agente
          // para averiguar si un email cualquiera está en el CRM.
          if (!visitorGaveEmail(ctx, email)) return { error: 'email_not_given_by_visitor' };
          const c = await findContact(workspaceId, email);
          if (!c) return { found: false };
          return { found: true, contactId: c.id, firstName: c.first_name, lifecycleStage: c.lifecycle_stage };
        }),
      }),
    );
  }

  if (on.has('crm_upsert_contact')) {
    add(
      'crm_upsert_contact',
      tool({
        description:
          'Create or update the visitor as a CRM contact (by email). Optionally attach a short note (e.g. what they need, qualification answers). Only use details the visitor gave you.',
        inputSchema: z.object({
          email: z.string().trim().max(200),
          name: z.string().trim().max(120).optional(),
          note: z.string().trim().max(2000).optional(),
        }),
        execute: logged(ctx, 'crm_upsert_contact', async (input: { email: string; name?: string; note?: string }) => {
          if (!EMAIL_RE.test(input.email)) return { error: 'invalid_email' };
          if (!visitorGaveEmail(ctx, input.email)) return { error: 'email_not_given_by_visitor' };
          if (ctx.dryRun) {
            const existing = await findContact(workspaceId, input.email);
            return simulated({
              action: existing ? 'update_contact' : 'create_contact',
              email: input.email,
              name: input.name ?? null,
              note: input.note ?? null,
            });
          }
          return (await queueIfRequired(ctx, 'crm_upsert_contact', input)) ?? performAgentAction(actionContext(ctx), 'crm_upsert_contact', input);
        }),
      }),
    );
  }

  if (on.has('crm_log_note')) {
    add(
      'crm_log_note',
      tool({
        description: "Add a note to an existing CRM contact's timeline (found by email).",
        inputSchema: z.object({ email: z.string().trim().max(200), note: z.string().trim().min(1).max(2000) }),
        execute: logged(ctx, 'crm_log_note', async ({ email, note }: { email: string; note: string }) => {
          if (!EMAIL_RE.test(email)) return { error: 'invalid_email' };
          // Se valida antes de buscar: la respuesta no dice si un email ajeno existe.
          if (!visitorGaveEmail(ctx, email)) return { error: 'email_not_given_by_visitor' };
          const c = await findContact(workspaceId, email);
          if (!c) return { error: 'contact_not_found' };
          if (ctx.dryRun) return simulated({ action: 'log_note', contactId: c.id, note });
          return (
            (await queueIfRequired(ctx, 'crm_log_note', { email, note })) ??
            performAgentAction(actionContext(ctx), 'crm_log_note', { email, note })
          );
        }),
      }),
    );
  }

  // Cal: solo con un event type configurado y del workspace.
  const eventType = cfg.calEventTypeId
    ? ((await getDb()
        .prepare('SELECT id, title, duration_min, active FROM calendar_event_types WHERE id = ? AND user_id = ?')
        .get(cfg.calEventTypeId, workspaceId)) as { id: string; title: string; duration_min: number; active: number } | undefined)
    : undefined;
  if (eventType && on.has('cal_get_availability')) {
    add(
      'cal_get_availability',
      tool({
        description: `List the next free slots for "${eventType.title}" (${eventType.duration_min} min). Times are ISO 8601 (UTC) plus a label in the visitor's timezone.`,
        inputSchema: z.object({
          timezone: z.string().trim().max(64).optional().describe("Visitor's IANA timezone if known, e.g. America/Argentina/Buenos_Aires"),
          fromDate: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .optional()
            .describe('First day to look at (YYYY-MM-DD), default today'),
        }),
        execute: logged(ctx, 'cal_get_availability', async (input: { timezone?: string; fromDate?: string }) => {
          const { getAvailableSlots, localDate } = await import('./calendar');
          let tz = input.timezone || 'UTC';
          try {
            new Intl.DateTimeFormat('en', { timeZone: tz });
          } catch {
            tz = 'UTC';
          }
          const today = localDate(new Date(), tz);
          const start = input.fromDate && input.fromDate > today ? input.fromDate : today;
          const fmt = new Intl.DateTimeFormat('en-US', {
            timeZone: tz,
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
          });
          const slots: Array<{ start: string; label: string }> = [];
          const base = new Date(`${start}T12:00:00Z`);
          for (let d = 0; d < cfg.calDays && slots.length < 12; d++) {
            const date = new Date(base.getTime() + d * 86_400_000).toISOString().slice(0, 10);
            for (const s of await getAvailableSlots(eventType.id, tz, date)) {
              if (slots.length >= 12) break;
              slots.push({ start: s.start.toISOString(), label: fmt.format(s.start) });
            }
          }
          return {
            eventType: { title: eventType.title, durationMin: eventType.duration_min },
            timezone: tz,
            slots,
            ...(slots.length === 0 ? { note: `no free slots in the next ${cfg.calDays} days` } : {}),
          };
        }),
      }),
    );
  }

  if (eventType && on.has('cal_book_meeting')) {
    add(
      'cal_book_meeting',
      tool({
        description: `Book "${eventType.title}" for the visitor. Only after they explicitly confirmed one slot that cal_get_availability offered in an earlier turn, and gave their name and email. Sends the confirmation email.`,
        inputSchema: z.object({
          start: z.string().trim().max(40).describe('Exact ISO start of the confirmed slot, as returned by cal_get_availability'),
          name: z.string().trim().min(1).max(120),
          email: z.string().trim().max(200),
          timezone: z.string().trim().max(64).optional(),
          visitorConfirmed: z.boolean().describe('true only if the visitor explicitly confirmed this exact slot'),
          notes: z.string().trim().max(1000).optional(),
        }),
        execute: logged(
          ctx,
          'cal_book_meeting',
          async (input: { start: string; name: string; email: string; timezone?: string; visitorConfirmed: boolean; notes?: string }) => {
            if (input.visitorConfirmed !== true) return { error: 'not_confirmed' };
            if (!EMAIL_RE.test(input.email)) return { error: 'invalid_email' };
            // La confirmación sale por email: solo al que dio el visitante.
            if (!visitorGaveEmail(ctx, input.email)) return { error: 'email_not_given_by_visitor' };
            const startDate = new Date(input.start);
            if (Number.isNaN(startDate.getTime())) return { error: 'invalid_start' };
            // El horario tiene que haberse ofrecido antes (en una corrida
            // anterior: el visitante lo vio y confirmó en otro mensaje).
            const offered = (await getDb()
              .prepare(
                "SELECT output FROM agent_tool_calls WHERE conversation_id = ? AND tool = 'cal_get_availability' AND error IS NULL AND run_id != ? ORDER BY created_at DESC LIMIT 10",
              )
              .all(ctx.conversation.id, ctx.runId)) as Array<Pick<AgentToolCallRow, 'output'>>;
            const iso = startDate.toISOString();
            const wasOffered = offered.some((o) => {
              try {
                const out = JSON.parse(o.output ?? '{}') as { slots?: Array<{ start?: string }> };
                return (out.slots ?? []).some((s) => s.start === iso);
              } catch {
                return false;
              }
            });
            if (!wasOffered) return { error: 'slot_not_offered' };
            const { findOfferedSlot } = await import('./calendar');
            const tz = input.timezone || 'UTC';
            // Doble chequeo: el slot sigue libre ahora mismo.
            const slot = await findOfferedSlot(eventType.id, startDate, tz).catch(() => null);
            if (!slot) return { error: 'slot_unavailable' };
            if (ctx.dryRun) {
              return simulated({
                action: 'book_meeting',
                eventType: eventType.title,
                start: slot.start.toISOString(),
                name: input.name,
                email: input.email,
                timezone: tz,
              });
            }
            const booking = { start: iso, name: input.name, email: input.email, timezone: tz, notes: input.notes };
            return (
              (await queueIfRequired(ctx, 'cal_book_meeting', booking)) ??
              performAgentAction(actionContext(ctx), 'cal_book_meeting', booking)
            );
          },
        ),
      }),
    );
  }

  if (on.has('track_create_issue') && cfg.trackProjectId) {
    const project = (await getDb()
      .prepare('SELECT id, name FROM track_projects WHERE id = ? AND owner_id = ?')
      .get(cfg.trackProjectId, workspaceId)) as { id: string; name: string } | undefined;
    if (project) {
      add(
        'track_create_issue',
        tool({
          description: `Create an issue in the "${project.name}" project for the team (bug reports, feature requests, follow-ups). Include the visitor's contact details in the description if they gave them.`,
          inputSchema: z.object({
            title: z.string().trim().min(3).max(200),
            description: z.string().trim().max(4000).optional(),
            priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
          }),
          execute: logged(
            ctx,
            'track_create_issue',
            async (input: { title: string; description?: string; priority?: 'low' | 'medium' | 'high' | 'urgent' }) => {
              if (ctx.dryRun) {
                return simulated({
                  action: 'create_issue',
                  project: project.name,
                  title: input.title,
                  description: input.description ?? null,
                  priority: input.priority ?? 'medium',
                });
              }
              return (
                (await queueIfRequired(ctx, 'track_create_issue', input)) ??
                performAgentAction(actionContext(ctx), 'track_create_issue', input)
              );
            },
          ),
        }),
      );
    }
  }

  if (on.has('run_flow') && cfg.flowIds.length) {
    const ph = cfg.flowIds.map(() => '?').join(', ');
    const flows = (await getDb()
      .prepare(`SELECT id, name, description FROM flow_flows WHERE user_id = ? AND id IN (${ph})`)
      .all(workspaceId, ...cfg.flowIds)) as Array<{ id: string; name: string; description: string }>;
    if (flows.length) {
      const ids = flows.map((f) => f.id) as [string, ...string[]];
      add(
        'run_flow',
        tool({
          description: `Start one of these automations with a JSON input:\n${flows
            .map((f) => `- ${f.id}: ${f.name}${f.description ? ` — ${f.description}` : ''}`)
            .join('\n')}`,
          inputSchema: z.object({
            flowId: z.enum(ids),
            input: z.record(z.string(), z.unknown()).optional().describe('JSON object passed to the flow as its input'),
          }),
          execute: logged(ctx, 'run_flow', async ({ flowId, input }: { flowId: string; input?: Record<string, unknown> }) => {
            // Doble chequeo: solo flows configurados y del workspace.
            if (!cfg.flowIds.includes(flowId)) return { error: 'flow_not_allowed' };
            const { getFlowRow } = await import('./flow');
            const row = await getFlowRow(workspaceId, flowId);
            if (!row) return { error: 'flow_not_found' };
            const payload = JSON.parse(JSON.stringify(input ?? {})) as Record<string, unknown>;
            if (ctx.dryRun) return simulated({ action: 'run_flow', flow: row.name, input: payload });
            return (
              (await queueIfRequired(ctx, 'run_flow', { flowId, input: payload })) ??
              performAgentAction(actionContext(ctx), 'run_flow', { flowId, input: payload })
            );
          }),
        }),
      );
    }
  }

  if (on.has('run_robot') && cfg.robotIds.length) {
    const ph = cfg.robotIds.map(() => '?').join(', ');
    const rows = (await getDb()
      .prepare(`SELECT * FROM robots WHERE user_id = ? AND id IN (${ph})`)
      .all(workspaceId, ...cfg.robotIds)) as RobotRow[];
    if (rows.length) {
      const { toRobotDto } = await import('./robots');
      const robots = rows.map((r) => toRobotDto(r));
      const ids = robots.map((r) => r.id) as [string, ...string[]];
      const describe = (r: (typeof robots)[number]) => {
        const inputs = r.inputs.map((i) => `${i.name}${i.required ? '*' : ''}${i.kind === 'list' ? ' (list)' : ''}`).join(', ');
        return `- ${r.id}: ${r.name}${r.description ? ` — ${r.description.slice(0, 200)}` : ''}${inputs ? ` [inputs: ${inputs}]` : ''}`;
      };
      add(
        'run_robot',
        tool({
          description: `Run one of these browser robots (it opens a real browser on a website, follows its steps and returns the data it extracted). Inputs marked * are required; list inputs take an array of strings.\n${robots
            .map(describe)
            .join('\n')}`,
          inputSchema: z.object({
            robotId: z.enum(ids),
            inputs: z.record(z.string(), z.unknown()).optional().describe("The robot's inputs, by name"),
          }),
          execute: logged(ctx, 'run_robot', async ({ robotId, inputs }: { robotId: string; inputs?: Record<string, unknown> }) => {
            // Doble chequeo: solo robots configurados y del workspace.
            if (!cfg.robotIds.includes(robotId)) return { error: 'robot_not_allowed' };
            const robot = robots.find((r) => r.id === robotId);
            if (!robot) return { error: 'robot_not_found' };
            const values = JSON.parse(JSON.stringify(inputs ?? {})) as Record<string, unknown>;
            const { resolveInputs } = await import('./robots-schema');
            const resolved = resolveInputs(robot.inputs, values);
            if (!resolved.ok) return { error: 'missing_input', input: resolved.name };
            // Un robot puede hacer clics y mandar formularios: en simulación no se abre el navegador.
            if (ctx.dryRun) return simulated({ action: 'run_robot', robot: robot.name, inputs: resolved.inputs });
            const { startRobotRun } = await import('./robots');
            const res = await startRobotRun(workspaceId, robotId, values, {
              trigger: 'agent',
              // La respuesta del agente tiene su propio tope: espera poco su turno y acota la corrida.
              waitMs: AGENT_ROBOT_WAIT_MS,
              timeoutCapMs: AGENT_ROBOT_TIMEOUT_MS,
            });
            if (!res.ok) return { error: `robot_${res.error}` };
            const run = res.run;
            return {
              runId: run.id,
              status: run.status,
              ...(run.error ? { error: run.error } : {}),
              warnings: run.warnings,
              output: JSON.parse(toJson(run.output, 6000)) as unknown,
            };
          }),
        }),
      );
    }
  }

  let handoff: BuiltAgentTools['handoff'] = null;
  if (on.has('handoff_to_human')) {
    const run = logged(ctx, 'handoff_to_human', async ({ reason }: { reason: string }) => {
      ctx.handoff = true;
      ctx.handoffReason = String(reason ?? '').slice(0, 500);
      await getDb()
        .prepare('UPDATE agent_conversations SET handed_off = 1, updated_at = ? WHERE id = ?')
        .run(new Date().toISOString(), ctx.conversation.id);
      // Chat: lo marca lib/agents-chat.ts (mensaje de sistema + prioridad + aviso).
      if (ctx.channel === 'public' || ctx.channel === 'api') {
        const { createNotification } = await import('./notifications');
        await createNotification({
          userId: workspaceId,
          type: 'chat_message',
          title: `${agent.name}: a visitor needs a human`,
          body: reason.slice(0, 140),
          href: `/app/agents/${agent.id}?tab=conversations&c=${ctx.conversation.id}`,
          sourceType: 'agent_conversation',
          sourceId: ctx.conversation.id,
          meta: { handoff: true, agentId: agent.id },
        }).catch(() => {});
      }
      return { handedOff: true, tellVisitor: 'A teammate will follow up soon.' };
    });
    handoff = (reason: string) => run({ reason });
    add(
      'handoff_to_human',
      tool({
        description: 'Hand the conversation to a human teammate (the team gets notified).',
        inputSchema: z.object({ reason: z.string().trim().min(1).max(300).describe('Short reason, for the team') }),
        execute: run,
      }),
    );
  }

  if (on.has('http_request') && cfg.httpAllowedDomains.length) {
    const domains = cfg.httpAllowedDomains;
    const secrets = (ctx.secretHeaders ?? []).filter((h) => h.value && domains.includes(h.domain));
    // El modelo sabe qué dominios van autenticados, nunca los valores.
    const authDomains = [...new Set(secrets.map((h) => h.domain))];
    add(
      'http_request',
      tool({
        description: `Make an HTTP request to an allowed API (domains: ${domains.join(', ')}). Returns status and up to 4000 characters of the body.${
          authDomains.length ? ` Authentication headers are added automatically for: ${authDomains.join(', ')}.` : ''
        }`,
        inputSchema: z.object({
          url: z.string().trim().url().max(2000),
          method: z.enum(AGENT_HTTP_METHODS).default('GET'),
          body: z.string().max(4000).optional().describe('JSON body (not for GET)'),
        }),
        execute: logged(ctx, 'http_request', async (input: { url: string; method: AgentHttpMethod; body?: string }) => {
          let url: URL;
          try {
            url = new URL(input.url);
          } catch {
            return { error: 'invalid_url' };
          }
          if (!hostAllowed(url.hostname, domains)) return { error: 'domain_not_allowed' };
          const hasBody = input.method !== 'GET' && input.method !== 'DELETE';
          const extra: Record<string, string> = {};
          for (const h of secrets) if (hostAllowed(url.hostname, [h.domain])) extra[h.name] = h.value;
          // GET se ejecuta también en simulación (solo lee); el resto se simula.
          if (ctx.dryRun && input.method !== 'GET') {
            return simulated({
              action: 'http_request',
              method: input.method,
              url: url.toString(),
              body: hasBody ? (input.body ?? '{}') : null,
              secretHeaders: Object.keys(extra),
            });
          }
          const request = { url: url.toString(), method: input.method, body: input.body };
          // Leer (GET) nunca espera aprobación.
          const queued = input.method === 'GET' ? null : await queueIfRequired(ctx, 'http_request', request);
          return queued ?? performAgentAction(actionContext(ctx), 'http_request', request);
        }),
      }),
    );
  }

  return { tools, enabled, handoff };
}

// ---------- Ejecución de acciones (directa o al aprobarlas) ----------

/** Lo que una acción necesita para correr fuera de la corrida del modelo (aprobación). */
export interface AgentActionContext {
  agent: AgentDto;
  workspaceId: string;
  conversationId: string;
  channel: AgentChannel;
  secretHeaders: Array<{ name: string; domain: string; value: string }>;
}

function actionContext(ctx: AgentRunContext): AgentActionContext {
  return {
    agent: ctx.agent,
    workspaceId: ctx.workspaceId,
    conversationId: ctx.conversation.id,
    channel: ctx.channel,
    secretHeaders: ctx.secretHeaders ?? [],
  };
}

/** Si la herramienta pide aprobación, la encola y devuelve lo que el modelo le dice al visitante. */
async function queueIfRequired(ctx: AgentRunContext, tool: ApprovableAgentTool, input: Record<string, unknown>): Promise<ToolOutput | null> {
  if (ctx.dryRun || !(ctx.agent.tools.requireApproval ?? []).includes(tool)) return null;
  const { queueAgentAction } = await import('./agents-approvals');
  const id = await queueAgentAction(actionContext(ctx), tool, input);
  return {
    pending: true,
    approvalId: id,
    tellVisitor:
      'This needs a teammate to approve it before it happens. Tell the visitor it is pending approval and that the team will follow up; do not say it is done.',
  };
}

type ActionInput = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/**
 * Ejecuta una acción que escribe. La llaman las herramientas (sin aprobación)
 * y lib/agents-approvals.ts al aprobar: revalida contra la configuración
 * actual del agente (un evento, proyecto, flow o dominio sacado ya no corre).
 */
export async function performAgentAction(actx: AgentActionContext, tool: ApprovableAgentTool, input: ActionInput): Promise<ToolOutput> {
  const { agent, workspaceId } = actx;
  const cfg = agent.tools;
  switch (tool) {
    case 'crm_upsert_contact': {
      const { findOrCreateContact } = await import('./crm-integrations');
      const { createActivity, updateContact } = await import('./crm');
      const name = str(input.name) || null;
      const note = str(input.note);
      const { contact, created } = await findOrCreateContact(workspaceId, { email: str(input.email), name, source: 'other' });
      if (!created && name && !contact.first_name && !contact.last_name) {
        const [firstName, ...rest] = name.trim().split(/\s+/);
        await updateContact(workspaceId, contact.id, { firstName, lastName: rest.join(' ') });
      }
      let activityId: string | null = null;
      if (note) {
        const a = await createActivity(workspaceId, { type: 'note', subject: `Agent: ${agent.name}`, body: note, contactId: contact.id });
        activityId = a.id;
      }
      return { contactId: contact.id, created, noteLogged: Boolean(activityId) };
    }
    case 'crm_log_note': {
      const c = await findContact(workspaceId, str(input.email));
      if (!c) return { error: 'contact_not_found' };
      const { createActivity } = await import('./crm');
      const a = await createActivity(workspaceId, { type: 'note', subject: `Agent: ${agent.name}`, body: str(input.note), contactId: c.id });
      return { logged: true, activityId: a.id };
    }
    case 'cal_book_meeting': {
      const eventType = cfg.calEventTypeId
        ? ((await getDb()
            .prepare('SELECT id, title FROM calendar_event_types WHERE id = ? AND user_id = ?')
            .get(cfg.calEventTypeId, workspaceId)) as { id: string; title: string } | undefined)
        : undefined;
      if (!eventType) return { error: 'event_type_not_configured' };
      const { findOfferedSlot, createBooking, CalendarError } = await import('./calendar');
      const { afterBookingCreated } = await import('./calendar-lifecycle');
      const tz = str(input.timezone) || 'UTC';
      const slot = await findOfferedSlot(eventType.id, new Date(str(input.start)), tz).catch(() => null);
      if (!slot) return { error: 'slot_unavailable' };
      try {
        const booking = await createBooking({
          eventTypeId: eventType.id,
          email: str(input.email),
          name: str(input.name),
          start: slot.start.toISOString(),
          timezone: tz,
          answers: str(input.notes) ? { notes: str(input.notes) } : {},
        });
        const synced = await afterBookingCreated(booking);
        return {
          booked: true,
          // 'pending': el evento pide que el anfitrión confirme la reserva.
          status: synced.status,
          bookingId: synced.id,
          startsAt: synced.starts_at,
          endsAt: synced.ends_at,
          meetingUrl: synced.meeting_url,
        };
      } catch (err) {
        if (err instanceof CalendarError) return { error: err.code };
        throw err;
      }
    }
    case 'track_create_issue': {
      const project = cfg.trackProjectId
        ? ((await getDb()
            .prepare('SELECT id, name FROM track_projects WHERE id = ? AND owner_id = ?')
            .get(cfg.trackProjectId, workspaceId)) as { id: string; name: string } | undefined)
        : undefined;
      if (!project) return { error: 'project_not_configured' };
      const { createIssue } = await import('./track-data');
      const body = [str(input.description), `— Created by the agent "${agent.name}" (${actx.channel})`].filter(Boolean).join('\n\n');
      const priority = (['low', 'medium', 'high', 'urgent'] as const).find((p) => p === input.priority) ?? 'medium';
      const issue = await createIssue(
        project.id,
        workspaceId,
        { title: str(input.title), description: [{ type: 'text', text: body }], priority },
        { source: actx.channel === 'chat' ? 'chat' : 'agent' },
      );
      return { issueId: issue.id, identifier: issue.identifier, title: issue.title };
    }
    case 'run_flow': {
      const flowId = str(input.flowId);
      if (!cfg.flowIds.includes(flowId)) return { error: 'flow_not_allowed' };
      const { getFlowRow, enqueueRun, kickFlowWorker } = await import('./flow');
      const row = await getFlowRow(workspaceId, flowId);
      if (!row) return { error: 'flow_not_found' };
      const payload = (input.input && typeof input.input === 'object' ? input.input : {}) as Record<string, unknown>;
      const runId = await enqueueRun(row, 'manual', {
        ...payload,
        agent: { id: agent.id, name: agent.name, conversationId: actx.conversationId, channel: actx.channel },
      });
      if (!runId) return { error: 'rate_limited' };
      kickFlowWorker();
      return { runId, status: 'queued', flow: row.name };
    }
    case 'http_request': {
      let url: URL;
      try {
        url = new URL(str(input.url));
      } catch {
        return { error: 'invalid_url' };
      }
      if (!hostAllowed(url.hostname, cfg.httpAllowedDomains)) return { error: 'domain_not_allowed' };
      const method = (AGENT_HTTP_METHODS as readonly string[]).includes(str(input.method)) ? (str(input.method) as AgentHttpMethod) : 'GET';
      const hasBody = method !== 'GET' && method !== 'DELETE';
      const secrets = actx.secretHeaders.filter((h) => h.value && cfg.httpAllowedDomains.includes(h.domain));
      const extra: Record<string, string> = {};
      for (const h of secrets) if (hostAllowed(url.hostname, [h.domain])) extra[h.name] = h.value;
      try {
        const res = await safeFetch(
          url.toString(),
          {
            method,
            headers: { ...extra, 'user-agent': 'Zerosoft-Agents/1', ...(hasBody ? { 'content-type': 'application/json' } : {}) },
            body: hasBody ? str(input.body) || '{}' : undefined,
          },
          8000,
        );
        // Una API que devuelve el header (eco, errores) no se lo filtra al modelo.
        const text = redactSecrets((await res.text().catch(() => '')).slice(0, 200_000), secrets.map((h) => h.value)).slice(0, 4000);
        return { status: res.status, ok: res.ok, body: text };
      } catch (err) {
        if (err instanceof UnsafeUrlError) return { error: err.message };
        return { error: err instanceof Error && err.name === 'TimeoutError' ? 'timeout' : 'network_error' };
      }
    }
  }
}
