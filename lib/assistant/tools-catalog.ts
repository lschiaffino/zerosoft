/**
 * El catálogo del MCP dentro del asistente: las mismas ~1.800 operaciones que
 * ven Claude Code y los demás clientes, con el mismo camino (invokeOperation:
 * handler real en proceso, identidad de la persona, scrub, paginación,
 * auditoría en mcp_audit_log). Así el panel llega a todo lo que no tiene una
 * herramienta propia (mensajes de Groups, issues de Track, páginas de Docs...).
 *
 * Lecturas: corren en el turno. Escrituras: como el resto del asistente, solo
 * preparan una tarjeta; se ejecutan al confirmar, con la sesión del clic.
 */
import { z } from 'zod';
import type { SessionUser } from '../session';
import { issuerUrl } from '../oauth/store';
import { APP_NAMES, getOperation, getWebOnly, OPERATIONS, operationTitle, searchOperations, summarize, webOnlyMessage, type Operation } from '../mcp/catalog';
import { personCanUseApp, type McpCaller } from '../mcp/caller';
import { invokeOperation, OperationError } from '../mcp/invoke';
import { readTool, writeTool, type AssistantTool, type ToolCtx } from './registry';

/** El asistente no se llama a sí mismo ni toca sus propias charlas por el catálogo. */
const SELF = /^\/api\/assistant(\/|$)/;

function usable(user: Pick<SessionUser, 'role' | 'apps'>, op: Operation): boolean {
  if (SELF.test(op.path)) return false;
  if ((user.role ?? 'owner') === 'guest') return false;
  return personCanUseApp({ role: user.role ?? 'owner', apps: user.apps ?? '*' }, op.app);
}

/** La sesión del panel como quien llama al catálogo: la persona en el workspace activo, sin tope de credencial. */
export function sessionCaller(user: SessionUser): McpCaller {
  const personId = user.actingUser?.id ?? user.id;
  return {
    kind: 'session',
    personId,
    teamId: user.actingUser ? (user.workspace?.id ?? null) : null,
    canWrite: true,
    clientId: null,
    clientName: 'Assistant',
    grantId: null,
    apiKeyId: null,
    rateKey: `assistant-op:${personId}`,
  };
}

const opInput = z.object({
  operation: z.string().trim().min(1).max(120).describe('Operation id from find_operations, such as v1.track.issues.get.'),
  args: z
    .record(z.unknown())
    .optional()
    .describe('Input with the shape from get_operation: { path, query, body }. Path parameters such as id go in path.'),
  offset: z.number().int().min(0).optional().describe('Where to continue a paginated result (page.nextOffset).'),
  limit: z.number().int().min(1).max(100).optional().describe('Items per page of a list.'),
});

function resolveOp(ctx: ToolCtx, id: string): Operation | { error: string; hint?: unknown } {
  const web = getWebOnly(id);
  if (web) return { error: 'web_only', hint: webOnlyMessage(web) };
  const op = getOperation(id);
  if (!op || !usable(ctx.user, op)) return { error: 'unknown_operation', hint: 'Use find_operations to get a valid id.' };
  return op;
}

async function run(ctx: ToolCtx, op: Operation, args: Record<string, unknown> | undefined, opts: { confirm?: boolean; offset?: number; limit?: number }) {
  try {
    const r = await invokeOperation(new Request(issuerUrl()), sessionCaller(ctx.user), op, args ?? {}, opts);
    return {
      ok: r.ok,
      status: r.status,
      data: r.data,
      ...(r.page ? { page: r.page } : {}),
      ...(r.truncated ? { truncated: true } : {}),
      ...(r.message ? { message: r.message } : {}),
    };
  } catch (err) {
    if (err instanceof OperationError) return { ok: false, error: err.code, message: err.message };
    throw err;
  }
}

function short(value: unknown, max = 160): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return (text ?? '').length > max ? `${text.slice(0, max - 1)}…` : (text ?? '');
}

/** Lo que va a pasar, para la tarjeta: la operación y cada campo que se manda. */
function describe(op: Operation, args: Record<string, unknown> | undefined) {
  const a = (args ?? {}) as { path?: Record<string, unknown>; query?: Record<string, unknown>; body?: unknown };
  const details: Array<{ label: string; after: string }> = [{ label: 'Operation', after: `${op.id} (${APP_NAMES[op.app] ?? op.app})` }];
  for (const [k, v] of Object.entries(a.path ?? {})) details.push({ label: k, after: short(v) });
  for (const [k, v] of Object.entries(a.query ?? {})) details.push({ label: k, after: short(v) });
  if (a.body && typeof a.body === 'object' && !Array.isArray(a.body)) {
    for (const [k, v] of Object.entries(a.body as Record<string, unknown>).slice(0, 12)) details.push({ label: k, after: short(v) });
  } else if (a.body !== undefined) details.push({ label: 'body', after: short(a.body) });
  return details;
}

