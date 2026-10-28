/**
 * Board: servidor MCP (Model Context Protocol, "streamable HTTP" en modo
 * JSON), como el de Excalidraw+. Un cliente MCP (Claude, Cursor, ChatGPT…) se
 * conecta a POST /api/v1/boards/mcp con una API key (Authorization: Bearer
 * zs_…): boards:read para listar, buscar y leer pizarras, boards:write para
 * crearlas, sumarles stickies y formas, renombrarlas o mandarlas a la
 * papelera. La key actúa como la persona que la creó. Server-only.
 */
import { hasScope, type ApiScope } from './api-scopes';
import { BOARD_TEMPLATES } from './board-templates';
import { STICKY_COLORS } from './board-stickies';
import { BoardApiError, apiAddElements, apiCreateBoard, apiGetBoard, apiListBoards, apiTrashBoard, apiUpdateBoard, type BoardActor } from './board-platform';
import { boardElementsV1 } from './board-v1';

export const MCP_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const;

type Json = Record<string, unknown>;

export interface BoardMcpContext {
  actor: BoardActor;
  scopes: ApiScope[];
}

interface ToolDef {
  name: string;
  title: string;
  description: string;
  scope: ApiScope;
  readOnly: boolean;
  destructive?: boolean;
  inputSchema: Json;
  run: (ctx: BoardMcpContext, args: Json) => Promise<unknown>;
}

const str = (v: unknown, max = 400) => (typeof v === 'string' ? v.trim().slice(0, max) : undefined);
const id = (args: Json) => {
  const v = str(args.board_id, 64);
  if (!v) throw new BoardApiError('invalid_input', 400);
  return v;
};

const TOOLS: ToolDef[] = [
  {
    name: 'list_boards',
    title: 'List boards',
    description: 'Boards the key’s person can open, most recently edited first. With query, also searches the text inside (stickies, labels, frames) and returns the matching line.',
    scope: 'boards:read',
    readOnly: true,
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, folder_id: { type: 'string' }, limit: { type: 'number', minimum: 1, maximum: 200 } } },
    run: async (ctx, args) => ({ boards: await apiListBoards(ctx.actor, { q: str(args.query, 100), folderId: str(args.folder_id, 64), limit: Number(args.limit ?? 50) || 50 }) }),
  },
  {
    name: 'get_board',
    title: 'Read a board',
    description: 'A board with an outline of its content: frames in reading order, stickies with text and tags, and loose texts.',
    scope: 'boards:read',
    readOnly: true,
    inputSchema: { type: 'object', properties: { board_id: { type: 'string' } }, required: ['board_id'] },
    run: async (ctx, args) => apiGetBoard(ctx.actor, id(args)),
  },
  {
    name: 'create_board',
    title: 'Create a board',
    description: `New board, empty or from a template (${BOARD_TEMPLATES.join(', ')}).`,
    scope: 'boards:write',
    readOnly: false,
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' }, template: { type: 'string', enum: [...BOARD_TEMPLATES] }, folder_id: { type: 'string' }, locale: { type: 'string', enum: ['en', 'es', 'pt'] } },
    },
    run: async (ctx, args) =>
      apiCreateBoard(ctx.actor, { name: str(args.name, 120), template: str(args.template, 40), folderId: str(args.folder_id, 64) ?? null, locale: str(args.locale, 4) }),
  },
  {
    name: 'add_stickies',
    title: 'Add stickies',
    description: `Adds sticky notes next to the existing content. Colors: ${STICKY_COLORS.map((c) => c.key).join(', ')}.`,
    scope: 'boards:write',
    readOnly: false,
    inputSchema: {
      type: 'object',
      properties: {
        board_id: { type: 'string' },
        stickies: {
          type: 'array',
          maxItems: 200,
          items: { type: 'object', properties: { text: { type: 'string' }, color: { type: 'string', enum: STICKY_COLORS.map((c) => c.key) }, tags: { type: 'array', items: { type: 'string' } } }, required: ['text'] },
        },
      },
      required: ['board_id', 'stickies'],
    },
    run: async (ctx, args) => {
      const parsed = boardElementsV1.safeParse({ stickies: args.stickies });
      if (!parsed.success) throw new BoardApiError('invalid_input', 400);
      return apiAddElements(ctx.actor, id(args), parsed.data);
    },
  },
  {
    name: 'add_diagram',
    title: 'Add shapes and arrows',
    description: 'Adds shapes (rectangle, ellipse, diamond), texts or stickies, and arrows between them by index (connect: [{from, to}]). Positions are optional: without x/y they are laid out next to the content.',
    scope: 'boards:write',
    readOnly: false,
    inputSchema: {
      type: 'object',
      properties: {
        board_id: { type: 'string' },
        elements: {
          type: 'array',
          maxItems: 200,
          items: {
            type: 'object',
            properties: {
              kind: { type: 'string', enum: ['sticky', 'text', 'rectangle', 'ellipse', 'diamond'] },
              text: { type: 'string' },
              x: { type: 'number' },
              y: { type: 'number' },
              width: { type: 'number' },
              height: { type: 'number' },
              fill: { type: 'string', description: '#rrggbb' },
            },
            required: ['kind'],
          },
        },
        connect: { type: 'array', items: { type: 'object', properties: { from: { type: 'number' }, to: { type: 'number' } }, required: ['from', 'to'] } },
      },
      required: ['board_id', 'elements'],
    },
    run: async (ctx, args) => {
      const parsed = boardElementsV1.safeParse({ elements: args.elements, connect: args.connect });
      if (!parsed.success) throw new BoardApiError('invalid_input', 400);
      return apiAddElements(ctx.actor, id(args), parsed.data);
    },
  },
  {
    name: 'update_board',
    title: 'Rename or move a board',
    description: 'Renames the board and/or moves it to a folder (folder_id null takes it out).',
    scope: 'boards:write',
    readOnly: false,
    inputSchema: { type: 'object', properties: { board_id: { type: 'string' }, name: { type: 'string' }, folder_id: { type: ['string', 'null'] } }, required: ['board_id'] },
    run: async (ctx, args) => {
      const name = str(args.name, 120);
      const folderId = args.folder_id === null ? null : str(args.folder_id, 64);
      if (name === undefined && folderId === undefined) throw new BoardApiError('invalid_input', 400);
      return apiUpdateBoard(ctx.actor, id(args), { name, folderId });
    },
  },
  {
    name: 'trash_board',
    title: 'Move a board to the trash',
    description: 'Moves the board to the trash. It can be restored from the app for 30 days.',
    scope: 'boards:write',
    readOnly: false,
    destructive: true,
    inputSchema: { type: 'object', properties: { board_id: { type: 'string' } }, required: ['board_id'] },
    run: async (ctx, args) => {
      await apiTrashBoard(ctx.actor, id(args));
      return { trashed: true };
    },
  },
];

