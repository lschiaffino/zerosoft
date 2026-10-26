/**
 * Docs: servidor MCP (Model Context Protocol, "streamable HTTP" en modo
 * JSON), como el MCP de Notion. Un cliente MCP (Claude, Cursor…) se conecta a
 * POST /api/v1/docs/mcp con una API key (Authorization: Bearer zs_…) y usa
 * las herramientas de abajo con los permisos de quien creó la key:
 * docs:read para buscar y leer, docs:write para crear y editar. Todo pasa
 * por lib/docs-platform.ts (permisos por página y teamspaces).
 * Server-only.
 */
import { hasScope, type ApiScope } from './api-scopes';
import type { DocsActor } from './docs';
import {
  addComment,
  createPage,
  createRow,
  DocsPlatformError,
  getDatabase,
  getPage,
  getRow,
  listComments,
  listDatabases,
  queryRows,
  searchPages,
  updatePage,
  updateRow,
} from './docs-platform';

export const MCP_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const;

export interface DocsMcpContext {
  actor: DocsActor;
  scopes: ApiScope[];
}

type Json = Record<string, unknown>;

interface ToolDef {
  name: string;
  title: string;
  description: string;
  scope: ApiScope;
  readOnly: boolean;
  inputSchema: Json;
  run: (ctx: DocsMcpContext, args: Json) => Promise<unknown>;
}

const str = (v: unknown, max = 400_000) => (typeof v === 'string' ? v.slice(0, max) : undefined);
const values = (v: unknown): Record<string, unknown> | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined);
const dbArgs = { pageId: { type: 'string' }, blockId: { type: 'string', description: 'Database block id (from list_databases or fetch_page)' } };

