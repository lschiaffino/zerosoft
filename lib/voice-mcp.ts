/**
 * Voice: servidor MCP (Model Context Protocol, "streamable HTTP" en modo
 * JSON), como los de Granola y Wispr Flow. Un cliente MCP (Claude, Cursor,
 * ChatGPT…) se conecta a POST /api/v1/voice/mcp con una API key
 * (Authorization: Bearer zs_…) con voice:read. La key actúa como quien la
 * creó: solo ve sus propias reuniones y dictados (son privados), nunca los
 * de otra persona del workspace. Server-only.
 */
import { hasScope, type ApiScope } from './api-scopes';
import { getSessionDetail, listSessions, type VoiceOwner } from './voice';
import { askAcross } from './voice-service';
import { meetingLabels } from './voice-http';
import { meetingMarkdown } from './voice-integrations';
import { listFolders, ownsFolder } from './voice-library';
import { AiError } from './ai';

const MCP_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const;

export interface VoiceMcpContext {
  owner: VoiceOwner;
  scopes: ApiScope[];
}

class McpToolError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

type Json = Record<string, unknown>;

interface ToolDef {
  name: string;
  title: string;
  description: string;
  scope: ApiScope;
  inputSchema: Json;
  run: (ctx: VoiceMcpContext, args: Json) => Promise<unknown>;
}

const str = (v: unknown, max = 400) => (typeof v === 'string' ? v.trim().slice(0, max) : undefined);
const int = (v: unknown, def: number, max: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(Math.max(Math.round(v), 1), max) : def);

const TOOLS: ToolDef[] = [
  {
    name: 'list_meetings',
    title: 'List meetings',
    description: 'Lists your recorded meetings, newest first. Optional text search (title, notes and transcript) and folder id.',
    scope: 'voice:read',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' }, folderId: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } },
    },
    run: async (ctx, a) => {
      const folderId = str(a.folderId, 64) || null;
      if (folderId && folderId !== 'none' && !(await ownsFolder(ctx.owner, folderId))) throw new McpToolError('folder_not_found');
      const sessions = await listSessions(ctx.owner, { kind: 'meeting', q: str(a.query, 200) ?? null, folderId, limit: int(a.limit, 25, 100) });
      return {
        meetings: sessions.map((s) => ({ id: s.id, title: s.title, startedAt: s.startedAt, durationMs: s.durationMs, folderId: s.folderId, match: s.match ?? null })),
      };
    },
  },
  {
    name: 'get_meeting',
    title: 'Get a meeting',
    description: 'Returns one meeting: AI notes (summary, sections, decisions, action items), your own notes, attendees and, if includeTranscript is true, the transcript.',
    scope: 'voice:read',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, includeTranscript: { type: 'boolean' }, format: { type: 'string', enum: ['json', 'markdown'] } },
      required: ['id'],
    },
    run: async (ctx, a) => {
      const id = str(a.id, 64);
      const d = id ? await getSessionDetail(ctx.owner, id) : null;
      if (!d || d.kind !== 'meeting') throw new McpToolError('not_found');
      if (a.format === 'markdown') return { markdown: meetingMarkdown(d, meetingLabels('en'), { transcript: a.includeTranscript === true }) };
      return {
        id: d.id,
        title: d.title,
        startedAt: d.startedAt,
        endedAt: d.endedAt,
        durationMs: d.durationMs,
        attendees: d.attendees,
        myNotes: d.myNotes,
        notes: d.enhanced ? { summary: d.enhanced.summary, sections: d.enhanced.sections, decisions: d.enhanced.decisions, actionItems: d.enhanced.actionItems } : null,
        transcript:
          a.includeTranscript === true
            ? d.segments.map((s) => ({ startMs: s.startMs, source: s.source, speaker: d.speakers[s.source === 'me' ? 'me' : s.speaker ? `${s.source}:${s.speaker}` : s.source] ?? (s.source === 'me' ? 'Me' : s.speaker ? `Speaker ${Number(s.speaker) + 1}` : 'Them'), text: s.text }))
            : undefined,
        transcriptDeleted: !!d.transcriptDeletedAt,
      };
    },
  },
  {
    name: 'ask_meetings',
    title: 'Ask your meetings',
    description: 'Answers a question from your meetings (the ones that mention the topic, or the latest ones), naming the meetings it used. Uses the workspace AI quota.',
    scope: 'voice:read',
    inputSchema: { type: 'object', properties: { question: { type: 'string' } }, required: ['question'] },
    run: async (ctx, a) => {
      const question = str(a.question, 2000);
      if (!question) throw new McpToolError('invalid_input');
      return askAcross({ owner: ctx.owner, question, locale: 'en', labels: meetingLabels('en') });
    },
  },
  {
    name: 'list_dictations',
    title: 'List dictations',
    description: 'Lists your recent dictations (the cleaned text), newest first.',
    scope: 'voice:read',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } } },
    run: async (ctx, a) => {
      const sessions = await listSessions(ctx.owner, { kind: 'dictation', q: str(a.query, 200) ?? null, limit: int(a.limit, 25, 100) });
      return { dictations: sessions.map((s) => ({ id: s.id, text: s.text, words: s.words, context: s.context, createdAt: s.startedAt })) };
    },
  },
  {
    name: 'list_folders',
    title: 'List folders',
    description: 'Lists your meeting folders (one level of subfolders) with how many meetings each has.',
    scope: 'voice:read',
    inputSchema: { type: 'object', properties: {} },
    run: async (ctx) => ({ folders: await listFolders(ctx.owner) }),
  },
];

export function voiceMcpTools(): Array<{ name: string; title: string; description: string; inputSchema: Json; annotations: Json }> {
  return TOOLS.map((t) => ({
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: t.inputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
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
export async function handleVoiceRpc(ctx: VoiceMcpContext, req: RpcRequest): Promise<RpcResponse | null> {
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
          serverInfo: { name: 'zerosoft-voice', title: 'zerosoft Voice', version: '1.0.0' },
          instructions:
            'Meeting notes and dictations of one zerosoft user (private to that user). list_meetings finds meetings, get_meeting returns the notes (and the transcript if asked), ask_meetings answers a question across meetings.',
        },
      };
    }
    case 'ping':
      return { jsonrpc: '2.0', id, result: {} };
    case 'tools/list':
      return { jsonrpc: '2.0', id, result: { tools: voiceMcpTools() } };
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
        const code = err instanceof McpToolError || err instanceof AiError ? err.code : 'server_error';
        if (!(err instanceof McpToolError) && code === 'server_error') console.error('[voice] mcp tool failed', (err as Error)?.name ?? 'error');
        return { jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text: `Error: ${code}` }] } };
      }
    }
    default:
      return rpcError(id, -32601, `Method not found: ${req.method}`);
  }
}
