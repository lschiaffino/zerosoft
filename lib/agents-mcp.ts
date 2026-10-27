/**
 * Agents — conexiones a servidores MCP (Model Context Protocol) por HTTP
 * ("streamable HTTP", la versión remota del protocolo). Cliente propio y
 * mínimo sobre safeFetch (sin SSRF, sin redirecciones a la red privada):
 * initialize → notifications/initialized → tools/list | tools/call, con la
 * respuesta en JSON o en SSE y la sesión (Mcp-Session-Id) que dé el servidor.
 *
 * Seguridad:
 * - El header de autenticación se guarda cifrado (secret-box) y nunca vuelve
 *   a la UI, al modelo ni al registro de herramientas.
 * - Cada servidor guarda la lista de sus herramientas al conectarlo; el dueño
 *   elige cuáles puede usar el agente. Las que el servidor no marca como solo
 *   lectura (annotations.readOnlyHint) se simulan en el playground y, en los
 *   canales con visitantes, siempre esperan la aprobación de un admin
 *   (lib/agents-approvals.ts), como las escrituras en Docs.
 * - Al aprobar se revalida contra la configuración actual: un servidor o una
 *   herramienta que se sacó ya no corre.
 * Server-only.
 */
import { jsonSchema, tool, type Tool } from 'ai';
import { getDb } from './db';
import type { AgentRow } from './db';
import { readTextCapped, safeFetch, UnsafeUrlError } from './safe-fetch';
import { redactDeep, secretVariants } from './agents-secrets';
import { open as openSecret, seal } from './secret-box';

export const AGENT_MAX_MCP_SERVERS = 5;
const MAX_TOOLS_PER_SERVER = 50;
const MCP_TIMEOUT_MS = 15_000;
const MCP_PROTOCOL = '2025-06-18';
const MAX_RESPONSE = 2_000_000;

export interface McpToolInfo {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  readOnly: boolean;
}

interface StoredServer {
  id: string;
  name: string;
  url: string;
  headerName: string;
  /** Valor del header cifrado con secret-box ('' = sin auth). */
  headerValue: string;
  tools: McpToolInfo[];
  /** Herramientas que el agente puede usar (por nombre). */
  allowed: string[];
  status: 'ok' | 'error';
  error: string | null;
  refreshedAt: string;
  addedBy: string | null;
}

/** Lo que ve la UI: nunca el valor del header. */
export interface AgentMcpServerDto {
  id: string;
  name: string;
  url: string;
  headerName: string;
  hasAuth: boolean;
  tools: McpToolInfo[];
  allowed: string[];
  status: 'ok' | 'error';
  error: string | null;
  refreshedAt: string;
}

export class McpError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

function parseServers(raw: string | null | undefined): StoredServer[] {
  try {
    const v = JSON.parse(raw || '[]') as unknown;
    return Array.isArray(v) ? (v as StoredServer[]).filter((s) => s && typeof s.id === 'string' && typeof s.url === 'string') : [];
  } catch {
    return [];
  }
}

function toDto(s: StoredServer): AgentMcpServerDto {
  return {
    id: s.id,
    name: s.name,
    url: s.url,
    headerName: s.headerName,
    hasAuth: Boolean(s.headerValue),
    tools: s.tools,
    allowed: s.allowed,
    status: s.status,
    error: s.error,
    refreshedAt: s.refreshedAt,
  };
}

export function listMcpServers(row: Pick<AgentRow, 'mcp_servers'>): AgentMcpServerDto[] {
  return parseServers(row.mcp_servers).map(toDto);
}

// ---------- Cliente ----------

interface McpConnection {
  url: string;
  headers: Record<string, string>;
  session: string | null;
  nextId: number;
}

/** Saca el mensaje JSON-RPC con `id` de una respuesta JSON o SSE. Exportada para tests. */
export function readJsonRpc(body: string, contentType: string, id: number): { result?: unknown; error?: { code?: number; message?: string } } | null {
  const candidates: unknown[] = [];
  if (/text\/event-stream/i.test(contentType)) {
    for (const event of body.split(/\r?\n\r?\n/)) {
      const data = event
        .split(/\r?\n/)
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trimStart())
        .join('\n');
      if (!data) continue;
      try {
        candidates.push(JSON.parse(data));
      } catch {
        /* evento que no es JSON */
      }
    }
  } else {
    try {
      candidates.push(JSON.parse(body));
    } catch {
      return null;
    }
  }
  for (const c of candidates.flatMap((x) => (Array.isArray(x) ? x : [x]))) {
    const msg = c as { id?: unknown; result?: unknown; error?: { code?: number; message?: string } };
    if (msg && typeof msg === 'object' && msg.id === id) return { result: msg.result, error: msg.error };
  }
  return null;
}

