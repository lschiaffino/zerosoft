/**
 * Ejecuta una operación del catálogo llamando al handler real de su ruta, en
 * proceso, con la identidad de la persona. No hay HTTP interno: nada de lo que
 * manda el cliente elige host o path, solo una entrada de ROUTE_TABLE. Todos
 * los chequeos de la ruta (rol, acceso por app, permisos por registro, topes de
 * plan, rate limits) corren igual que desde la app.
 */
import { randomBytes } from 'crypto';
import { NextRequest } from 'next/server';
import { getDb } from '../db';
import { clientIp, rateLimit } from '../rate-limit';
import { issuerUrl } from '../oauth/store';
import type { RouteContext, RouteModule } from '../routes/dispatch';
import type { Operation } from './catalog';
import { credentialAllows, personCanUseApp, resolvePerson, type McpCaller, type ResolvedPerson } from './caller';
import { runAsDelegated } from './identity';
import { ROUTE_TABLE } from './route-table.generated';
import { REDACTED, scrubLooseText, scrubSecrets } from './scrub';

/** Lo que se devuelve al modelo por llamada (el resto se pagina). */
export const MAX_OUTPUT_CHARS = 60_000;
/** Lo que se lee de la respuesta de una ruta. */
const MAX_READ_BYTES = 8 * 1024 * 1024;
const MAX_BODY_BYTES = 4 * 1024 * 1024;
const MAX_BINARY_INLINE_BYTES = 256 * 1024;
const OPERATION_TIMEOUT_MS = 55_000;

const READS_PER_MIN = 300;
const WRITES_PER_MIN = 60;

export class OperationError extends Error {
  constructor(
    public code:
      | 'invalid_arguments'
      | 'insufficient_scope'
      | 'app_not_available'
      | 'workspace_access_lost'
      | 'confirmation_required'
      | 'rate_limited'
      | 'timeout'
      | 'web_only',
    message: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export interface InvokeArgs {
  path?: Record<string, unknown>;
  query?: Record<string, unknown>;
  body?: unknown;
  /** Para operaciones multipart. */
  files?: Array<{ field?: string; filename?: string; contentType?: string; base64?: string }>;
  [flat: string]: unknown;
}

export interface InvokeOptions {
  confirm?: boolean;
  offset?: number;
  limit?: number;
}

export interface InvokeResult {
  ok: boolean;
  status: number;
  contentType: string | null;
  data: unknown;
  page?: { offset: number; limit: number; total: number; field: string | null; nextOffset: number | null };
  truncated?: boolean;
  message?: string;
}

/** Binarios que pueden volver en base64. Un JSON o un texto disfrazado de binario, no. */
const INLINE_BINARY = /^(image\/(png|jpe?g|gif|webp|avif)|application\/pdf|audio\/[a-z0-9.+-]+|video\/[a-z0-9.+-]+)$/;

/** Reglas sobre la entrada que dependen del valor, no solo de la operación. */
function assertPolicy(op: Operation, body: unknown): void {
  const key = `${op.method} ${op.path}`;
  if (key === 'POST /api/teams/invites' || key === 'PATCH /api/teams/members/[userId]') {
    const role = (body as { role?: unknown } | null)?.role;
    if (role === 'admin' || role === 'owner') {
      throw new OperationError('web_only', 'Giving someone the admin or owner role is done in zerosoft: Settings, Members. Member invitations work here, and the person gets the link by email.', { where: 'Settings, Members' });
    }
  }
  // Devolver lo que salió tapado pisaría el secreto de verdad con el texto de la marca.
  if (body !== undefined && JSON.stringify(body)?.includes(REDACTED)) {
    throw new OperationError('invalid_arguments', `The body contains ${REDACTED}, a value hidden from this connection. Leave that field out so it keeps its current value.`);
  }
}

const shouldAudit = (op: Operation) => op.access !== 'read' || op.audit === true;

const PARAM_VALUE = /^[^/\\\u0000-\u001f\u007f]{1,512}$/;

function safeParam(name: string, value: unknown): string {
  const text = typeof value === 'number' ? String(value) : value;
  if (typeof text !== 'string' || !PARAM_VALUE.test(text) || text === '.' || text === '..') {
    throw new OperationError('invalid_arguments', `Invalid path parameter "${name}".`);
  }
  return text;
}

/** Separa args planos: lo que es parámetro de path va al path, lo que declara la query a la query, el resto al body. */
export function normalizeArgs(op: Operation, args: InvokeArgs): { path: Record<string, unknown>; query: Record<string, unknown>; body: unknown } {
  const path: Record<string, unknown> = { ...(args.path ?? {}) };
  const query: Record<string, unknown> = { ...(args.query ?? {}) };
  let body: unknown = args.body;
  const queryProps = (op.inputSchema.properties.query?.properties ?? {}) as Record<string, unknown>;
  const flatBody: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (k === 'path' || k === 'query' || k === 'body' || k === 'files') continue;
    if (op.params.includes(k)) path[k] = v;
    else if (k in queryProps || op.method === 'GET' || op.method === 'DELETE') query[k] = v;
    else flatBody[k] = v;
  }
  if (Object.keys(flatBody).length) {
    if (body === undefined) body = flatBody;
    else if (body && typeof body === 'object' && !Array.isArray(body)) body = { ...(body as object), ...flatBody };
  }
  return { path, query, body };
}

export function buildRoute(op: Operation, pathArgs: Record<string, unknown>): { url: string; params: Record<string, string | string[]> } {
  const params: Record<string, string | string[]> = {};
  const parts: string[] = [];
  for (const seg of op.path.split('/').slice(1)) {
    if (!seg.startsWith('[')) {
      parts.push(seg);
      continue;
    }
    const name = seg.replace(/[[\].]/g, '');
    const catchAll = seg.includes('...');
    const value = pathArgs[name];
    if (value === undefined || value === null || value === '') {
      if (seg.startsWith('[[')) continue;
      throw new OperationError('invalid_arguments', `Missing path parameter "${name}".`);
    }
    if (catchAll) {
      const list = Array.isArray(value) ? value : String(value).split('/');
      const clean = list.map((v) => safeParam(name, v));
      params[name] = clean;
      parts.push(...clean.map(encodeURIComponent));
    } else {
      const clean = safeParam(name, value);
      params[name] = clean;
      parts.push(encodeURIComponent(clean));
    }
  }
  const unknown = Object.keys(pathArgs).filter((k) => !op.params.includes(k));
  if (unknown.length) throw new OperationError('invalid_arguments', `Unknown path parameter "${unknown[0]}".`);
  return { url: `/${parts.join('/')}`, params };
}

function appendQuery(url: URL, query: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) for (const item of v) url.searchParams.append(k, typeof item === 'object' ? JSON.stringify(item) : String(item));
    else url.searchParams.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  }
}

