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
  type AgentReplyUi,
} from './agents-config';
import { buttonsUi, formUi } from './agents-ui-blocks';
import { rankKnowledge, type KnowledgeDoc } from './knowledge-search';
import { extractDocsText, listCannedResponses } from './chat-data';
import { safeFetch, UnsafeUrlError } from './safe-fetch';
import { allSecretVariants, redactDeep, redactText } from './agents-secrets';
import type { DocsPageWriteInput, DocsRowWriteInput } from './agent-docs-tools';

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
  /** Email del visitante identificado (firma del widget o la API key): cuenta como dado por él. */
  identifiedEmail?: string | null;
  /** Fuentes que devolvió search_knowledge en esta corrida, por número de cita. */
  citations?: Map<number, KnowledgeCitation>;
  /** Búsquedas en el conocimiento de esta corrida y cuántas no encontraron nada. */
  searches?: { calls: number; empty: number };
  /** agents.mcp_servers (JSON con el header cifrado): servidores MCP del agente. */
  mcpServers?: string;
  /** Valores secretos (y sus partes) que nunca se registran ni vuelven al modelo. */
  secretValues?: string[];
  /** Botones o formulario que acompañan la respuesta (show_buttons, show_form, procedimientos). */
  ui?: AgentReplyUi | null;
  /** El modelo arrancó un procedimiento (start_procedure): lo corre runAgent al terminar el paso. */
  procedureStart?: string | null;
  /** Conexiones de Stripe y Shopify ya descifradas. Nunca van al modelo ni al registro. */
  integrations?: { stripeKey: string; shopify: { shop: string; token: string } | null };
  /** Playground: acceso de quien prueba (ver playgroundAccess). undefined = sin resolver. */
  playgroundCaller?: PlaygroundCaller | null;
  /** agents.access (JSON): acceso por agente, para saber si quien prueba lo edita. */
  agentAccess?: string | null;
}

export interface KnowledgeCitation {
  title: string;
  url: string | null;
  kind: string;
}

type ToolOutput = Record<string, unknown>;

/**
 * Persona con cuyo acceso trabaja el agente en Docs. Si quien le habla está
 * identificado (playground, Flow con su dueño, API key), esa persona; si no
 * (Chat, página pública, Groups), quien lo configuró (tools.docsActorId).
 */
export function docsActorOf(channel: AgentChannel, conversationCreatedBy: string | null | undefined, cfg: { docsActorId?: string | null }): string | null {
  if (conversationCreatedBy && (channel === 'playground' || channel === 'api')) return conversationCreatedBy;
  if (channel === 'playground') return null;
  return cfg.docsActorId ?? null;
}