async function post(conn: McpConnection, message: Record<string, unknown>): Promise<Response> {
  const headers: Record<string, string> = {
    ...conn.headers,
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    'user-agent': 'Zerosoft-Agents/1',
    'mcp-protocol-version': MCP_PROTOCOL,
  };
  if (conn.session) headers['mcp-session-id'] = conn.session;
  try {
    return await safeFetch(conn.url, { method: 'POST', headers, body: JSON.stringify(message) }, MCP_TIMEOUT_MS);
  } catch (err) {
    // URL interna, sin https o que no resuelve: el detalle no se muestra (es del servidor).
    if (err instanceof UnsafeUrlError) throw new McpError('mcp_blocked_url');
    throw new McpError(err instanceof Error && err.name === 'TimeoutError' ? 'mcp_timeout' : 'mcp_unreachable');
  }
}

async function request(conn: McpConnection, method: string, params: Record<string, unknown>): Promise<unknown> {
  const id = conn.nextId++;
  const res = await post(conn, { jsonrpc: '2.0', id, method, params });
  if (res.status === 401 || res.status === 403) throw new McpError('mcp_unauthorized');
  if (!res.ok) throw new McpError('mcp_http_error');
  const session = res.headers.get('mcp-session-id');
  if (session) conn.session = session.slice(0, 200);
  // Tope leyendo en streaming: un servidor no puede mandar un cuerpo infinito.
  const body = await readTextCapped(res, MAX_RESPONSE);
  const msg = readJsonRpc(body, res.headers.get('content-type') ?? '', id);
  if (!msg) throw new McpError('mcp_bad_response');
  if (msg.error) throw new McpError('mcp_error');
  return msg.result;
}

async function connect(server: Pick<StoredServer, 'url' | 'headerName' | 'headerValue'>): Promise<McpConnection> {
  const headers: Record<string, string> = {};
  const value = openSecret(server.headerValue);
  if (server.headerName && value) headers[server.headerName] = value;
  const conn: McpConnection = { url: server.url, headers, session: null, nextId: 1 };
  await request(conn, 'initialize', {
    protocolVersion: MCP_PROTOCOL,
    capabilities: {},
    clientInfo: { name: 'zerosoft-agents', version: '1.0.0' },
  });
  // Aviso de que el cliente terminó de inicializar (sin respuesta: 202).
  await post(conn, { jsonrpc: '2.0', method: 'notifications/initialized' }).catch(() => null);
  return conn;
}

/** Herramientas que ofrece el servidor (con paginación). */
export async function fetchMcpTools(server: Pick<StoredServer, 'url' | 'headerName' | 'headerValue'>): Promise<McpToolInfo[]> {
  const conn = await connect(server);
  const out: McpToolInfo[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 5 && out.length < MAX_TOOLS_PER_SERVER; page++) {
    const result = (await request(conn, 'tools/list', cursor ? { cursor } : {})) as {
      tools?: Array<{ name?: unknown; description?: unknown; inputSchema?: unknown; annotations?: { readOnlyHint?: unknown } }>;
      nextCursor?: unknown;
    };
    for (const t of result?.tools ?? []) {
      if (typeof t.name !== 'string' || !/^[A-Za-z0-9_.-]{1,64}$/.test(t.name)) continue;
      const schema = t.inputSchema && typeof t.inputSchema === 'object' ? (t.inputSchema as Record<string, unknown>) : { type: 'object' };
      out.push({
        name: t.name,
        description: typeof t.description === 'string' ? t.description.slice(0, 1000) : '',
        // Un schema enorme no entra al prompt: queda como objeto libre.
        inputSchema: JSON.stringify(schema).length > 20_000 ? { type: 'object' } : schema,
        readOnly: t.annotations?.readOnlyHint === true,
      });
      if (out.length >= MAX_TOOLS_PER_SERVER) break;
    }
    cursor = typeof result?.nextCursor === 'string' ? result.nextCursor : undefined;
    if (!cursor) break;
  }
  return out;
}