function buildBody(op: Operation, body: unknown, files: InvokeArgs['files']): { init: BodyInit | undefined; contentType: string | null } {
  if (op.method === 'GET') return { init: undefined, contentType: null };
  if (files?.length && op.body !== 'form' && op.body !== 'both') throw new OperationError('invalid_arguments', 'This operation does not take files.');
  if (op.body === 'form' || (op.body === 'both' && files?.length)) {
    const form = new FormData();
    if (body && typeof body === 'object') {
      for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
        if (v !== undefined && v !== null) form.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
      }
    }
    let total = 0;
    for (const f of files ?? []) {
      if (typeof f.base64 !== 'string') throw new OperationError('invalid_arguments', 'Each file needs base64 content.');
      const bytes = Buffer.from(f.base64, 'base64');
      total += bytes.length;
      if (total > MAX_BODY_BYTES) throw new OperationError('invalid_arguments', 'Files over 4 MB do not fit in one call.');
      form.append(f.field || 'file', new Blob([new Uint8Array(bytes)], { type: f.contentType || 'application/octet-stream' }), f.filename || 'file');
    }
    return { init: form, contentType: null };
  }
  if (body === undefined) return { init: op.body === 'none' ? undefined : '{}', contentType: op.body === 'none' ? null : 'application/json' };
  const text = JSON.stringify(body);
  if (text.length > MAX_BODY_BYTES) throw new OperationError('invalid_arguments', 'The body is larger than 4 MB.');
  return { init: text, contentType: 'application/json' };
}

async function readCapped(res: Response): Promise<{ bytes: Uint8Array; capped: boolean }> {
  if (!res.body) return { bytes: new Uint8Array(), capped: false };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let capped = false;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    chunks.push(value);
    total += value.length;
    if (total >= MAX_READ_BYTES) {
      capped = true;
      await reader.cancel().catch(() => undefined);
      break;
    }
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return { bytes: out, capped };
}

function largestArray(data: unknown): { field: string | null; list: unknown[] } | null {
  if (Array.isArray(data)) return { field: null, list: data };
  if (!data || typeof data !== 'object') return null;
  let best: { field: string; list: unknown[] } | null = null;
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    if (Array.isArray(v) && (!best || v.length > best.list.length)) best = { field: k, list: v };
  }
  return best;
}

