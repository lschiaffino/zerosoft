/**
 * Track — servidor MCP (Model Context Protocol) para agentes externos
 * (Claude, Cursor, ChatGPT…), como el de Linear.
 *
 * Transporte Streamable HTTP sin estado: cada POST trae un mensaje JSON-RPC
 * (o un lote) y la respuesta es JSON (no abre streams SSE; GET responde 405,
 * como permite la spec). Auth: `Authorization: Bearer zs_…` con una API key
 * con track:read (y track:write para las herramientas que escriben).
 * /api/mcp/track/readonly expone solo las de lectura.
 *
 * Las herramientas llaman a lib/track-api-ops: lo mismo que la API v1.
 */
import { withTeamAlias } from './track-api-http';
import { requireApiUser, type ApiKeyAuth } from './api-auth';
import { hasScope } from './api-scopes';
import {
  apiAddComment,
  apiCommentSchema,
  apiCreateIssue,
  apiGetIssue,
  apiGetProject,
  apiIssueCreateSchema,
  apiIssueListSchema,
  apiIssueUpdateSchema,
  apiListComments,
  apiListCycles,
  apiListIssues,
  apiListLabels,
  apiListProjects,
  apiListUsers,
  apiUpdateIssue,
  parseOrThrow,
  TrackApiError,
  type TrackApiCtx,
} from './track-api-ops';

export const MCP_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const;
export const MCP_SERVER_INFO = { name: 'zerosoft-track', title: 'zerosoft Track', version: '1.0.0' };

type JsonSchema = Record<string, unknown>;

interface McpTool {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  write: boolean;
  run(ctx: TrackApiCtx, args: Record<string, unknown>): Promise<unknown>;
}

const str = (description: string, extra: JsonSchema = {}): JsonSchema => ({ type: 'string', description, ...extra });
const PRIORITY = { type: 'string', enum: ['none', 'urgent', 'high', 'medium', 'low'] };
const CATEGORY = ['backlog', 'todo', 'in_progress', 'done', 'cancelled'];

const ISSUE_FIELDS: Record<string, JsonSchema> = {
  title: str('Issue title.'),
  description: str('Markdown description.'),
  status: str('Status name in the project ("In Progress") or a category (backlog, todo, in_progress, done, cancelled).'),
  priority: { ...PRIORITY, description: 'Priority.' },
  assigneeEmail: str('Email of a project member to assign. Use list_users to find them.'),
  assigneeId: str('User id to assign (null to unassign).', { type: ['string', 'null'] }),
  labels: { type: 'array', items: { type: 'string' }, description: 'Label names; missing labels are created.' },
  dueDate: str('Due date, YYYY-MM-DD.', { type: ['string', 'null'] }),
  startDate: str('Start date, YYYY-MM-DD.', { type: ['string', 'null'] }),
  estimate: { type: ['integer', 'null'], description: 'Estimate in points.' },
  cycleId: str('Cycle id from list_cycles.', { type: ['string', 'null'] }),
  parentId: str('Parent issue id, for sub-issues.', { type: ['string', 'null'] }),
};

function pick(args: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (args[k] !== undefined) out[k] = args[k];
  return out;
}