/** Llama una herramienta. Devuelve el texto (acotado) y si el servidor la marcó como error. */
export async function callMcpTool(
  server: Pick<StoredServer, 'url' | 'headerName' | 'headerValue'>,
  name: string,
  args: Record<string, unknown>,
): Promise<{ isError: boolean; content: string; structured: unknown }> {
  const conn = await connect(server);
  const result = (await request(conn, 'tools/call', { name, arguments: args })) as {
    content?: Array<{ type?: string; text?: unknown; resource?: { text?: unknown; uri?: unknown } }>;
    structuredContent?: unknown;
    isError?: unknown;
  };
  const secrets = secretVariants(openSecret(server.headerValue));
  const parts = (result?.content ?? []).map((c) => {
    if (c.type === 'text' && typeof c.text === 'string') return c.text;
    if (c.type === 'resource' && typeof c.resource?.text === 'string') return c.resource.text;
    if (c.type === 'resource_link' || c.type === 'resource') return `[resource ${String(c.resource?.uri ?? '')}]`;
    return c.type ? `[${c.type}]` : '';
  });
  // Un servidor que devuelve el token (eco, errores) no se lo pasa al modelo:
  // se tapa el valor y sus partes, en el texto y en el contenido estructurado.
  const content = redactDeep(parts.filter(Boolean).join('\n'), secrets).slice(0, 6000);
  const structured = redactDeep(result?.structuredContent ?? null, secrets);
  return { isError: result?.isError === true, content, structured };
}

// ---------- Configuración ----------

async function saveServers(workspaceId: string, agentId: string, list: StoredServer[]): Promise<AgentMcpServerDto[]> {
  await getDb()
    .prepare('UPDATE agents SET mcp_servers = ?, updated_at = ? WHERE id = ? AND user_id = ?')
    .run(JSON.stringify(list), new Date().toISOString(), agentId, workspaceId);
  return list.map(toDto);
}

const HEADER_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/;
/** Headers que maneja el cliente (o fetch): no se pueden pisar con el de autenticación. */
const RESERVED_HEADERS = new Set([
  'host',
  'content-length',
  'content-type',
  'accept',
  'cookie',
  'connection',
  'transfer-encoding',
  'user-agent',
  'mcp-session-id',
  'mcp-protocol-version',
  'expect',
  'te',
  'upgrade',
]);

function validHeaderName(name: string): boolean {
  return HEADER_RE.test(name) && !RESERVED_HEADERS.has(name.toLowerCase());
}

/** Valores secretos de los servidores MCP del agente (para taparlos en registros y respuestas). */
export function mcpSecretValues(row: Pick<AgentRow, 'mcp_servers'>): string[] {
  return parseServers(row.mcp_servers)
    .map((s) => openSecret(s.headerValue))
    .filter(Boolean);
}

export async function addMcpServer(
  row: AgentRow,
  input: { name: string; url: string; headerName?: string; headerValue?: string },
  personId: string | null,
): Promise<AgentMcpServerDto[]> {
  const list = parseServers(row.mcp_servers);
  if (list.length >= AGENT_MAX_MCP_SERVERS) throw new McpError('too_many_mcp_servers');
  let url: URL;
  try {
    url = new URL(input.url.trim());
  } catch {
    throw new McpError('invalid_url');
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && process.env.ALLOW_PRIVATE_WEBHOOKS === 'true')) throw new McpError('invalid_url');
  if (list.some((s) => s.url === url.toString())) throw new McpError('mcp_duplicate');
  const headerName = (input.headerName ?? '').trim() || (input.headerValue ? 'Authorization' : '');
  if (headerName && !validHeaderName(headerName)) throw new McpError('invalid_header');
  if (input.headerValue && /[\r\n]/.test(input.headerValue)) throw new McpError('invalid_header');
  const server: StoredServer = {
    id: crypto.randomUUID(),
    name: input.name.trim().slice(0, 60) || url.hostname,
    url: url.toString(),
    headerName,
    headerValue: input.headerValue ? seal(input.headerValue.slice(0, 4000)) : '',
    tools: [],
    allowed: [],
    status: 'ok',
    error: null,
    refreshedAt: new Date().toISOString(),
    addedBy: personId,
  };
  // Si no conecta no se guarda: el error vuelve a la UI.
  server.tools = await fetchMcpTools(server);
  server.allowed = server.tools.map((t) => t.name);
  const out = await saveServers(row.user_id, row.id, [...list, server]);
  const { recordAgentChange } = await import('./agents');
  await recordAgentChange(row.user_id, row.id, personId, 'mcp_changed', { action: 'add', server: server.name });
  return out;
}