/** Corta por tamaño: pagina el arreglo más grande de la respuesta, sin volver a pedirle nada a la ruta. */
export function paginate(data: unknown, opts: InvokeOptions): Pick<InvokeResult, 'data' | 'page' | 'truncated'> {
  const size = JSON.stringify(data)?.length ?? 0;
  const arr = largestArray(data);
  const offset = Math.max(0, Math.floor(opts.offset ?? 0));
  const asked = opts.limit ? Math.max(1, Math.min(500, Math.floor(opts.limit))) : null;
  if (size <= MAX_OUTPUT_CHARS && !asked && !offset) return { data };
  if (!arr) {
    if (size <= MAX_OUTPUT_CHARS) return { data };
    return { data: JSON.stringify(data).slice(0, MAX_OUTPUT_CHARS), truncated: true };
  }
  const shell = arr.field ? { ...(data as Record<string, unknown>), [arr.field]: [] } : [];
  const room = Math.max(1000, MAX_OUTPUT_CHARS - (JSON.stringify(shell)?.length ?? 0));
  const page: unknown[] = [];
  let used = 0;
  let i = offset;
  for (; i < arr.list.length; i++) {
    if (asked && page.length >= asked) break;
    const itemSize = JSON.stringify(arr.list[i])?.length ?? 0;
    if (used + itemSize > room && page.length) break;
    if (itemSize > room) {
      page.push({ truncated: true, preview: JSON.stringify(arr.list[i]).slice(0, room - 100) });
      used += room;
      i += 1;
      break;
    }
    page.push(arr.list[i]);
    used += itemSize;
  }
  const out = arr.field ? { ...(data as Record<string, unknown>), [arr.field]: page } : page;
  return {
    data: out,
    page: { offset, limit: page.length, total: arr.list.length, field: arr.field, nextOffset: i < arr.list.length ? i : null },
  };
}