function propose(destructive: boolean) {
  return writeTool({
    name: destructive ? 'propose_destructive_operation' : 'propose_operation',
    app: null,
    destructive,
    description: destructive
      ? 'Prepare a destructive catalog operation (access "destructive": deletes, sends a message or email outside the workspace, moves money). The person reviews a card and types a word to confirm. Nothing runs until then.'
      : 'Prepare a catalog operation that writes (access "write"): create or update an issue, a doc page, a contact, assign a chat... The person reviews a card and clicks Confirm. Nothing runs until then.',
    input: opInput.pick({ operation: true, args: true }).extend({
      summary: z.string().trim().min(3).max(200).describe('One sentence, in the language of the chat, saying what will change. Shown on the card.'),
    }),
    prepare: async (ctx, input: { operation: string; args?: Record<string, unknown>; summary: string }) => {
      const op = resolveOp(ctx, input.operation);
      if ('error' in op) return op;
      if (op.access === 'read') return { error: 'read_operation', hint: 'This operation only reads: call run_operation instead.' };
      if (destructive !== (op.access === 'destructive')) {
        return { error: destructive ? 'not_destructive' : 'destructive_operation', hint: destructive ? 'Use propose_operation for this one.' : 'Use propose_destructive_operation for this one.' };
      }
      return {
        summary: input.summary,
        details: describe(op, input.args),
        input: { operation: op.id, args: input.args ?? {} },
        ...(destructive ? { confirmText: op.method === 'DELETE' ? 'delete' : 'confirm' } : {}),
      };
    },
    execute: async (ctx, input) => {
      const op = resolveOp(ctx, String(input.operation));
      if ('error' in op) return { ok: false, error: op.error };
      const r = await run(ctx, op, input.args as Record<string, unknown>, { confirm: destructive });
      if (!r.ok) {
        const data = 'data' in r ? (r.data as { error?: unknown; message?: unknown } | null) : null;
        return { ok: false, error: short(('error' in r && r.error) || data?.error || data?.message || `status ${r.status ?? 'error'}`, 200) };
      }
      return { ok: true, message: `${operationTitle(op)}: done.` };
    },
  });
}

export const catalogTools: AssistantTool[] = [
  readTool({
    name: 'find_operations',
    app: null,
    description:
      'Search every operation of every app the person can use (the same catalog as the zerosoft MCP server): group chat messages, issues and comments, doc pages, boards, contacts and about 1,800 more. Use it whenever no other tool fits. Returns ids for get_operation, run_operation and propose_operation.',
    input: z.object({
      query: z.string().trim().max(120).describe('Words, such as "groups messages", "issue comment" or "docs page update".'),
      app: z.string().max(30).optional().describe('Limit to one app key, such as groups, track, docs, board or crm.'),
      access: z.enum(['read', 'write', 'destructive']).optional(),
    }),
    run: async (ctx, input: { query: string; app?: string; access?: 'read' | 'write' | 'destructive' }) => {
      const found = searchOperations({ query: input.query, app: input.app, access: input.access, allowed: (op) => usable(ctx.user, op) });
      return { total: found.length, operations: found.slice(0, 15).map(summarize) };
    },
  }),
  readTool({
    name: 'get_operation',
    app: null,
    description: 'The exact input schema of one operation from find_operations, and whether it reads, writes or is destructive.',
    input: opInput.pick({ operation: true }),
    run: async (ctx, input: { operation: string }) => {
      const op = resolveOp(ctx, input.operation);
      if ('error' in op) return op;
      return { ...summarize(op), doc: op.doc, inputSchema: op.inputSchema };
    },
  }),
  readTool({
    name: 'run_operation',
    app: null,
    description: 'Run a catalog operation that only reads (access "read"), as the person. To change something, use propose_operation or propose_destructive_operation.',
    input: opInput,
    run: async (ctx, input: { operation: string; args?: Record<string, unknown>; offset?: number; limit?: number }) => {
      const op = resolveOp(ctx, input.operation);
      if ('error' in op) return op;
      if (op.access !== 'read') {
        return { error: 'needs_confirmation', hint: op.access === 'destructive' ? 'Use propose_destructive_operation.' : 'Use propose_operation.' };
      }
      return run(ctx, op, input.args, { offset: input.offset, limit: input.limit ?? 25 });
    },
  }),
  propose(false),
  propose(true),
];

/** Para los tests: cuántas operaciones del catálogo alcanza una sesión. */
export function catalogReach(user: Pick<SessionUser, 'role' | 'apps'>): number {
  return OPERATIONS.filter((op) => usable(user, op)).length;
}