export async function updateMcpServer(
  row: AgentRow,
  serverId: string,
  input: { name?: string; allowed?: string[]; refresh?: boolean; headerValue?: string | null },
  personId: string | null,
): Promise<AgentMcpServerDto[] | null> {
  const list = parseServers(row.mcp_servers);
  const server = list.find((s) => s.id === serverId);
  if (!server) return null;
  if (input.name !== undefined) server.name = input.name.trim().slice(0, 60) || server.name;
  if (input.headerValue !== undefined) {
    if (input.headerValue && /[\r\n]/.test(input.headerValue)) throw new McpError('invalid_header');
    server.headerValue = input.headerValue ? seal(input.headerValue.slice(0, 4000)) : '';
    if (input.headerValue && !server.headerName) server.headerName = 'Authorization';
  }
  if (input.refresh || input.headerValue !== undefined) {
    try {
      const tools = await fetchMcpTools(server);
      // Las herramientas nuevas entran apagadas: el dueño decide si el agente las usa.
      server.allowed = server.allowed.filter((n) => tools.some((t) => t.name === n));
      server.tools = tools;
      server.status = 'ok';
      server.error = null;
    } catch (err) {
      server.status = 'error';
      server.error = err instanceof McpError ? err.code : 'mcp_unreachable';
    }
    server.refreshedAt = new Date().toISOString();
  }
  if (input.allowed !== undefined) {
    const names = new Set(server.tools.map((t) => t.name));
    server.allowed = [...new Set(input.allowed)].filter((n) => names.has(n));
  }
  const out = await saveServers(row.user_id, row.id, list);
  const { recordAgentChange } = await import('./agents');
  await recordAgentChange(row.user_id, row.id, personId, 'mcp_changed', { action: 'edit', server: server.name });
  return out;
}

export async function removeMcpServer(row: AgentRow, serverId: string, personId: string | null): Promise<AgentMcpServerDto[] | null> {
  const list = parseServers(row.mcp_servers);
  const server = list.find((s) => s.id === serverId);
  if (!server) return null;
  const out = await saveServers(row.user_id, row.id, list.filter((s) => s.id !== serverId));
  const { recordAgentChange } = await import('./agents');
  await recordAgentChange(row.user_id, row.id, personId, 'mcp_changed', { action: 'remove', server: server.name });
  return out;
}

// ---------- Herramientas para el modelo ----------

function slug(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 20) || 'server';
}

/** Nombre de la herramienta para el modelo: mcp_<servidor>_<herramienta> (≤ 64). */
export function mcpToolKey(serverName: string, toolName: string): string {
  return `mcp_${slug(serverName)}_${toolName.replace(/[^A-Za-z0-9_-]/g, '_')}`.slice(0, 64);
}

export interface McpCallInput extends Record<string, unknown> {
  serverId: string;
  server: string;
  tool: string;
  arguments: Record<string, unknown>;
}

/**
 * Herramientas MCP habilitadas del agente. `run` recibe lo que se registra
 * (servidor, herramienta y argumentos) y decide si corre, se simula o espera
 * aprobación (lib/agent-tools.ts).
 */
export function mcpModelTools(
  row: Pick<AgentRow, 'mcp_servers'>,
  run: (input: McpCallInput, readOnly: boolean) => Promise<Record<string, unknown>>,
): Record<string, Tool> {
  const tools: Record<string, Tool> = {};
  for (const s of parseServers(row.mcp_servers)) {
    if (s.status !== 'ok') continue;
    for (const t of s.tools) {
      if (!s.allowed.includes(t.name)) continue;
      const key = mcpToolKey(s.name, t.name);
      if (tools[key]) continue;
      const schema = { type: 'object', ...t.inputSchema } as Record<string, unknown>;
      tools[key] = tool({
        description: `[${s.name}] ${t.description || t.name}${t.readOnly ? '' : ' (this action changes data)'}`.slice(0, 1024),
        inputSchema: jsonSchema(schema as Parameters<typeof jsonSchema>[0]),
        execute: async (args: unknown) =>
          run({ serverId: s.id, server: s.name, tool: t.name, arguments: (args && typeof args === 'object' ? args : {}) as Record<string, unknown> }, t.readOnly),
      });
    }
  }
  return tools;
}

/** Corre una llamada MCP revalidando contra la configuración actual del agente. */
export async function performMcpCall(row: Pick<AgentRow, 'mcp_servers'>, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const server = parseServers(row.mcp_servers).find((s) => s.id === input.serverId);
  const name = typeof input.tool === 'string' ? input.tool : '';
  if (!server || !server.allowed.includes(name) || !server.tools.some((t) => t.name === name)) return { error: 'mcp_tool_not_allowed' };
  const args = input.arguments && typeof input.arguments === 'object' ? (input.arguments as Record<string, unknown>) : {};
  try {
    const res = await callMcpTool(server, name, args);
    return res.isError ? { error: 'mcp_tool_error', content: res.content } : { content: res.content, ...(res.structured ? { structured: res.structured } : {}) };
  } catch (err) {
    return { error: err instanceof McpError ? err.code : 'mcp_unreachable' };
  }
}

export function mcpToolIsReadOnly(row: Pick<AgentRow, 'mcp_servers'>, serverId: string, toolName: string): boolean {
  const s = parseServers(row.mcp_servers).find((x) => x.id === serverId);
  return Boolean(s?.tools.find((t) => t.name === toolName)?.readOnly);
}