export const MCP_TOOLS: McpTool[] = [
  {
    name: 'search_issues',
    title: 'Search issues',
    description: 'Search Track issues by text (title, identifier, description and comments) and filters. Returns up to `limit` issues, most recently updated first.',
    inputSchema: {
      type: 'object',
      properties: {
        query: str('Free text, or an identifier like ZER-12.'),
        teamId: str('Team id or key (WEB).'),
        projectId: str('Same as teamId (older name).'),
        statusCategory: { type: 'string', enum: CATEGORY, description: 'Status category.' },
        assigneeId: str('User id, or "me" for the key owner.'),
        priority: PRIORITY,
        includeTriage: { type: 'boolean', description: 'Include issues waiting in triage.' },
        limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Max results (default 20).' },
      },
    },
    write: false,
    run: async (ctx, a) => {
      const assignee = a.assigneeId === 'me' ? ctx.auth.personId : a.assigneeId;
      const query = parseOrThrow(apiIssueListSchema, {
        q: a.query,
        projectId: a.projectId,
        statusCategory: a.statusCategory,
        assigneeId: assignee,
        priority: a.priority,
        triage: a.includeTriage ? undefined : 'false',
        pageSize: Math.min(Math.max(Number(a.limit ?? 20) || 20, 1), 50),
      });
      const res = await apiListIssues(ctx, query);
      return { total: res.total, issues: res.data };
    },
  },
  {
    name: 'get_issue',
    title: 'Get issue',
    description: 'Get one issue by id or identifier (ZER-12), with its comments.',
    inputSchema: { type: 'object', properties: { id: str('Issue id or identifier.') }, required: ['id'] },
    write: false,
    run: async (ctx, a) => {
      const id = String(a.id ?? '');
      const issue = await apiGetIssue(ctx, id);
      const comments = await apiListComments(ctx, id);
      return { ...issue, comments: comments.data };
    },
  },
  {
    name: 'create_issue',
    title: 'Create issue',
    description: 'Create an issue in a team. It goes to triage when the team has triage on.',
    inputSchema: {
      type: 'object',
      properties: { teamId: str('Team id or key (WEB). Use list_teams.'), projectId: str('Same as teamId (older name).'), ...ISSUE_FIELDS },
      required: ['title'],
    },
    write: true,
    run: (ctx, a) =>
      apiCreateIssue(
        ctx,
        parseOrThrow(apiIssueCreateSchema, pick(a, ['projectId', ...Object.keys(ISSUE_FIELDS)])),
      ),
  },
  {
    name: 'update_issue',
    title: 'Update issue',
    description: 'Change title, description, status, priority, assignee, labels, dates, estimate, cycle or parent of an issue.',
    inputSchema: {
      type: 'object',
      properties: { id: str('Issue id or identifier (ZER-12).'), ...ISSUE_FIELDS },
      required: ['id'],
    },
    write: true,
    run: (ctx, a) => apiUpdateIssue(ctx, String(a.id ?? ''), parseOrThrow(apiIssueUpdateSchema, pick(a, Object.keys(ISSUE_FIELDS)))),
  },
  {
    name: 'add_comment',
    title: 'Comment on issue',
    description: 'Add a markdown comment to an issue as the API key owner. Subscribers are notified.',
    inputSchema: {
      type: 'object',
      properties: { id: str('Issue id or identifier (ZER-12).'), body: str('Comment in markdown.') },
      required: ['id', 'body'],
    },
    write: true,
    run: (ctx, a) => apiAddComment(ctx, String(a.id ?? ''), parseOrThrow(apiCommentSchema, { body: a.body })),
  },
  {
    name: 'list_teams',
    title: 'List teams',
    description: 'List the teams the key can see, with their key (prefix of identifiers like WEB-12).',
    inputSchema: { type: 'object', properties: { includeArchived: { type: 'boolean' } } },
    write: false,
    run: (ctx, a) => apiListProjects(ctx, { includeArchived: a.includeArchived === true }),
  },
  {
    name: 'get_team',
    title: 'Get team',
    description: 'Get a team with its workflow statuses.',
    inputSchema: { type: 'object', properties: { id: str('Team id or key.') }, required: ['id'] },
    write: false,
    run: (ctx, a) => apiGetProject(ctx, String(a.id ?? '')),
  },
  {
    name: 'list_projects',
    title: 'List teams (older name)',
    description: 'Same as list_teams. Kept for clients written before teams were called teams.',
    inputSchema: { type: 'object', properties: { includeArchived: { type: 'boolean' } } },
    write: false,
    run: (ctx, a) => apiListProjects(ctx, { includeArchived: a.includeArchived === true }),
  },
  {
    name: 'get_project',
    title: 'Get team (older name)',
    description: 'Same as get_team.',
    inputSchema: { type: 'object', properties: { id: str('Team id or key.') }, required: ['id'] },
    write: false,
    run: (ctx, a) => apiGetProject(ctx, String(a.id ?? '')),
  },
  {
    name: 'list_cycles',
    title: 'List cycles',
    description: 'List the cycles (sprints) of a team.',
    inputSchema: { type: 'object', properties: { teamId: str('Team id or key.'), projectId: str('Same as teamId (older name).') } },
    write: false,
    run: (ctx, a) => apiListCycles(ctx, String(a.projectId ?? '')),
  },
  {
    name: 'list_labels',
    title: 'List labels',
    description: 'List workspace labels.',
    inputSchema: { type: 'object', properties: {} },
    write: false,
    run: (ctx) => apiListLabels(ctx),
  },
  {
    name: 'list_users',
    title: 'List users',
    description: 'List people that can be assigned (optionally in one team).',
    inputSchema: { type: 'object', properties: { teamId: str('Team id or key.'), projectId: str('Same as teamId (older name).') } },
    write: false,
    run: (ctx, a) => apiListUsers(ctx, typeof a.projectId === 'string' ? a.projectId : undefined),
  },
];

// ---------- JSON-RPC ----------

interface RpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

type RpcResponse = { jsonrpc: '2.0'; id: string | number | null; result?: unknown; error?: { code: number; message: string; data?: unknown } };

function ok(id: RpcRequest['id'], result: unknown): RpcResponse {
  return { jsonrpc: '2.0', id: id ?? null, result };
}

