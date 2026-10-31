/**
 * Notes: servidor MCP (streamable HTTP en modo JSON) en POST /api/v1/notes/mcp.
 * Herramientas con los permisos de quien creó la API key: notes:read para
 * buscar y leer, notes:write para crear y editar. Server-only.
 */
import { hasScope, type ApiScope } from './api-scopes';
import { createNote, getNote, listNotebooks, listNotes, updateNote, type NoteOwner } from './notes';
import { listTasks } from './notes-tasks';
import { detailDto, summaryDto } from './notes-v1';
import { markdownToNote } from './notes-import';

const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
type Json = Record<string, unknown>;
export interface NotesMcpContext {
  owner: NoteOwner;
  scopes: ApiScope[];
}

const str = (v: unknown, max = 400_000) => (typeof v === 'string' ? v.slice(0, max) : undefined);
const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 20) : undefined);

const TOOLS: Array<{ name: string; description: string; scope: ApiScope; readOnly: boolean; inputSchema: Json; run: (c: NotesMcpContext, a: Json) => Promise<unknown> }> = [
  {
    name: 'search_notes',
    description: 'Searches your notes by text. Accepts operators like tag:, notebook:, intitle: and todo:. Returns ids, titles and snippets.',
    scope: 'notes:read',
    readOnly: true,
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 50 } } },
    run: async (c, a) => ({ notes: (await listNotes(c.owner, { q: str(a.query, 200) ?? null, limit: Math.min(50, Math.max(1, Number(a.limit) || 10)) })).map(summaryDto) }),
  },
  {
    name: 'read_note',
    description: 'Returns a note with its content as Markdown. Locked notes return no content.',
    scope: 'notes:read',
    readOnly: true,
    inputSchema: { type: 'object', required: ['noteId'], properties: { noteId: { type: 'string' } } },
    run: async (c, a) => {
      const n = await getNote(c.owner, str(a.noteId, 100) ?? '');
      if (!n) throw new Error('Note not found.');
      return { ...detailDto(n), blocks: undefined };
    },
  },
  {
    name: 'list_notebooks',
    description: 'Lists your notebooks with their note counts.',
    scope: 'notes:read',
    readOnly: true,
    inputSchema: { type: 'object', properties: {} },
    run: async (c) => ({ notebooks: await listNotebooks(c.owner) }),
  },
  {
    name: 'list_tasks',
    description: 'Lists the checklist items of your notes with due dates and assignees, plus those assigned to you.',
    scope: 'notes:read',
    readOnly: true,
    inputSchema: { type: 'object', properties: {} },
    run: async (c) => ({ tasks: await listTasks(c.owner) }),
  },
  {
    name: 'create_note',
    description: 'Creates a note from Markdown.',
    scope: 'notes:write',
    readOnly: false,
    inputSchema: { type: 'object', properties: { title: { type: 'string' }, markdown: { type: 'string' }, notebookId: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } } },
    run: async (c, a) => {
      const md = str(a.markdown);
      const n = await createNote(c.owner, { title: str(a.title, 300), notebook_id: str(a.notebookId, 64) ?? null, tags: strs(a.tags), content: md !== undefined ? markdownToNote(md).blocks : undefined });
      return summaryDto(n);
    },
  },
  {
    name: 'update_note',
    description: 'Changes the title, tags or content (replaces it with the given Markdown) of a note.',
    scope: 'notes:write',
    readOnly: false,
    inputSchema: { type: 'object', required: ['noteId'], properties: { noteId: { type: 'string' }, title: { type: 'string' }, markdown: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } } },
    run: async (c, a) => {
      const md = str(a.markdown);
      const n = await updateNote(c.owner, str(a.noteId, 100) ?? '', { title: str(a.title, 300), tags: strs(a.tags), content: md !== undefined ? markdownToNote(md).blocks : undefined });
      if (!n) throw new Error('Note not found.');
      return summaryDto(n);
    },
  },
];

export type RpcResponse = { jsonrpc: '2.0'; id: unknown; result?: unknown; error?: { code: number; message: string } };

export async function handleNotesRpc(ctx: NotesMcpContext, msg: { id?: unknown; method?: unknown; params?: unknown }): Promise<RpcResponse | null> {
  const id = msg.id ?? null;
  const ok = (result: unknown): RpcResponse => ({ jsonrpc: '2.0', id, result });
  const params = (msg.params && typeof msg.params === 'object' ? msg.params : {}) as Json;
  if (typeof msg.method !== 'string') return { jsonrpc: '2.0', id, error: { code: -32600, message: 'Invalid request' } };
  if (msg.id === undefined) return null;
  switch (msg.method) {
    case 'initialize': {
      const want = str(params.protocolVersion, 20);
      return ok({
        protocolVersion: want && PROTOCOLS.includes(want) ? want : PROTOCOLS[0],
        capabilities: { tools: {} },
        serverInfo: { name: 'zerosoft-notes', version: '1.0.0' },
      });
    }
    case 'ping':
      return ok({});
    case 'tools/list':
      return ok({
        tools: TOOLS.filter((t) => hasScope(ctx.scopes, t.scope)).map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
          annotations: { readOnlyHint: t.readOnly },
        })),
      });
    case 'tools/call': {
      const tool = TOOLS.find((t) => t.name === params.name);
      if (!tool) return { jsonrpc: '2.0', id, error: { code: -32602, message: 'Unknown tool' } };
      if (!hasScope(ctx.scopes, tool.scope)) return ok({ content: [{ type: 'text', text: `This API key is missing the "${tool.scope}" scope.` }], isError: true });
      try {
        const out = await tool.run(ctx, (params.arguments && typeof params.arguments === 'object' ? params.arguments : {}) as Json);
        return ok({ content: [{ type: 'text', text: JSON.stringify(out) }], isError: false });
      } catch (err) {
        return ok({ content: [{ type: 'text', text: err instanceof Error ? err.message : 'Request failed.' }], isError: true });
      }
    }
    default:
      return { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } };
  }
}