/** shopify_order: intentos por conversación. */
const SHOPIFY_MAX_TRIES = 3;

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
  // Playground: la persona prueba con datos que escribe ella (las lecturas
  // reales las acota playgroundAccess).
  if (ctx.channel === 'playground') return true;
  const e = email.trim().toLowerCase();
  if (ctx.identifiedEmail && ctx.identifiedEmail.trim().toLowerCase() === e) return true;
  return emailsInText(ctx.visitorText ?? '').has(e);
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
function logged<I>(ctx: AgentRunContext, name: AgentToolKey | 'start_procedure', fn: (input: I) => Promise<ToolOutput>) {
  return async (input: I): Promise<ToolOutput> => {
    const id = crypto.randomUUID();
    const started = Date.now();
    ctx.onEvent?.({ type: 'tool-start', id, tool: name, input });
    let output: ToolOutput;
    let error: string | null = null;
    try {
      output = (await playgroundGate(ctx, name)) ?? (await fn(input));
      if (output && typeof output.error === 'string') error = output.error;
    } catch (err) {
      error = err instanceof Error && /^[a-z_]+$/.test(err.message) ? err.message : 'tool_failed';
      output = { error };
    }
    // Ningún secreto (ni sus partes) entra al registro, a la UI ni al modelo.
    if (ctx.secretValues?.length) output = redactDeep(output, ctx.secretValues);
    const durationMs = Date.now() - started;
    const createdAt = new Date().toISOString();
    try {
      await getDb()
        .prepare(
          `INSERT INTO agent_tool_calls (id, agent_id, user_id, conversation_id, run_id, tool, input, output, error, duration_ms, created_at, captured_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          name.startsWith('docs_') ? docsActorOf(ctx.channel, ctx.conversation.created_by, ctx.agent.tools) : null,
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

type KnowledgeKind = 'doc' | 'url' | 'canned' | 'file' | 'qa';

/** Link público de una página de Docs publicada en el centro de ayuda (/h/<handle>/<slug>), o null. */
async function helpCenterLinks(workspaceId: string, pageIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (pageIds.length === 0) return out;
  const db = getDb();
  const owner = (await db.prepare('SELECT handle FROM users WHERE id = ?').get(workspaceId)) as { handle: string | null } | undefined;
  if (!owner?.handle) return out;
  const ph = pageIds.map(() => '?').join(', ');
  const rows = (await db
    .prepare(`SELECT id, slug FROM docs_pages WHERE user_id = ? AND published = 1 AND slug IS NOT NULL AND slug != '' AND id IN (${ph})`)
    .all(workspaceId, ...pageIds)) as Array<{ id: string; slug: string }>;
  const { siteUrl } = await import('./board-urls');
  for (const r of rows) out.set(r.id, `${siteUrl()}/h/${owner.handle}/${r.slug}`);
  return out;
}

export type AgentKnowledgeDoc = KnowledgeDoc<KnowledgeKind> & { chunk?: boolean; titleExtra?: string };

/**
 * Busca en el conocimiento del agente: palabras clave (BM25) y, con la
 * búsqueda semántica activa, embeddings fusionados con el ranking léxico
 * (lib/agents-semantic.ts). Si los embeddings fallan, queda el léxico.
 */
export async function searchAgentKnowledge(
  agent: AgentDto,
  workspaceId: string,
  query: string,
  k = 5,
  opts: { fakeEmbeddings?: boolean } = {},
): Promise<Array<{ kind: KnowledgeKind; title: string; text: string; source?: string; score: number }>> {
  const docs = await collectAgentKnowledgeDocs(agent, workspaceId);
  if (agent.settings?.semanticSearch) {
    const { hybridRank } = await import('./agents-semantic');
    return hybridRank(workspaceId, docs, query, k, { fake: opts.fakeEmbeddings });
  }
  return rankKnowledge(docs, query, k);
}

/** Todo el conocimiento del agente como documentos (Docs, URLs, fuentes, archivos, pares, respuestas guardadas). */
export async function collectAgentKnowledgeDocs(agent: AgentDto, workspaceId: string): Promise<AgentKnowledgeDoc[]> {
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
  const links = await helpCenterLinks(workspaceId, [...pages.keys()]);
  // Sincronizados: solo si su origen también es conocimiento del agente (lib/docs-visible.ts).
  for (const p of await withVisibleContent(workspaceId, [...pages.values()], { knowledge: cfg.docsPageIds })) {
    docs.push({ kind: 'doc', title: p.title || 'Untitled', text: extractDocsText(p.content, 12_000), source: links.get(p.id) });
  }
  // URLs: las de esta configuración (las agregadas a mano y las de sus sitemaps), ya descargadas.
  const urls = (await db
    .prepare("SELECT url, title, content, origin FROM agent_knowledge_urls WHERE agent_id = ? AND user_id = ? AND status = 'ok'")
    .all(agent.id, workspaceId)) as Array<{ url: string; title: string; content: string; origin: string | null }>;
  const manual = new Set(cfg.urls);
  const sitemaps = new Set((cfg.sitemaps ?? []).map((sm) => sm.url));
  for (const u of urls) {
    // Artículos de una fuente externa (Zendesk): origin 'source:<id>', siempre del agente.
    const fromSource = Boolean(u.origin?.startsWith('source:'));
    if (!fromSource && (u.origin ? !sitemaps.has(u.origin) : !manual.has(u.url))) continue;
    docs.push({ kind: 'url', title: u.title || u.url, text: u.content, source: u.url });
  }
  const { ownKnowledgeDocs } = await import('./agents-knowledge');
  for (const d of await ownKnowledgeDocs(agent.id, workspaceId)) docs.push(d);
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
  return docs;
}

/** "Fuentes" en el idioma más probable del visitante. */
function sourcesLabel(visitorText: string): string {
  const t = visitorText.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();
  if (/\b(ola|obrigad|preciso|voce|nao|quero|tenho)\b/.test(t)) return 'Fontes';
  if (/\b(hola|gracias|quiero|necesito|tengo|como|cuanto|donde|por favor)\b/.test(t)) return 'Fuentes';
  return 'Sources';
}

/**
 * Citas: el modelo marca con [n] el pasaje que usó (el número viene de
 * search_knowledge). Se sacan las marcas que no corresponden y, si quedó
 * alguna, se agrega la lista de fuentes con su link (texto plano: se ve igual
 * en Chat, la página pública, la API y Groups). Los pares de pregunta y
 * respuesta y las respuestas guardadas no se citan.
 */
export function applyCitations(
  text: string,
  citations: Map<number, KnowledgeCitation> | undefined,
  opts: { enabled: boolean; visitorText?: string },
): string {
  const strip = (t: string) => t.replace(/ ?\[(\d{1,2})\]/g, '').replace(/[ \t]+\n/g, '\n').trim();
  if (!opts.enabled || !citations || citations.size === 0) return strip(text);
  const used: number[] = [];
  const out = text.replace(/ ?\[(\d{1,2})\]/g, (m, n: string) => {
    const ref = Number(n);
    const c = citations.get(ref);
    if (!c || c.kind === 'qa' || c.kind === 'canned') return '';
    if (!used.includes(ref)) used.push(ref);
    return ` [${used.indexOf(ref) + 1}]`;
  });
  if (used.length === 0) return strip(text);
  const lines = used.map((ref, i) => {
    const c = citations.get(ref)!;
    return c.url ? `[${i + 1}] ${c.title}: ${c.url}` : `[${i + 1}] ${c.title}`;
  });
  return `${out.trim()}\n\n${sourcesLabel(opts.visitorText ?? '')}:\n${lines.join('\n')}`;
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

/** Acceso de quien prueba en el playground (lo resuelve playgroundAccess una vez por corrida). */
export interface PlaygroundCaller {
  email: string | null;
  /** Edita el agente (en el workspace: owner o admin). */
  canEdit: boolean;
  apps: '*' | string[];
}

/**
 * Playground: las herramientas que leen datos reales de otra app (CRM, MCP,
 * HTTP) solo corren para quien edita el agente y tiene esa app en el
 * workspace. La identidad "verificada" es la propia: su email. null = nadie
 * identificado (se niega todo).
 */
export async function playgroundAccess(ctx: AgentRunContext): Promise<PlaygroundCaller | null> {
  if (ctx.channel !== 'playground') return null;
  if (ctx.playgroundCaller !== undefined) return ctx.playgroundCaller;
  const personId = ctx.conversation.created_by ?? null;
  let caller: PlaygroundCaller | null = null;
  if (personId) {
    const { personAppAccess } = await import('./api-auth');
    const access = await personAppAccess(ctx.workspaceId, personId).catch(() => null);
    const user = (await getDb().prepare('SELECT email FROM users WHERE id = ?').get(personId)) as { email: string | null } | undefined;
    if (access) {
      // Edita el agente: owner, admin o editor de este agente (lib/agents-access.ts).
      const { agentAccessLevel, parseAgentAccess } = await import('./agents-access');
      const role = personId === ctx.workspaceId ? 'owner' : access.role;
      const canEdit = agentAccessLevel(role, personId, parseAgentAccess(ctx.agentAccess ?? null)) === 'edit';
      caller = { email: user?.email?.trim().toLowerCase() ?? null, canEdit, apps: access.apps };
    }
  }
  ctx.playgroundCaller = caller;
  return caller;
}

/** App de la suite que toca cada herramienta (quien prueba en el playground tiene que tenerla). */
export const AGENT_TOOL_APP: Partial<Record<string, string>> = {
  crm_find_contact: 'crm',
  crm_upsert_contact: 'crm',
  crm_log_note: 'crm',
  cal_get_availability: 'cal',
  cal_book_meeting: 'cal',
  track_create_issue: 'track',
  run_flow: 'flow',
  run_robot: 'robots',
};

/** Herramientas que leen datos de clientes o servicios: en el playground, solo para quien edita el agente. */
const PLAYGROUND_EDIT_TOOLS = new Set(['crm_find_contact', 'crm_upsert_contact', 'crm_log_note', 'stripe_customer', 'shopify_order', 'http_request', 'mcp_call']);

/** Playground: null si quien prueba puede correr la herramienta; si no, el error. */
async function playgroundGate(ctx: AgentRunContext, name: string): Promise<ToolOutput | null> {
  if (ctx.channel !== 'playground') return null;
  const caller = await playgroundAccess(ctx);
  if (!caller) return { error: 'playground_no_access' };
  const app = AGENT_TOOL_APP[name];
  if (app && caller.apps !== '*' && !caller.apps.includes(app)) return { error: 'playground_no_app', app };
  if (PLAYGROUND_EDIT_TOOLS.has(name) && !caller.canEdit) return { error: 'playground_no_access' };
  return null;
}

/** En el playground, ¿puede quien prueba leer datos reales de esta app? Fuera del playground: sí. */
export async function playgroundCanRead(ctx: AgentRunContext, app: string | null): Promise<boolean> {
  if (ctx.channel !== 'playground') return true;
  const caller = await playgroundAccess(ctx);
  if (!caller || !caller.canEdit) return false;
  return app === null || caller.apps === '*' || caller.apps.includes(app);
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
          "Search this business's knowledge base (docs pages, saved web pages, files, Q&A pairs and canned answers). Returns the most relevant passages, each with a ref number to cite. Use it before answering questions about the business.",
        inputSchema: z.object({ query: z.string().trim().min(2).max(300).describe('What to look for, in a few keywords') }),
        execute: logged(ctx, 'search_knowledge', async ({ query }: { query: string }) => {
          const { agentsAiFakeActive } = await import('./agents-ai');
          const results = await searchAgentKnowledge(agent, workspaceId, query, 5, { fakeEmbeddings: await agentsAiFakeActive() });
          ctx.citations ??= new Map();
          ctx.searches ??= { calls: 0, empty: 0 };
          ctx.searches.calls++;
          if (results.length === 0) ctx.searches.empty++;
          const out = results.map((r) => {
            // El mismo pasaje en dos búsquedas conserva su número.
            let ref = [...ctx.citations!.entries()].find(([, c]) => c.title === r.title && c.url === (r.source ?? null))?.[0];
            if (ref === undefined) {
              ref = ctx.citations!.size + 1;
              ctx.citations!.set(ref, { title: r.title, url: r.source ?? null, kind: r.kind });
            }
            return { ref, title: r.title, kind: r.kind, source: r.source ?? null, text: r.text };
          });
          return {
            results: out,
            ...(results.length === 0 ? { note: 'no relevant knowledge found' } : {}),
          };
        }),
      }),
    );
  }

  // Docs: páginas que el dueño le dio al agente (tools.docsPageIds) y sus subpáginas,
  // con el acceso de quien le habla si está identificado (ver docsActorOf).
  const docsActor = docsActorOf(ctx.channel, ctx.conversation.created_by, cfg);
  if (cfg.docsPageIds.length && on.has('docs_read_pages')) {
    add(
      'docs_read_pages',
      tool({
        description:
          'Work with the Docs pages this agent was given. With pageId: read that page (Markdown, its databases with rows, and subpages). With query: search those pages. With neither: list them.',
        inputSchema: z.object({
          pageId: z.string().trim().max(100).optional(),
          query: z.string().trim().max(300).optional(),
        }),
        execute: logged(ctx, 'docs_read_pages', async (input: { pageId?: string; query?: string }) => {
          const { readDocsForAgent } = await import('./agent-docs-tools');
          return readDocsForAgent(workspaceId, cfg.docsPageIds, input, docsActor);
        }),
      }),
    );
  }

  if (cfg.docsPageIds.length && on.has('docs_write_page')) {
    add(
      'docs_write_page',
      tool({
        description:
          'Write in the Docs pages this agent was given: create a subpage (operation create, parentId optional), add Markdown at the end of a page (append), replace its content (replace) or rename it (rename). Read the page first.',
        inputSchema: z.object({
          operation: z.enum(['create', 'append', 'replace', 'rename']),
          pageId: z.string().trim().max(100).optional(),
          parentId: z.string().trim().max(100).optional(),
          title: z.string().trim().max(300).optional(),
          markdown: z.string().max(40_000).optional(),
        }),
        execute: logged(ctx, 'docs_write_page', async (input: DocsPageWriteInput) => {
          const { checkPageWrite } = await import('./agent-docs-tools');
          const bad = await checkPageWrite(workspaceId, cfg.docsPageIds, input, docsActor);
          if (bad) return bad;
          if (ctx.dryRun) return simulated({ action: `docs_${input.operation}`, pageId: input.pageId ?? input.parentId ?? null, title: input.title ?? null });
          return (await queueIfRequired(ctx, 'docs_write_page', { ...input })) ?? performAgentAction(actionContext(ctx), 'docs_write_page', { ...input }, docsActor);
        }),
      }),
    );
  }

  if (cfg.docsPageIds.length && on.has('docs_write_row')) {
    add(
      'docs_write_row',
      tool({
        description:
          'Add a row to a database on one of the Docs pages this agent was given, or update a row (rowId). properties maps property names to values (select options by name, people by email, dates as YYYY-MM-DD). Read the page first to see the databases and their properties.',
        inputSchema: z.object({
          pageId: z.string().trim().max(100),
          blockId: z.string().trim().max(100).describe('Database block id from docs_read_pages'),
          rowId: z.string().trim().max(100).optional(),
          title: z.string().trim().max(2000).optional(),
          properties: z.record(z.string().max(5000)).optional(),
          markdown: z.string().max(20_000).optional(),
        }),
        execute: logged(ctx, 'docs_write_row', async (input: DocsRowWriteInput) => {
          const { checkRowWrite } = await import('./agent-docs-tools');
          const bad = await checkRowWrite(workspaceId, cfg.docsPageIds, input, docsActor);
          if (bad) return bad;
          if (ctx.dryRun) return simulated({ action: input.rowId ? 'docs_update_row' : 'docs_add_row', pageId: input.pageId, title: input.title ?? null, properties: input.properties ?? {} });
          return (await queueIfRequired(ctx, 'docs_write_row', { ...input })) ?? performAgentAction(actionContext(ctx), 'docs_write_row', { ...input }, docsActor);
        }),
      }),
    );
  }

  if (on.has('crm_find_contact')) {
    add(
      'crm_find_contact',
      tool({
        description:
          "Look up the visitor in the CRM by their email. Only works when the visitor's identity is verified (or in the playground); otherwise it returns identity_not_verified and you should not claim to know who they are.",
        inputSchema: z.object({ email: z.string().trim().max(200) }),
        execute: logged(ctx, 'crm_find_contact', async ({ email }: { email: string }) => {
          if (!EMAIL_RE.test(email)) return { error: 'invalid_email' };
          // Solo el email que el propio visitante escribió: evita usar al agente
          // para averiguar si un email cualquiera está en el CRM.
          if (!visitorGaveEmail(ctx, email)) return { error: 'email_not_given_by_visitor' };
          // Playground: solo quien edita el agente y tiene el CRM, y solo su propio email.
          if (!(await playgroundCanRead(ctx, 'crm'))) return { error: 'playground_no_access' };
          // Un email escrito en el chat lo puede tipear cualquiera: los datos del
          // contacto (o si existe) solo con la identidad verificada y el mismo email.
          const own = ctx.channel === 'playground' ? ((await playgroundAccess(ctx))?.email ?? null) : ctx.identifiedEmail ?? null;
          const verified = (own ?? '').trim().toLowerCase() === email.trim().toLowerCase();
          if (!verified) return { error: 'identity_not_verified' };
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
          // Simular dice si el contacto existe: en el playground, solo con acceso al CRM.
          if (!(await playgroundCanRead(ctx, 'crm'))) return { error: 'playground_no_access' };
          if (ctx.dryRun) {
            const existing = await findContact(workspaceId, input.email);
            return simulated({
              action: existing ? 'update_contact' : 'create_contact',
              email: input.email,
              name: input.name ?? null,
              note: input.note ?? null,
            });
          }
          // ¿El email es el del visitante identificado (o el propio en el playground)? Lo decide el servidor, no el modelo.
          const own = ctx.channel === 'playground' ? ((await playgroundAccess(ctx))?.email ?? null) : ctx.identifiedEmail ?? null;
          const action = { email: input.email, name: input.name, note: input.note, emailVerified: (own ?? '').trim().toLowerCase() === input.email.trim().toLowerCase() };
          return (await queueIfRequired(ctx, 'crm_upsert_contact', action)) ?? performAgentAction(actionContext(ctx), 'crm_upsert_contact', action);
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
          if (!(await playgroundCanRead(ctx, 'crm'))) return { error: 'playground_no_access' };
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
            // Un robot que usó un login o una sesión guardada (captured_by) trae
            // datos de la persona que lo armó: no se devuelven a la conversación.
            if (run.capturedBy) {
              return {
                runId: run.id,
                status: run.status,
                ...(run.error ? { error: run.error } : {}),
                warnings: run.warnings,
                note: 'robot_uses_login: its data is private and is not shared into this conversation',
              };
            }
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

  // ---------- Botones y formularios en el chat ----------
  if (on.has('show_buttons')) {
    add(
      'show_buttons',
      tool({
        description:
          'Show 2 to 6 quick-reply buttons under your reply (short labels). The visitor taps one to answer. Use it for clear choices (topics, yes or no, plans). Still write the question itself in your reply.',
        inputSchema: z.object({ options: z.array(z.string().trim().min(1).max(80)).min(2).max(6) }),
        execute: logged(ctx, 'show_buttons', async ({ options }: { options: string[] }) => {
          const ui = buttonsUi(options);
          if (!ui || ui.kind !== 'buttons' || ui.options.length < 2) return { error: 'invalid_options' };
          ctx.ui = ui;
          return { shown: true, options: ui.options };
        }),
      }),
    );
  }
  const forms = agent.settings.forms ?? [];
  if (on.has('show_form') && forms.length) {
    const ids = forms.map((f) => f.id) as [string, ...string[]];
    add(
      'show_form',
      tool({
        description: `Show one of these forms inside the chat so the visitor fills it in. Their answers come back as their next message. Use it instead of asking for the same data in text:\n${forms
          .map((f) => `- ${f.id}: ${f.name} (${f.fields.map((x) => x.label).join(', ')})`)
          .join('\n')}`,
        inputSchema: z.object({ formId: z.enum(ids) }),
        execute: logged(ctx, 'show_form', async ({ formId }: { formId: string }) => {
          const form = forms.find((f) => f.id === formId);
          if (!form) return { error: 'form_not_found' };
          ctx.ui = formUi(form);
          return { shown: true, form: form.name, note: 'Tell the visitor to fill in the form below the message, in one short sentence.' };
        }),
      }),
    );
  }

  // ---------- Procedimientos ----------
  const procedures = agent.settings.procedures ?? [];
  if (procedures.length) {
    const ids = procedures.map((p) => p.id) as [string, ...string[]];
    tools.start_procedure = tool({
      description: `Start a step-by-step procedure when the visitor's request clearly matches one. The procedure then writes the next messages itself, so do not write anything else in this reply:\n${procedures
        .map((p) => `- ${p.id}: ${p.name}${p.trigger ? ` (use when: ${p.trigger})` : ''}`)
        .join('\n')}`,
      inputSchema: z.object({ procedureId: z.enum(ids) }),
      execute: logged(ctx, 'start_procedure', async ({ procedureId }: { procedureId: string }) => {
        if (!procedures.some((p) => p.id === procedureId)) return { error: 'procedure_not_found' };
        ctx.procedureStart = procedureId;
        return { started: true, note: 'The procedure takes over from here. Do not write a reply.' };
      }),
    });
  }

  // ---------- Código propio ----------
  const fns = cfg.codeFunctions ?? [];
  if (on.has('run_code') && fns.length) {
    const names = fns.map((f) => f.name) as [string, ...string[]];
    add(
      'run_code',
      tool({
        description: `Run one of these functions written by the business (calculations, formatting, rules). Pass the parameters it declares:\n${fns
          .map((f) => `- ${f.name}(${f.params.map((p) => `${p.name}: ${p.type}`).join(', ')})${f.description ? `: ${f.description}` : ''}`)
          .join('\n')}`,
        inputSchema: z.object({
          function: z.enum(names),
          input: z.record(z.string(), z.unknown()).optional().describe('Parameters by name'),
        }),
        execute: logged(ctx, 'run_code', async ({ function: name, input }: { function: string; input?: Record<string, unknown> }) => {
          const fn = fns.find((f) => f.name === name);
          if (!fn) return { error: 'function_not_found' };
          // Sin red y sin efectos fuera de la VM: corre igual en el playground.
          // Desde los canales de visitantes, tope diario por workspace (cada corrida es una VM).
          if (ctx.channel !== 'playground' && process.env.RATE_LIMIT_DISABLED !== 'true') {
            const { rateLimit } = await import('./rate-limit');
            const limit = Number(process.env.AGENT_CODE_DAILY_LIMIT) > 0 ? Math.floor(Number(process.env.AGENT_CODE_DAILY_LIMIT)) : 500;
            if (!(await rateLimit(`agent-code:${workspaceId}`, limit, 86_400)).ok) return { error: 'code_quota' };
          }
          const { runAgentCode } = await import('./agents-code');
          return runAgentCode(fn, input ?? {});
        }),
      }),
    );
  }

  // ---------- Stripe y Shopify (solo lectura, con las credenciales del dueño) ----------
  const stripeKey = ctx.integrations?.stripeKey ?? '';
  if (on.has('stripe_customer') && stripeKey) {
    add(
      'stripe_customer',
      tool({
        description:
          "Look up the visitor's billing in Stripe by their email: subscription status, plan, renewal date and recent invoices (with links). Only works when the visitor's identity is verified (or in the playground).",
        inputSchema: z.object({ email: z.string().trim().max(200) }),
        execute: logged(ctx, 'stripe_customer', async ({ email }: { email: string }) => {
          if (!EMAIL_RE.test(email)) return { error: 'invalid_email' };
          if (!visitorGaveEmail(ctx, email)) return { error: 'email_not_given_by_visitor' };
          // Datos de facturación: solo con la identidad verificada (firma del widget o la API).
          // En el playground, la identidad es el email propio de quien prueba.
          const own = ctx.channel === 'playground' ? ((await playgroundAccess(ctx))?.email ?? null) : ctx.identifiedEmail ?? null;
          const verified = (own ?? '').trim().toLowerCase() === email.trim().toLowerCase();
          if (!verified) return { error: 'identity_not_verified' };
          const { stripeCustomerSummary } = await import('./agents-integrations');
          return stripeCustomerSummary(stripeKey, email.trim().toLowerCase());
        }),
      }),
    );
  }
  const shop = ctx.integrations?.shopify ?? null;
  if (on.has('shopify_order') && shop) {
    add(
      'shopify_order',
      tool({
        description:
          'Check the status of a Shopify order with its order number and the email used to buy (both must match): payment, fulfillment and tracking links.',
        inputSchema: z.object({ orderNumber: z.string().trim().min(1).max(30), email: z.string().trim().max(200) }),
        execute: logged(ctx, 'shopify_order', async ({ orderNumber, email }: { orderNumber: string; email: string }) => {
          if (!EMAIL_RE.test(email)) return { error: 'invalid_email' };
          if (!visitorGaveEmail(ctx, email)) return { error: 'email_not_given_by_visitor' };
          // Playground: solo con el email propio de quien prueba.
          if (ctx.channel === 'playground' && ((await playgroundAccess(ctx))?.email ?? '') !== email.trim().toLowerCase()) return { error: 'identity_not_verified' };
          // Tope de intentos por conversación: número y email no se adivinan probando.
          const tries = (await getDb()
            .prepare("SELECT COUNT(*) AS c FROM agent_tool_calls WHERE conversation_id = ? AND tool = 'shopify_order'")
            .get(ctx.conversation.id)) as { c: number };
          if (Number(tries.c) >= SHOPIFY_MAX_TRIES) return { error: 'too_many_attempts' };
          const { shopifyOrderStatus } = await import('./agents-integrations');
          return shopifyOrderStatus(shop.shop, shop.token, orderNumber, email.trim().toLowerCase());
        }),
      }),
    );
  }
  if (on.has('shopify_products') && shop) {
    add(
      'shopify_products',
      tool({
        description: 'Search the active products of the Shopify store by name: title, price, availability and link.',
        inputSchema: z.object({ query: z.string().trim().min(2).max(100) }),
        execute: logged(ctx, 'shopify_products', async ({ query }: { query: string }) => {
          const { shopifyProductSearch } = await import('./agents-integrations');
          return shopifyProductSearch(shop.shop, shop.token, query);
        }),
      }),
    );
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
          // Playground: el GET real (con los headers secretos) solo para quien edita el agente.
          if (!(await playgroundCanRead(ctx, null))) return { error: 'playground_no_access' };
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

  if (on.has('mcp_call') && ctx.mcpServers) {
    const { mcpModelTools, mcpToolIsReadOnly } = await import('./agents-mcp');
    const servers = { mcp_servers: ctx.mcpServers };
    const run = logged(ctx, 'mcp_call', async (input: Record<string, unknown>) => {
      const readOnly = mcpToolIsReadOnly(servers, String(input.serverId ?? ''), String(input.tool ?? ''));
      // Playground: las lecturas reales de un servidor MCP solo para quien edita el agente.
      if (!(await playgroundCanRead(ctx, null))) return { error: 'playground_no_access' };
      // Una herramienta que cambia datos no corre en simulación.
      if (ctx.dryRun && !readOnly) return simulated({ action: 'mcp_call', server: input.server, tool: input.tool, arguments: input.arguments ?? {} });
      // Fuera del playground, las que escriben siempre esperan a un admin (como Docs).
      const queued = ctx.dryRun ? null : await queueIfRequired(ctx, 'mcp_call', input, !readOnly && ctx.channel !== 'playground');
      return queued ?? performAgentAction(actionContext(ctx), 'mcp_call', input);
    });
    const mcp = mcpModelTools(servers, (input) => run(input));
    if (Object.keys(mcp).length) {
      Object.assign(tools, mcp);
      enabled.push('mcp_call');
    }
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
  /** Persona que inició la conversación (si está identificada): con su acceso trabaja en Docs. */
  conversationCreatedBy?: string | null;
  /** agents.mcp_servers actual (se revalida el servidor y la herramienta al correr). */
  mcpServers?: string;
}

function actionContext(ctx: AgentRunContext): AgentActionContext {
  return {
    agent: ctx.agent,
    workspaceId: ctx.workspaceId,
    conversationId: ctx.conversation.id,
    channel: ctx.channel,
    secretHeaders: ctx.secretHeaders ?? [],
    conversationCreatedBy: ctx.conversation.created_by ?? null,
    mcpServers: ctx.mcpServers,
  };
}

/** Si la herramienta pide aprobación, la encola y devuelve lo que el modelo le dice al visitante. */
async function queueIfRequired(ctx: AgentRunContext, tool: ApprovableAgentTool, input: Record<string, unknown>, force = false): Promise<ToolOutput | null> {
  // Escribir en Docs sin una persona identificada (Chat, página pública, API, Groups, Flow) siempre espera aprobación.
  const forced = force || ((tool === 'docs_write_page' || tool === 'docs_write_row') && ctx.channel !== 'playground');
  if (ctx.dryRun || (!forced && !(ctx.agent.tools.requireApproval ?? []).includes(tool))) return null;
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
export async function performAgentAction(actx: AgentActionContext, tool: ApprovableAgentTool, input: ActionInput, docsActorOverride?: string | null): Promise<ToolOutput> {
  const { agent, workspaceId } = actx;
  const cfg = agent.tools;
  // Docs: con el acceso de quien le habla (si está identificado) o de quien configuró el agente; nunca el del dueño.
  const docsActor = docsActorOverride !== undefined ? docsActorOverride : docsActorOf(actx.channel, actx.conversationCreatedBy, cfg);
  switch (tool) {
    case 'crm_upsert_contact': {
      const { findOrCreateContact } = await import('./crm-integrations');
      const { createActivity, updateContact } = await import('./crm');
      const name = str(input.name) || null;
      const note = str(input.note);
      // Un contacto que ya existía y un email que cualquiera pudo escribir: no se
      // toca ni se anota; queda una nota suelta (como los formularios).
      if (input.emailVerified !== true) {
        const existing = await findContact(workspaceId, str(input.email));
        if (existing) {
          if (note) await createActivity(workspaceId, { type: 'note', subject: `Agent: ${agent.name} (${str(input.email)}, unverified)`, body: note });
          return { existing: true, verified: false, noteLogged: Boolean(note) };
        }
      }
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
    case 'docs_write_page': {
      const { writePageForAgent } = await import('./agent-docs-tools');
      const op = (['create', 'append', 'replace', 'rename'] as const).find((o) => o === input.operation) ?? 'append';
      return writePageForAgent(
        workspaceId,
        cfg.docsPageIds,
        { operation: op, pageId: str(input.pageId) || undefined, parentId: str(input.parentId) || undefined, title: str(input.title) || undefined, markdown: str(input.markdown) || undefined },
        agent.name,
        docsActor,
      );
    }
    case 'docs_write_row': {
      const { writeRowForAgent } = await import('./agent-docs-tools');
      const props = input.properties && typeof input.properties === 'object' ? (input.properties as Record<string, string>) : undefined;
      return writeRowForAgent(workspaceId, cfg.docsPageIds, {
        pageId: str(input.pageId),
        blockId: str(input.blockId),
        rowId: str(input.rowId) || undefined,
        title: str(input.title) || undefined,
        properties: props,
        markdown: str(input.markdown) || undefined,
      }, docsActor);
    }
    case 'mcp_call': {
      const { performMcpCall } = await import('./agents-mcp');
      return performMcpCall({ mcp_servers: actx.mcpServers ?? '[]' }, input);
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
        const text = redactText((await res.text().catch(() => '')).slice(0, 200_000), allSecretVariants(secrets.map((h) => h.value))).slice(0, 4000);
        return { status: res.status, ok: res.ok, body: text };
      } catch (err) {
        if (err instanceof UnsafeUrlError) return { error: err.message };
        return { error: err instanceof Error && err.name === 'TimeoutError' ? 'timeout' : 'network_error' };
      }
    }
  }
}
