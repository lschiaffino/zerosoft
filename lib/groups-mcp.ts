/**
 * Groups: servidor MCP (Model Context Protocol, transporte "streamable HTTP"
 * en modo JSON). Un cliente MCP (Claude, Cursor, etc.) se conecta a
 * POST /api/v1/groups/mcp con una API key (Authorization: Bearer zs_…) y
 * usa las herramientas de abajo con los permisos de quien creó la key:
 * groups:read para leer, groups:write para mandar y cambiar. Respeta el
 * acceso por etiqueta y los teléfonos ocultos, y deja el log de auditoría.
 *
 * Solo JSON-RPC por POST (sin stream SSE: ninguna herramienta lo necesita).
 * Server-only.
 */
import { hasScope, type ApiScope } from './api-scopes';
import { GroupsError, CHAT_FILTERS, getChat, listChats, listLabels, listMessages, sendMessage, type ChatFilter } from './groups';
import { canSeeChat, maskChat, maskMessage, ticketsForViewer, type GroupsViewer } from './groups-access';
import { patchChatAs } from './groups-chat-ops';
import { recordAudit } from './groups-audit';
import { normalizePoll } from './groups-polls';
import { TICKET_PRIORITIES, TICKET_STATUSES, type TicketPriority, type TicketStatus } from './groups-rules';

export const MCP_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const;

export interface McpContext {
  ws: string;
  personId: string;
  scopes: ApiScope[];
  viewer: GroupsViewer;
}

type Json = Record<string, unknown>;

interface ToolDef {
  name: string;
  title: string;
  description: string;
  scope: ApiScope;
  inputSchema: Json;
  readOnly: boolean;
  run: (ctx: McpContext, args: Json) => Promise<unknown>;
}

const str = (v: unknown, max = 4096) => (typeof v === 'string' ? v.slice(0, max) : undefined);

async function visibleChat(ctx: McpContext, chatId: unknown): Promise<string> {
  const id = str(chatId, 100);
  if (!id || !(await canSeeChat(ctx.viewer, id))) throw new GroupsError('not_found', 404);
  return id;
}