async function writeAudit(caller: McpCaller, person: ResolvedPerson | null, op: Operation, status: number, ms: number): Promise<void> {
  try {
    await getDb()
      .prepare(
        `INSERT INTO mcp_audit_log (id, user_id, workspace_id, client_id, client_name, grant_id, api_key_id, operation, access, status, duration_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(randomBytes(12).toString('base64url'), caller.personId, person?.workspace?.id ?? null, caller.clientId, caller.clientName.slice(0, 120), caller.grantId, caller.apiKeyId, op.id, op.access, status, ms);
    // Retención: 180 días, de a poco y sin cron.
    if (Math.random() < 0.01) {
      await getDb().prepare(`DELETE FROM mcp_audit_log WHERE id IN (SELECT id FROM mcp_audit_log WHERE at < datetime('now', '-180 days') LIMIT 500)`).run();
    }
  } catch (err) {
    // Nunca el cuerpo ni los argumentos: solo el nombre del error.
    console.error('[mcp] audit failed', err instanceof Error ? err.name : 'error');
  }
}

async function enforceRate(caller: McpCaller, op: Operation): Promise<void> {
  if (process.env.RATE_LIMIT_DISABLED === 'true') return;
  const write = op.access !== 'read';
  const res = await rateLimit(`${caller.rateKey}:${write ? 'w' : 'r'}`, write ? WRITES_PER_MIN : READS_PER_MIN, 60);
  if (!res.ok) {
    throw new OperationError('rate_limited', `Too many ${write ? 'writes' : 'reads'} from this connection. Try again in a minute.`, {
      retryAfter: Math.max(1, Math.ceil((res.resetAt - Date.now()) / 1000)),
    });
  }
}

export async function invokeOperation(outer: Request, caller: McpCaller, op: Operation, args: InvokeArgs, opts: InvokeOptions = {}): Promise<InvokeResult> {
  // 1. Tope de la credencial (scope read, scopes de la key).
  if (!credentialAllows(caller, op)) {
    throw new OperationError(
      'insufficient_scope',
      caller.kind === 'oauth' ? `This connection is read-only and ${op.id} is a ${op.access} operation. Reconnect and approve read and write.` : `This API key has no scope for ${op.id}.`,
      { required_scope: 'write' },
    );
  }
  // 2. La persona, ahora: si salió del workspace o ya no tiene la app, se corta acá.
  const person = await resolvePerson(caller);
  if (!person) throw new OperationError('workspace_access_lost', 'You are no longer part of this workspace. Use switch_workspace or reconnect.');
  if (!personCanUseApp(person, op.app)) throw new OperationError('app_not_available', `You do not have access to ${op.app} in this workspace.`);
  // 3. Lo destructivo pide que el cliente lo confirme explícitamente.
  if (op.access === 'destructive' && opts.confirm !== true) {
    throw new OperationError('confirmation_required', `${op.id} is destructive. Ask the person first, then call again with confirm: true.`);
  }
  await enforceRate(caller, op);

  const { path, query, body } = normalizeArgs(op, args);
  assertPolicy(op, body);
  const route = buildRoute(op, path);
  const url = new URL(route.url, issuerUrl());
  appendQuery(url, query);
  const { init, contentType } = buildBody(op, body, args.files);
  const loader = ROUTE_TABLE[op.path];
  if (!loader) throw new OperationError('invalid_arguments', 'This operation is not available.');

  const headers = new Headers({ accept: 'application/json', 'user-agent': 'zerosoft-mcp' });
  if (contentType) headers.set('content-type', contentType);
  // Sin cookies ni Authorization del pedido externo. La IP sigue siendo la real para los rate limits por IP.
  const ip = clientIp(outer);
  if (ip && ip !== 'unknown') headers.set('x-forwarded-for', ip);

  const started = Date.now();
  // Un solo plazo para el handler y para leer su respuesta. Al vencer se le avisa al handler por req.signal.
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      abort.abort();
      reject(
        new OperationError(
          'timeout',
          op.access === 'read' ? 'The operation took too long.' : 'The operation took too long and its outcome is unknown. Check whether it happened before trying again.',
          { outcome: 'unknown' },
        ),
      );
    }, Number(process.env.MCP_OPERATION_TIMEOUT_MS) || OPERATION_TIMEOUT_MS);
    timer.unref?.();
  });
  try {
    let res: Response;
    try {
      const mod = (await Promise.race([loader(), deadline])) as RouteModule;
      const handler = mod[op.method];
      if (!handler) throw new OperationError('invalid_arguments', 'This operation is not available.');
      const inner = new NextRequest(url, { method: op.method, headers, body: init, signal: abort.signal });
      const ctx: RouteContext = { params: Promise.resolve(route.params) };
      const run = runAsDelegated(person.identity(url.pathname), async () => {
        const out = await handler(inner, ctx);
        if (!out) throw new Error('empty_response');
        return out as Response;
      });
      res = await Promise.race([run, deadline]);
    } catch (err) {
      if (err instanceof OperationError) {
        if (shouldAudit(op)) await writeAudit(caller, person, op, err.code === 'timeout' ? 504 : 400, Date.now() - started);
        throw err;
      }
      // redirect() de Next, por ejemplo: sin detalles internos hacia el modelo.
      console.error('[mcp] operation failed', op.id, err instanceof Error ? err.name : 'error');
      if (shouldAudit(op)) await writeAudit(caller, person, op, 500, Date.now() - started);
      return { ok: false, status: 500, contentType: null, data: { error: 'server_error' } };
    }
    if (shouldAudit(op)) await writeAudit(caller, person, op, res.status, Date.now() - started);
    return await Promise.race([interpretResponse(res, opts), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

async function interpretResponse(res: Response, opts: InvokeOptions): Promise<InvokeResult> {
  const type = res.headers.get('content-type');
  const base = { ok: res.ok, status: res.status, contentType: type };
  if (res.status >= 300 && res.status < 400) {
    await res.body?.cancel().catch(() => undefined);
    return { ...base, data: null, message: 'This operation answered with a browser redirect. Open it in zerosoft.' };
  }
  const { bytes, capped } = await readCapped(res);
  const media = (type ?? '').split(';')[0].trim().toLowerCase();
  const isJson = media === 'application/json' || media.endsWith('+json');
  const isText = media.startsWith('text/') || media === 'application/xml' || media === 'application/javascript' || media === 'image/svg+xml' || !media;
  if (isJson) {
    const text = new TextDecoder().decode(bytes);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ...base, data: scrubLooseText(text).slice(0, MAX_OUTPUT_CHARS), truncated: capped || text.length > MAX_OUTPUT_CHARS };
    }
    const clean = scrubSecrets(parsed);
    return { ...base, ...paginate(clean, opts), ...(capped ? { truncated: true } : {}) };
  }
  if (isText) {
    const text = scrubLooseText(new TextDecoder().decode(bytes));
    const offset = Math.max(0, Math.floor(opts.offset ?? 0));
    const slice = text.slice(offset, offset + MAX_OUTPUT_CHARS);
    const next = offset + slice.length < text.length ? offset + slice.length : null;
    return {
      ...base,
      data: slice,
      ...(next !== null || offset ? { page: { offset, limit: slice.length, total: text.length, field: null, nextOffset: next } } : {}),
      ...(capped ? { truncated: true } : {}),
    };
  }
  if (!INLINE_BINARY.test(media)) {
    return { ...base, data: { binary: true, contentType: type, size: bytes.length }, message: 'This file type does not come back through MCP. Download it from zerosoft.' };
  }
  if (bytes.length <= MAX_BINARY_INLINE_BYTES) {
    return { ...base, data: { binary: true, contentType: type, size: bytes.length, base64: Buffer.from(bytes).toString('base64') } };
  }
  return { ...base, data: { binary: true, contentType: type, size: capped ? `over ${MAX_READ_BYTES}` : bytes.length }, message: 'This file is too large to return through MCP. Download it from zerosoft.' };
}