const TOOLS: ToolDef[] = [
  {
    name: 'search',
    title: 'Search pages',
    description: 'Searches Docs pages and database rows by title and content. Returns ids, titles and a snippet.',
    scope: 'docs:read',
    readOnly: true,
    inputSchema: { type: 'object', required: ['query'], properties: { query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 50 } } },
    run: async (ctx, a) => ({ results: await searchPages(ctx.actor, str(a.query, 200) ?? '', Math.min(50, Math.max(1, Number(a.limit) || 10))) }),
  },
  {
    name: 'fetch_page',
    title: 'Read a page',
    description: 'Returns a page with its content as Markdown and the databases it contains.',
    scope: 'docs:read',
    readOnly: true,
    inputSchema: { type: 'object', required: ['pageId'], properties: { pageId: { type: 'string' } } },
    run: async (ctx, a) => getPage(ctx.actor, str(a.pageId, 100) ?? ''),
  },
  {
    name: 'create_page',
    title: 'Create a page',
    description: 'Creates a page with Markdown content, optionally inside another page (parentId) or from a template (templateId).',
    scope: 'docs:write',
    readOnly: false,
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', maxLength: 300 },
        markdown: { type: 'string' },
        parentId: { type: 'string' },
        templateId: { type: 'string' },
      },
    },
    run: async (ctx, a) => {
      const page = await createPage(ctx.actor, { title: str(a.title, 300), markdown: str(a.markdown), parentId: str(a.parentId, 100) || null, templateId: str(a.templateId, 100) || null });
      return { id: page.id, title: page.title, url: page.url };
    },
  },
  {
    name: 'update_page',
    title: 'Edit a page',
    description:
      'Renames a page (title), replaces its content (markdown) or adds Markdown at the end (append). Databases on the page are kept when the content is replaced.',
    scope: 'docs:write',
    readOnly: false,
    inputSchema: {
      type: 'object',
      required: ['pageId'],
      properties: { pageId: { type: 'string' }, title: { type: 'string' }, markdown: { type: 'string' }, append: { type: 'string' } },
    },
    run: async (ctx, a) => {
      const page = await updatePage(ctx.actor, str(a.pageId, 100) ?? '', {
        ...(typeof a.title === 'string' ? { title: a.title } : {}),
        ...(typeof a.markdown === 'string' ? { markdown: a.markdown } : {}),
        ...(typeof a.append === 'string' ? { appendMarkdown: a.append } : {}),
      });
      return { id: page.id, title: page.title, url: page.url, updatedAt: page.updatedAt };
    },
  },
  {
    name: 'list_databases',
    title: 'List databases',
    description: 'Lists the databases the key owner can read, with their properties and options.',
    scope: 'docs:read',
    readOnly: true,
    inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
    run: async (ctx, a) => ({ databases: await listDatabases(ctx.actor, str(a.query, 200) ?? '') }),
  },
  {
    name: 'query_database',
    title: 'Query database rows',
    description: 'Returns the rows of a database. filter maps a property name to text its value must contain; q searches the title.',
    scope: 'docs:read',
    readOnly: true,
    inputSchema: {
      type: 'object',
      required: ['pageId', 'blockId'],
      properties: { ...dbArgs, q: { type: 'string' }, filter: { type: 'object', additionalProperties: { type: 'string' } }, limit: { type: 'integer', minimum: 1, maximum: 200 } },
    },
    run: async (ctx, a) => {
      const filter: Record<string, string> = {};
      for (const [k, v] of Object.entries(values(a.filter) ?? {})) filter[k.slice(0, 100)] = String(v).slice(0, 200);
      return queryRows(ctx.actor, str(a.pageId, 100) ?? '', str(a.blockId, 100) ?? '', { q: str(a.q, 200), filter, limit: Number(a.limit) || 50 });
    },
  },
  {
    name: 'get_database',
    title: 'Database schema',
    description: 'Returns the properties of a database (names, types, options).',
    scope: 'docs:read',
    readOnly: true,
    inputSchema: { type: 'object', required: ['pageId', 'blockId'], properties: dbArgs },
    run: async (ctx, a) => getDatabase(ctx.actor, str(a.pageId, 100) ?? '', str(a.blockId, 100) ?? ''),
  },
  {
    name: 'get_row',
    title: 'Read a row',
    description: 'Returns one database row with its properties and its content as Markdown.',
    scope: 'docs:read',
    readOnly: true,
    inputSchema: { type: 'object', required: ['pageId', 'blockId', 'rowId'], properties: { ...dbArgs, rowId: { type: 'string' } } },
    run: async (ctx, a) => getRow(ctx.actor, str(a.pageId, 100) ?? '', str(a.blockId, 100) ?? '', str(a.rowId, 100) ?? ''),
  },
  {
    name: 'create_row',
    title: 'Add a row',
    description: 'Adds a row to a database. properties maps property names to values (select options are created; people by email).',
    scope: 'docs:write',
    readOnly: false,
    inputSchema: {
      type: 'object',
      required: ['pageId', 'blockId'],
      properties: { ...dbArgs, title: { type: 'string' }, properties: { type: 'object' }, markdown: { type: 'string' }, template: { type: 'string' } },
    },
    run: async (ctx, a) =>
      createRow(ctx.actor, str(a.pageId, 100) ?? '', str(a.blockId, 100) ?? '', {
        title: str(a.title, 2000),
        values: values(a.properties),
        markdown: str(a.markdown, 200_000),
        template: str(a.template, 200),
      }),
  },
  {
    name: 'update_row',
    title: 'Edit a row',
    description: 'Changes the title, properties or content of a database row (append adds Markdown at the end of its content).',
    scope: 'docs:write',
    readOnly: false,
    inputSchema: {
      type: 'object',
      required: ['pageId', 'blockId', 'rowId'],
      properties: { ...dbArgs, rowId: { type: 'string' }, title: { type: 'string' }, properties: { type: 'object' }, append: { type: 'string' } },
    },
    run: async (ctx, a) =>
      updateRow(ctx.actor, str(a.pageId, 100) ?? '', str(a.blockId, 100) ?? '', str(a.rowId, 100) ?? '', {
        title: str(a.title, 2000),
        values: values(a.properties),
        appendMarkdown: str(a.append, 200_000),
      }),
  },
  {
    name: 'list_comments',
    title: 'Read comments',
    description: 'Lists the comments and threads of a page.',
    scope: 'docs:read',
    readOnly: true,
    inputSchema: { type: 'object', required: ['pageId'], properties: { pageId: { type: 'string' } } },
    run: async (ctx, a) => ({ comments: await listComments(ctx.actor, str(a.pageId, 100) ?? '') }),
  },
  {
    name: 'add_comment',
    title: 'Comment on a page',
    description: 'Adds a comment to a page (or replies to a thread with parentId), as the person who created the key.',
    scope: 'docs:write',
    readOnly: false,
    inputSchema: { type: 'object', required: ['pageId', 'text'], properties: { pageId: { type: 'string' }, text: { type: 'string', maxLength: 5000 }, parentId: { type: 'string' } } },
    run: async (ctx, a) => addComment(ctx.actor, str(a.pageId, 100) ?? '', { text: str(a.text, 5000) ?? '', parentId: str(a.parentId, 100) || null }),
  },
];

export function docsMcpTools() {
  return TOOLS.map((t) => ({
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: t.inputSchema,
    annotations: { readOnlyHint: t.readOnly, destructiveHint: false, openWorldHint: false },
  }));
}

interface RpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Json;
}

export type RpcResponse = { jsonrpc: '2.0'; id: string | number | null; result?: unknown; error?: { code: number; message: string } };

const rpcError = (id: RpcRequest['id'], code: number, message: string): RpcResponse => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

/** Una llamada JSON-RPC. null para notificaciones (sin id). */
export async function handleDocsRpc(ctx: DocsMcpContext, req: RpcRequest): Promise<RpcResponse | null> {
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
          serverInfo: { name: 'zerosoft-docs', title: 'zerosoft Docs', version: '1.0.0' },
          instructions:
            'Docs pages and databases of a zerosoft workspace. Use search to find pages, fetch_page to read one, create_page and update_page to write, list_databases and query_database for databases, create_row and update_row to change rows.',
        },
      };
    }
    case 'ping':
      return { jsonrpc: '2.0', id, result: {} };
    case 'tools/list':
      return { jsonrpc: '2.0', id, result: { tools: docsMcpTools() } };
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
        if (!(err instanceof DocsPlatformError)) {
          // eslint-disable-next-line no-console
          console.error('[docs] mcp tool failed', (err as Error)?.name ?? 'error');
        }
        const code = err instanceof DocsPlatformError ? err.code : 'server_error';
        return { jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text: `Error: ${code}` }] } };
      }
    }
    default:
      return rpcError(id, -32601, `Method not found: ${req.method}`);
  }
}