const TOOLS: ToolDef[] = [
  {
    name: 'list_chats',
    title: 'List chats and groups',
    description:
      'Lists WhatsApp chats and groups in the Groups inbox, newest activity first. Filter by unread, unanswered, flagged, mine, unassigned or closed; search names, phones and message text with q.',
    scope: 'groups:read',
    readOnly: true,
    inputSchema: {
      type: 'object',
      properties: {
        filter: { type: 'string', enum: [...CHAT_FILTERS] },
        q: { type: 'string', description: 'Text to search in chat names, phones and messages' },
        kind: { type: 'string', enum: ['group', 'dm'] },
        labelId: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
      },
    },
    run: async (ctx, a) => {
      const filter = (CHAT_FILTERS as readonly string[]).includes(String(a.filter)) ? (a.filter as ChatFilter) : 'all';
      const res = await listChats(ctx.ws, ctx.personId, {
        filter,
        q: str(a.q, 200) ?? '',
        kind: a.kind === 'group' || a.kind === 'dm' ? a.kind : undefined,
        labelId: str(a.labelId, 100),
        limit: Math.min(100, Math.max(1, Number(a.limit) || 25)),
        viewer: ctx.viewer,
      });
      return {
        total: res.total,
        chats: res.rows.map((c) => ({
          id: c.id,
          kind: c.kind,
          name: c.name,
          phone: c.phone,
          members: c.memberCount,
          assignedTo: c.assignedTo,
          status: c.status,
          unread: c.unread,
          awaitingSince: c.awaitingSince,
          flagged: c.flagged,
          labels: c.labels.map((l) => l.name),
          lastMessageAt: c.lastMessageAt,
          lastMessage: c.lastMessagePreview,
          ...(c.match ? { match: c.match } : {}),
        })),
      };
    },
  },
  {
    name: 'get_messages',
    title: 'Read the messages of a chat',
    description: 'Returns the latest messages and internal notes of a chat or group, oldest first. Use after to get only newer ones.',
    scope: 'groups:read',
    readOnly: true,
    inputSchema: {
      type: 'object',
      required: ['chatId'],
      properties: { chatId: { type: 'string' }, after: { type: 'string', description: 'ISO date' }, limit: { type: 'integer', minimum: 1, maximum: 200 } },
    },
    run: async (ctx, a) => {
      const id = await visibleChat(ctx, a.chatId);
      const msgs = await listMessages(ctx.ws, id, { after: str(a.after, 40), limit: Math.min(200, Math.max(1, Number(a.limit) || 50)) });
      return {
        messages: msgs.map((raw) => {
          const m = maskMessage(ctx.viewer, raw);
          return {
            id: m.id,
            direction: m.direction,
            from: m.direction === 'in' ? m.senderName || (m.senderPhone ? `+${m.senderPhone}` : '') : m.authorKind,
            body: m.body,
            media: m.media ? m.media.type : null,
            poll: m.poll ?? null,
            status: m.status,
            ticketId: m.ticketId,
            createdAt: m.createdAt,
          };
        }),
      };
    },
  },
  {
    name: 'send_message',
    title: 'Send a WhatsApp message',
    description: 'Sends a text message to a chat or group from its connected number. With note: true it saves an internal note instead (only the team sees it).',
    scope: 'groups:write',
    readOnly: false,
    inputSchema: {
      type: 'object',
      required: ['chatId', 'body'],
      properties: { chatId: { type: 'string' }, body: { type: 'string', maxLength: 4096 }, note: { type: 'boolean' } },
    },
    run: async (ctx, a) => {
      const id = await visibleChat(ctx, a.chatId);
      const body = str(a.body);
      if (!body?.trim()) throw new GroupsError('empty_message');
      const m = await sendMessage(ctx.ws, ctx.personId, id, { body, note: a.note === true, authorKind: 'api' });
      return { id: m.id, status: m.status, error: m.error || undefined, createdAt: m.createdAt };
    },
  },
  {
    name: 'send_poll',
    title: 'Send a poll',
    description: 'Sends a native WhatsApp poll (2 to 12 options). Works with WAHA and Evolution numbers; the Meta Cloud API has no polls.',
    scope: 'groups:write',
    readOnly: false,
    inputSchema: {
      type: 'object',
      required: ['chatId', 'question', 'options'],
      properties: {
        chatId: { type: 'string' },
        question: { type: 'string', maxLength: 255 },
        options: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 12 },
        multi: { type: 'boolean', description: 'Allow several answers per person' },
      },
    },
    run: async (ctx, a) => {
      const id = await visibleChat(ctx, a.chatId);
      let poll;
      try {
        poll = normalizePoll({ question: a.question, options: a.options, multi: a.multi === true });
      } catch (err) {
        throw new GroupsError((err as Error).message);
      }
      const m = await sendMessage(ctx.ws, ctx.personId, id, { body: '', poll, authorKind: 'api' });
      return { id: m.id, status: m.status, error: m.error || undefined };
    },
  },
  {
    name: 'update_chat',
    title: 'Assign, close or label a chat',
    description: 'Assigns a chat to a person (assignedTo: user id, or null to unassign), closes or reopens it (status), or replaces its labels (labelIds).',
    scope: 'groups:write',
    readOnly: false,
    inputSchema: {
      type: 'object',
      required: ['chatId'],
      properties: {
        chatId: { type: 'string' },
        assignedTo: { type: ['string', 'null'] },
        status: { type: 'string', enum: ['open', 'closed'] },
        labelIds: { type: 'array', items: { type: 'string' } },
      },
    },
    run: async (ctx, a) => {
      const id = await visibleChat(ctx, a.chatId);
      const patch: Parameters<typeof patchChatAs>[3] = {};
      if (a.assignedTo === null || typeof a.assignedTo === 'string') patch.assignedTo = (a.assignedTo as string | null) || null;
      if (a.status === 'open' || a.status === 'closed') patch.status = a.status;
      if (Array.isArray(a.labelIds)) patch.labelIds = a.labelIds.filter((x): x is string => typeof x === 'string').slice(0, 20);
      const chat = maskChat(ctx.viewer, await patchChatAs(ctx.ws, { id: ctx.personId, kind: 'mcp' }, id, patch));
      return { id: chat.id, assignedTo: chat.assignedTo, status: chat.status, labels: chat.labels.map((l) => l.name) };
    },
  },
  {
    name: 'list_labels',
    title: 'List labels',
    description: 'Labels of the workspace with the number of chats that have each one.',
    scope: 'groups:read',
    readOnly: true,
    inputSchema: { type: 'object', properties: {} },
    run: async (ctx) => ({ labels: (await listLabels(ctx.ws)).map((l) => ({ id: l.id, name: l.name, color: l.color, chats: l.count })) }),
  },
  {
    name: 'create_ticket',
    title: 'Create a ticket',
    description: 'Creates a support ticket for a chat, optionally from one of its messages (messageId). Returns the existing ticket if that message already has one.',
    scope: 'groups:write',
    readOnly: false,
    inputSchema: {
      type: 'object',
      required: ['chatId'],
      properties: {
        chatId: { type: 'string' },
        title: { type: 'string', maxLength: 200 },
        messageId: { type: 'string' },
        priority: { type: 'string', enum: [...TICKET_PRIORITIES] },
      },
    },
    run: async (ctx, a) => {
      const id = await visibleChat(ctx, a.chatId);
      const { createTicket } = await import('./groups-tickets');
      const priority = (TICKET_PRIORITIES as readonly string[]).includes(String(a.priority)) ? (a.priority as TicketPriority) : undefined;
      const res = await createTicket(ctx.ws, ctx.personId, { chatId: id, messageId: str(a.messageId, 100) || null, title: str(a.title, 200), priority, source: 'api' });
      if (res.created) {
        const chat = await getChat(ctx.ws, id);
        await recordAudit(ctx.ws, { chatId: id, chatName: chat?.name ?? '', actorId: ctx.personId, actorKind: 'mcp', action: 'ticket_created', detail: { number: res.ticket.number } });
      }
      return { created: res.created, ticket: { id: res.ticket.id, number: res.ticket.number, title: res.ticket.title, status: res.ticket.status, priority: res.ticket.priority } };
    },
  },
  {
    name: 'list_tickets',
    title: 'List tickets',
    description: 'Tickets of the workspace: active ones by default, or by status. Filter by chatId.',
    scope: 'groups:read',
    readOnly: true,
    inputSchema: {
      type: 'object',
      properties: { status: { type: 'string', enum: ['active', 'all', ...TICKET_STATUSES] }, chatId: { type: 'string' } },
    },
    run: async (ctx, a) => {
      const { listTickets } = await import('./groups-tickets');
      const status = (['active', 'all', ...TICKET_STATUSES] as string[]).includes(String(a.status)) ? (a.status as TicketStatus | 'active' | 'all') : 'active';
      const list = await ticketsForViewer(ctx.viewer, await listTickets(ctx.ws, { status, chatId: str(a.chatId, 100) }));
      return {
        tickets: list.map((t) => ({ id: t.id, number: t.number, title: t.title, status: t.status, priority: t.priority, assigneeId: t.assigneeId, chat: t.chatName, chatId: t.chatId, dueAt: t.dueAt, breached: t.breached })),
      };
    },
  },
  {
    name: 'update_ticket',
    title: 'Update a ticket',
    description: 'Changes the status, priority, assignee or title of a ticket.',
    scope: 'groups:write',
    readOnly: false,
    inputSchema: {
      type: 'object',
      required: ['ticketId'],
      properties: {
        ticketId: { type: 'string' },
        status: { type: 'string', enum: [...TICKET_STATUSES] },
        priority: { type: 'string', enum: [...TICKET_PRIORITIES] },
        assigneeId: { type: ['string', 'null'] },
        title: { type: 'string' },
      },
    },
    run: async (ctx, a) => {
      const { getTicket, updateTicket } = await import('./groups-tickets');
      const before = await getTicket(ctx.ws, str(a.ticketId, 100) ?? '');
      if (!before || (before.chatId ? !(await canSeeChat(ctx.viewer, before.chatId)) : ctx.viewer.restricted)) throw new GroupsError('not_found', 404);
      const after = await updateTicket(ctx.ws, before.id, {
        ...(typeof a.status === 'string' ? { status: a.status as TicketStatus } : {}),
        ...(typeof a.priority === 'string' ? { priority: a.priority as TicketPriority } : {}),
        ...(a.assigneeId === null || typeof a.assigneeId === 'string' ? { assigneeId: (a.assigneeId as string | null) || null } : {}),
        ...(typeof a.title === 'string' ? { title: a.title } : {}),
      });
      await recordAudit(ctx.ws, { chatId: after.chatId, chatName: before.chatName, actorId: ctx.personId, actorKind: 'mcp', action: 'ticket_updated', detail: { number: after.number, status: after.status } });
      return { id: after.id, number: after.number, status: after.status, priority: after.priority, assigneeId: after.assigneeId };
    },
  },
];