function fail(id: RpcRequest['id'], code: number, message: string): RpcResponse {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

export function negotiateVersion(requested: unknown): string {
  return typeof requested === 'string' && (MCP_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
    ? requested
    : MCP_PROTOCOL_VERSIONS[0];
}

export function toolsFor(auth: ApiKeyAuth, readonly: boolean): McpTool[] {
  const canWrite = !readonly && hasScope(auth.scopes, 'track:write');
  return MCP_TOOLS.filter((t) => !t.write || canWrite);
}

/** Atiende un mensaje JSON-RPC. Null para notificaciones (sin respuesta). */
export async function handleMcpMessage(msg: RpcRequest, auth: ApiKeyAuth, readonly: boolean): Promise<RpcResponse | null> {
  if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    return fail(msg?.id, -32600, 'Invalid Request');
  }
  const isNotification = msg.id === undefined || msg.id === null;
  const method = msg.method;

  if (method.startsWith('notifications/')) return null;
  if (method === 'initialize') {
    return ok(msg.id, {
      protocolVersion: negotiateVersion(msg.params?.protocolVersion),
      capabilities: { tools: { listChanged: false } },
      serverInfo: MCP_SERVER_INFO,
      instructions:
        'Tools for zerosoft Track (issue tracking). Issues have identifiers like ZER-12 (team key + number). Use list_teams to find team ids, search_issues to find work, and create_issue / update_issue / add_comment to change it.',
    });
  }
  if (method === 'ping') return ok(msg.id, {});
  if (method === 'tools/list') {
    return ok(msg.id, {
      tools: toolsFor(auth, readonly).map((t) => ({
        name: t.name,
        title: t.title,
        description: t.description,
        inputSchema: t.inputSchema,
        annotations: { readOnlyHint: !t.write, destructiveHint: false, openWorldHint: false },
      })),
    });
  }
  if (method === 'tools/call') {
    const name = String(msg.params?.name ?? '');
    const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
    const tool = MCP_TOOLS.find((t) => t.name === name);
    if (!tool) return fail(msg.id, -32602, `Unknown tool: ${name}`);
    if (tool.write && !toolsFor(auth, readonly).includes(tool)) {
      return ok(msg.id, { content: [{ type: 'text', text: readonly ? 'This endpoint is read-only.' : 'The API key is missing the track:write scope.' }], isError: true });
    }
    try {
      const result = await tool.run({ auth, via: 'mcp' }, withTeamAlias(args && typeof args === 'object' ? args : {}));
      return ok(msg.id, {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        structuredContent: result && typeof result === 'object' && !Array.isArray(result) ? result : { result },
        isError: false,
      });
    } catch (err) {
      const message = err instanceof TrackApiError ? `${err.code}: ${err.message}` : 'Unexpected error.';
      if (!(err instanceof TrackApiError)) {
        // eslint-disable-next-line no-console
        console.error('[track-mcp]', err);
      }
      return ok(msg.id, { content: [{ type: 'text', text: message }], isError: true });
    }
  }
  if (isNotification) return null;
  return fail(msg.id, -32601, `Method not found: ${method}`);
}

// ---------- HTTP (Streamable HTTP sin sesión) ----------

/** POST /api/mcp/track: un mensaje o un lote; JSON de vuelta (202 si solo había notificaciones). */
export async function mcpHttpPost(req: Request, readonly: boolean): Promise<Response> {
  const auth = await requireApiUser(req, 'track:read');
  if ('res' in auth) {
    auth.res.headers.set('www-authenticate', 'Bearer realm="zerosoft", error="invalid_token"');
    return auth.res;
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json(fail(null, -32700, 'Parse error'), { status: 400 });
  }
  const batch = Array.isArray(body);
  const messages = (batch ? body : [body]) as RpcRequest[];
  if (messages.length === 0 || messages.length > 20) return Response.json(fail(null, -32600, 'Invalid Request'), { status: 400 });
  const out: RpcResponse[] = [];
  for (const m of messages) {
    const res = await handleMcpMessage(m, auth, readonly);
    if (res) out.push(res);
  }
  if (out.length === 0) return new Response(null, { status: 202 });
  const headers = { 'content-type': 'application/json', 'mcp-protocol-version': negotiateVersion(req.headers.get('mcp-protocol-version')) };
  return new Response(JSON.stringify(batch ? out : out[0]), { status: 200, headers });
}

/** Sin streams del servidor ni sesiones: GET y DELETE no aplican. */
export function mcpMethodNotAllowed(): Response {
  return new Response(JSON.stringify(fail(null, -32000, 'Method not allowed. POST JSON-RPC messages to this URL.')), {
    status: 405,
    headers: { allow: 'POST', 'content-type': 'application/json' },
  });
}