export function boardMcpTools() {
  return TOOLS.map((t) => ({
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: t.inputSchema,
    annotations: { readOnlyHint: t.readOnly, destructiveHint: t.destructive === true, openWorldHint: false },
  }));
}

interface RpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Json;
}

export type RpcResponse = { jsonrpc: '2.0'; id: string | number | null; result?: unknown; error?: { code: number; message: string } };

const rpcError = (rid: RpcRequest['id'], code: number, message: string): RpcResponse => ({ jsonrpc: '2.0', id: rid ?? null, error: { code, message } });

/** Una llamada JSON-RPC. null para notificaciones (sin id). */
export async function handleBoardRpc(ctx: BoardMcpContext, req: RpcRequest): Promise<RpcResponse | null> {
  const isNotification = req.id === undefined;
  if (req.jsonrpc !== '2.0' || typeof req.method !== 'string') return isNotification ? null : rpcError(req.id, -32600, 'Invalid request');
  if (isNotification) return null;
  const rid = req.id ?? null;
  switch (req.method) {
    case 'initialize': {
      const asked = String(req.params?.protocolVersion ?? '');
      const version = (MCP_PROTOCOL_VERSIONS as readonly string[]).includes(asked) ? asked : MCP_PROTOCOL_VERSIONS[0];
      return {
        jsonrpc: '2.0',
        id: rid,
        result: {
          protocolVersion: version,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'zerosoft-board', title: 'zerosoft Board', version: '1.0.0' },
          instructions:
            'Whiteboards of a zerosoft workspace. Use list_boards (query searches inside boards), get_board for the outline, create_board, then add_stickies or add_diagram to draw. Changes show up live for people who have the board open.',
        },
      };
    }
    case 'ping':
      return { jsonrpc: '2.0', id: rid, result: {} };
    case 'tools/list':
      return { jsonrpc: '2.0', id: rid, result: { tools: boardMcpTools() } };
    case 'tools/call': {
      const name = String(req.params?.name ?? '');
      const tool = TOOLS.find((t) => t.name === name);
      if (!tool) return rpcError(rid, -32602, `Unknown tool: ${name}`);
      if (!hasScope(ctx.scopes, tool.scope)) {
        return { jsonrpc: '2.0', id: rid, result: { isError: true, content: [{ type: 'text', text: `This API key is missing the "${tool.scope}" scope.` }] } };
      }
      const args = (req.params?.arguments && typeof req.params.arguments === 'object' ? req.params.arguments : {}) as Json;
      try {
        const out = (await tool.run(ctx, args)) as Json;
        return { jsonrpc: '2.0', id: rid, result: { content: [{ type: 'text', text: JSON.stringify(out) }], structuredContent: out, isError: false } };
      } catch (err) {
        const code = err instanceof BoardApiError ? err.code : 'server_error';
        if (!(err instanceof BoardApiError)) console.error('[board] mcp tool failed', (err as Error)?.name ?? 'error');
        return { jsonrpc: '2.0', id: rid, result: { isError: true, content: [{ type: 'text', text: `Error: ${code}` }] } };
      }
    }
    default:
      return rpcError(rid, -32601, `Method not found: ${req.method}`);
  }
}