export function mcpTools(): Array<{ name: string; title: string; description: string; inputSchema: Json; annotations: Json }> {
  return TOOLS.map((t) => ({
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: t.inputSchema,
    annotations: { readOnlyHint: t.readOnly, destructiveHint: false, openWorldHint: !t.readOnly },
  }));
}

interface RpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Json;
}

export type RpcResponse = { jsonrpc: '2.0'; id: string | number | null; result?: unknown; error?: { code: number; message: string; data?: unknown } };

const rpcError = (id: RpcRequest['id'], code: number, message: string, data?: unknown): RpcResponse => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data !== undefined ? { data } : {}) } });

/** Una llamada JSON-RPC. null para notificaciones (sin id): no llevan respuesta. */
export async function handleRpc(ctx: McpContext, req: RpcRequest): Promise<RpcResponse | null> {
  const isNotification = req.id === undefined;
  if (req.jsonrpc !== '2.0' || typeof req.method !== 'string') return isNotification ? null : rpcError(req.id, -32600, 'Invalid request');
  if (isNotification) return null;
  const id = req.id ?? null;
  switch (req.method) {
    case 'initialize': {
      const asked = String(req.params?.protocolVersion ?? '');
      const version = (MCP_PROTOCOL_VERSIONS as readonly string[]).includes(asked) ? asked : MCP_PROTOCOL_VERSIONS[0];
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: version,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'zerosoft-groups', title: 'zerosoft Groups', version: '1.0.0' },
          instructions:
            'WhatsApp inbox of a zerosoft workspace. Use list_chats to find a chat or group, get_messages to read it, send_message to reply and create_ticket to track a request.',
        },
      };
    }
    case 'ping':
      return { jsonrpc: '2.0', id, result: {} };
    case 'tools/list':
      return { jsonrpc: '2.0', id, result: { tools: mcpTools() } };
    case 'tools/call': {
      const name = String(req.params?.name ?? '');
      const tool = TOOLS.find((t) => t.name === name);
      if (!tool) return rpcError(id, -32602, `Unknown tool: ${name}`);
      if (!hasScope(ctx.scopes, tool.scope)) {
        return { jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text: `This API key is missing the "${tool.scope}" scope.` }] } };
      }
      const args = (req.params?.arguments && typeof req.params.arguments === 'object' ? req.params.arguments : {}) as Json;
      try {
        const out = await tool.run(ctx, args);
        return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(out) }], structuredContent: out, isError: false } };
      } catch (err) {
        const code = err instanceof GroupsError ? err.code : 'server_error';
        if (!(err instanceof GroupsError)) {
          // eslint-disable-next-line no-console
          console.error('[groups] mcp tool failed', (err as Error)?.name ?? 'error');
        }
        return { jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text: `Error: ${code}` }] } };
      }
    }
    default:
      return rpcError(id, -32601, `Method not found: ${req.method}`);
  }
}
