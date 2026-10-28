/**
 * Flow — nodos de integraciones nativas (Slack, Google Sheets, Gmail, Stripe,
 * Notion, Discord, Telegram) y verificación de webhooks de Stripe.
 * Server-only. Todo el HTTP sale por safeFetch (guardia SSRF) hacia las APIs
 * REST oficiales; las credenciales llegan ya descifradas y el motor redacta
 * sus valores en pasos y errores.
 *
 * Cada nodo recibe la config ya renderizada ({{...}} resuelto) y la valida con
 * su esquema zod antes de llamar a la API.
 */
import { createHmac, createSign, timingSafeEqual } from 'crypto';
import { z } from 'zod';
import { StepError } from './flow-errors';
import type { ResolvedCredential } from './flow-credentials';
import type { CredentialType } from './flow-credentials-schema';
import { safeFetch, UnsafeUrlError } from './safe-fetch';

export interface IntegrationContext {
  workspaceId: string;
  /** Persona que creó el flow o editó por última vez sus nodos Gmail (remitente); null = dueño del workspace. */
  actorId: string | null;
  runId: string;
  nodeId: string;
  /** Índice de la iteración si el nodo corre dentro de un Loop. */
  loopIndex?: number;
  /** Credencial del workspace con uno de los tipos permitidos (o StepError). */
  credential(id: unknown, types: readonly CredentialType[]): Promise<ResolvedCredential>;
  /** Valor sensible derivado (p. ej. un access token emitido) para redactar. */
  addSecret(value: string): void;
}

const TIMEOUT_MS = 15_000;
const BODY_LIMIT = 1_000_000;

interface ApiResponse {
  status: number;
  ok: boolean;
  body: unknown;
  text: string;
}

async function call(url: string, init: RequestInit, timeoutMs = TIMEOUT_MS): Promise<ApiResponse> {
  let res: Response;
  try {
    res = await safeFetch(url, { ...init, headers: { 'user-agent': 'Zerosoft-Flow/1', ...(init.headers ?? {}) } }, timeoutMs);
  } catch (err) {
    if (err instanceof UnsafeUrlError) throw new StepError(err.message);
    throw new StepError(err instanceof Error && err.name === 'TimeoutError' ? 'timeout' : 'network_error', true);
  }
  const text = (await res.text().catch(() => '')).slice(0, BODY_LIMIT);
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, ok: res.ok, body, text };
}

function httpFailure(prefix: string, res: ApiResponse, code?: string): StepError {
  const retryable = res.status === 429 || res.status >= 500;
  return new StepError(code ? `${prefix}_${code}` : `${prefix}_http_${res.status}`, retryable, { status: res.status, body: res.body });
}

function parseConfig<T extends z.ZodTypeAny>(schema: T, cfg: Record<string, unknown>): z.infer<T> {
  const parsed = schema.safeParse(cfg);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = String(issue?.path[0] ?? 'config');
    throw new StepError(`missing_${field.replace(/[^A-Za-z0-9_]/g, '').toLowerCase()}`);
  }
  return parsed.data;
}

const text = (max: number) => z.preprocess((v) => (v === undefined || v === null ? '' : String(v).trim()), z.string().max(max));
const required = (max: number) => z.preprocess((v) => (v === undefined || v === null ? '' : String(v).trim()), z.string().min(1).max(max));

/** Filas clave/valor ya renderizadas → array de valores (orden de las filas). */
function rowValues(rows: unknown): unknown[] {
  if (!Array.isArray(rows)) return [];
  return rows.slice(0, 200).map((r) => {
    const v = (r as { value?: unknown })?.value;
    return v === undefined || v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : v;
  });
}

function paragraphs(content: string): string[] {
  return content
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .slice(0, 100)
    .map((p) => p.slice(0, 2000));
}

// ---------- Slack ----------

export const slackConfigSchema = z.object({
  credentialId: required(100),
  channel: text(200),
  text: required(40_000),
});

export async function slackNode(ctx: IntegrationContext, cfg: Record<string, unknown>) {
  const c = parseConfig(slackConfigSchema, cfg);
  const cred = await ctx.credential(c.credentialId, ['slack']);
  if (cred.data.botToken && c.channel) {
    const res = await call('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { authorization: `Bearer ${cred.data.botToken}`, 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ channel: c.channel, text: c.text }),
    });
    const body = (res.body ?? {}) as { ok?: boolean; error?: string; ts?: string; channel?: string };
    if (!res.ok) throw httpFailure('slack', res);
    if (!body.ok) throw new StepError(`slack_${body.error ?? 'error'}`, body.error === 'ratelimited', { body });
    return { ok: true, via: 'bot', channel: body.channel ?? c.channel, ts: body.ts ?? null };
  }
  if (!cred.data.webhookUrl) throw new StepError(cred.data.botToken ? 'missing_channel' : 'missing_webhook');
  const res = await call(cred.data.webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: c.text }),
  });
  if (!res.ok) throw httpFailure('slack', res);
  return { ok: true, via: 'webhook', channel: null, ts: null };
}

/**
 * Pedido de aprobación en Slack (nodo Aprobación): el texto y dos botones
 * que abren la página de aprobación con la decisión elegida. Son botones de
 * link (Block Kit), así que no hace falta configurar interactividad en la
 * app de Slack; la decisión se confirma en la página.
 */
export async function slackApprovalMessage(
  ctx: IntegrationContext,
  opts: { credentialId: string; channel: string; text: string; approveUrl: string; rejectUrl: string; approveLabel: string; rejectLabel: string },
) {
  const cred = await ctx.credential(opts.credentialId, ['slack']);
  const blocks = [
    { type: 'section', text: { type: 'mrkdwn', text: opts.text.slice(0, 2900) } },
    {
      type: 'actions',
      elements: [
        { type: 'button', style: 'primary', text: { type: 'plain_text', text: opts.approveLabel }, url: opts.approveUrl },
        { type: 'button', style: 'danger', text: { type: 'plain_text', text: opts.rejectLabel }, url: opts.rejectUrl },
      ],
    },
  ];
  const payload = { text: opts.text.slice(0, 2900), blocks };
  if (cred.data.botToken && opts.channel) {
    const res = await call('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { authorization: `Bearer ${cred.data.botToken}`, 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ channel: opts.channel, ...payload }),
    });
    const body = (res.body ?? {}) as { ok?: boolean; error?: string; ts?: string; channel?: string };
    if (!res.ok) throw httpFailure('slack', res);
    if (!body.ok) throw new StepError(`slack_${body.error ?? 'error'}`, body.error === 'ratelimited', { body });
    return { via: 'bot', channel: body.channel ?? opts.channel, ts: body.ts ?? null };
  }
  if (!cred.data.webhookUrl) throw new StepError(cred.data.botToken ? 'missing_channel' : 'missing_webhook');
  const res = await call(cred.data.webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw httpFailure('slack', res);
  return { via: 'webhook', channel: null, ts: null };
}

// ---------- Google (Sheets) ----------

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url');
}

/** JWT firmado (RS256) de una cuenta de servicio, para el token de Google. */
export function serviceAccountAssertion(sa: { client_email: string; private_key: string }, scope: string, now = Date.now()): string {
  const iat = Math.floor(now / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({ iss: sa.client_email, scope, aud: GOOGLE_TOKEN_URL, iat, exp: iat + 3600 }));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  return `${header}.${claims}.${signer.sign(sa.private_key).toString('base64url')}`;
}

async function googleToken(ctx: IntegrationContext, cred: ResolvedCredential, scope: string): Promise<string> {
  if (cred.data.accessToken) return cred.data.accessToken;
  let sa: { client_email?: string; private_key?: string };
  try {
    sa = JSON.parse(cred.data.serviceAccountJson ?? '') as typeof sa;
  } catch {
    throw new StepError('google_invalid_credential');
  }
  if (!sa.client_email || !sa.private_key) throw new StepError('google_invalid_credential');
  let assertion: string;
  try {
    assertion = serviceAccountAssertion({ client_email: sa.client_email, private_key: sa.private_key }, scope);
  } catch {
    throw new StepError('google_invalid_credential');
  }
  const res = await call(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
  });
  const token = (res.body as { access_token?: string } | null)?.access_token;
  if (!res.ok || !token) throw httpFailure('google_token', res);
  ctx.addSecret(token);
  return token;
}

export const sheetsConfigSchema = z.object({
  credentialId: required(100),
  operation: z.enum(['append', 'read', 'lookup', 'update']).default('append'),
  spreadsheetId: z.preprocess(
    (v) => String(v ?? '').trim(),
    z.string().regex(/^[A-Za-z0-9_-]{10,200}$/),
  ),
  range: z.preprocess((v) => String(v ?? '').trim() || 'Sheet1', z.string().min(1).max(200)),
  row: z.array(z.unknown()).max(200).optional(),
  lookupColumn: text(200).optional(),
  lookupValue: text(2000).optional(),
  values: z.array(z.unknown()).max(200).optional(),
});

/** Nombre de la hoja de un rango ("Hoja 1!A1:C9" → "Hoja 1"; sin "!" es la hoja entera). */
export function sheetName(range: string): string {
  const i = range.lastIndexOf('!');
  return (i >= 0 ? range.slice(0, i) : range).replace(/^'|'$/g, '');
}

/** Letra de columna (0 → A, 26 → AA). */
export function columnLetter(index: number): string {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/**
 * Filas cuyo valor en la columna (por encabezado, sin distinguir mayúsculas)
 * es igual al buscado. rowNumber es el número de fila en la hoja (1 = encabezado).
 */
export function lookupSheetRows(values: unknown[][], column: string, value: string): Array<{ rowNumber: number; row: Record<string, unknown> }> {
  if (values.length < 2) return [];
  const head = values[0].map((h) => String(h ?? '').trim().toLowerCase());
  const col = head.indexOf(column.trim().toLowerCase());
  if (col < 0) return [];
  const objects = sheetRowsToObjects(values);
  const out: Array<{ rowNumber: number; row: Record<string, unknown> }> = [];
  values.slice(1).forEach((r, i) => {
    if (String(r[col] ?? '').trim() === value.trim()) out.push({ rowNumber: i + 2, row: objects[i] });
  });
  return out;
}

/** Filas → objetos usando la primera como encabezado. */
export function sheetRowsToObjects(values: unknown[][]): Array<Record<string, unknown>> {
  if (values.length < 2) return [];
  const head = values[0].map((h, i) => String(h ?? '').trim() || `col${i + 1}`);
  return values.slice(1).map((r) => {
    const o: Record<string, unknown> = {};
    head.forEach((h, i) => {
      o[h] = r[i] ?? '';
    });
    return o;
  });
}

export async function googleSheetsNode(ctx: IntegrationContext, cfg: Record<string, unknown>) {
  const c = parseConfig(sheetsConfigSchema, cfg);
  const cred = await ctx.credential(c.credentialId, ['google', 'oauth_token']);
  const token = cred.type === 'oauth_token' ? cred.data.accessToken : await googleToken(ctx, cred, SHEETS_SCOPE);
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(c.spreadsheetId)}/values/${encodeURIComponent(c.range)}`;
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  if (c.operation === 'read') {
    const res = await call(base, { method: 'GET', headers });
    if (!res.ok) throw httpFailure('sheets', res);
    const values = (((res.body ?? {}) as { values?: unknown[][] }).values ?? []).slice(0, 5000);
    return { range: (res.body as { range?: string })?.range ?? c.range, count: Math.max(values.length - 1, 0), values, rows: sheetRowsToObjects(values) };
  }
  if (c.operation === 'lookup' || c.operation === 'update') {
    if (!c.lookupColumn) throw new StepError('missing_lookupcolumn');
    // Se lee la hoja entera (encabezado incluido) para ubicar la fila.
    const sheet = sheetName(c.range);
    const whole = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(c.spreadsheetId)}/values/${encodeURIComponent(sheet)}`;
    const res = await call(whole, { method: 'GET', headers });
    if (!res.ok) throw httpFailure('sheets', res);
    const values = (((res.body ?? {}) as { values?: unknown[][] }).values ?? []).slice(0, 20_000);
    const head = (values[0] ?? []).map((h) => String(h ?? '').trim());
    if (!head.some((h) => h.toLowerCase() === c.lookupColumn!.toLowerCase())) throw new StepError('sheets_column_not_found', false, { column: c.lookupColumn });
    const matches = lookupSheetRows(values, c.lookupColumn, c.lookupValue ?? '');
    if (c.operation === 'lookup') {
      return { found: matches.length > 0, count: matches.length, rowNumber: matches[0]?.rowNumber ?? null, row: matches[0]?.row ?? null, rows: matches.slice(0, 500) };
    }
    if (!matches.length) return { updated: false, found: false, rowNumber: null };
    const updates = (Array.isArray(c.values) ? (c.values as Array<{ key?: unknown; value?: unknown }>) : [])
      .map((r) => ({ col: head.findIndex((h) => h.toLowerCase() === String(r?.key ?? '').trim().toLowerCase()), value: r?.value }))
      .filter((u) => u.col >= 0);
    if (updates.length === 0) throw new StepError('missing_values');
    const rowNumber = matches[0].rowNumber;
    const data = updates.map((u) => ({
      range: `'${sheet.replace(/'/g, "''")}'!${columnLetter(u.col)}${rowNumber}`,
      values: [[u.value === undefined || u.value === null ? '' : typeof u.value === 'object' ? JSON.stringify(u.value) : u.value]],
    }));
    const put = await call(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(c.spreadsheetId)}/values:batchUpdate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data }),
    });
    if (!put.ok) throw httpFailure('sheets', put);
    return { updated: true, found: true, rowNumber, columns: updates.map((u) => head[u.col]) };
  }
  const row = rowValues(c.row);
  if (row.length === 0) throw new StepError('missing_row');
  const res = await call(`${base}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ values: [row] }),
  });
  if (!res.ok) throw httpFailure('sheets', res);
  const updates = ((res.body ?? {}) as { updates?: { updatedRange?: string; updatedRows?: number } }).updates ?? {};
  return { appended: true, updatedRange: updates.updatedRange ?? null, updatedRows: updates.updatedRows ?? 1, row };
}

// ---------- Gmail ----------

const EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

export const gmailConfigSchema = z.object({
  to: required(500),
  subject: text(300),
  body: required(100_000),
});

/**
 * Envía desde el Gmail conectado (CRM) de quien creó el flow (o editó su nodo
 * Gmail). Nunca usa otra casilla: si esa persona ya no es del workspace o no
 * tiene Gmail conectado, falla con gmail_not_connected.
 */
export async function gmailNode(ctx: IntegrationContext, cfg: Record<string, unknown>, flowName: string) {
  const c = parseConfig(gmailConfigSchema, cfg);
  const recipients = c.to.split(/[,;]\s*/).map((x) => x.trim()).filter(Boolean);
  if (recipients.length === 0 || recipients.length > 20 || !recipients.every((r) => EMAIL_RE.test(r))) {
    throw new StepError('missing_recipient');
  }
  const { gmailSender } = await import('./crm-email');
  const { buildMime, gmailSend, GmailApiError } = await import('./gmail');
  const { isWorkspacePerson } = await import('./crm-refs');
  const actor = ctx.actorId ?? ctx.workspaceId;
  const sender = (await isWorkspacePerson(ctx.workspaceId, actor)) ? await gmailSender(actor) : null;
  if (!sender) throw new StepError('gmail_not_connected');
  ctx.addSecret(sender.token);
  const mime = buildMime({ from: sender.email, to: recipients.join(', '), subject: c.subject || flowName, text: c.body });
  try {
    const sent = await gmailSend(sender.token, mime);
    return { sent: true, from: sender.email, to: recipients, subject: c.subject || flowName, id: sent.id, threadId: sent.threadId };
  } catch (err) {
    if (err instanceof GmailApiError) throw new StepError(`gmail_${err.status || 'network_error'}`, err.status === 0 || err.status === 429 || err.status >= 500);
    throw new StepError('gmail_error', true);
  }
}

// ---------- Stripe ----------

export const stripeConfigSchema = z.object({
  credentialId: required(100),
  operation: z.enum(['create_customer', 'list_payments']).default('create_customer'),
  email: text(300),
  name: text(300),
  description: text(1000),
  limit: z.preprocess((v) => Math.min(Math.max(Math.floor(Number(v) || 10), 1), 100), z.number()),
});

function stripeFailure(res: ApiResponse): StepError {
  const err = ((res.body ?? {}) as { error?: { type?: string; code?: string } }).error;
  return httpFailure('stripe', res, err?.code ?? err?.type);
}

export async function stripeNode(ctx: IntegrationContext, cfg: Record<string, unknown>) {
  const c = parseConfig(stripeConfigSchema, cfg);
  const cred = await ctx.credential(c.credentialId, ['stripe']);
  const auth = { authorization: `Bearer ${cred.data.secretKey}` };
  if (c.operation === 'list_payments') {
    const res = await call(`https://api.stripe.com/v1/payment_intents?limit=${c.limit}`, { method: 'GET', headers: auth });
    if (!res.ok) throw stripeFailure(res);
    const data = (((res.body ?? {}) as { data?: Array<Record<string, unknown>> }).data ?? []).map((p) => ({
      id: p.id,
      amount: p.amount,
      currency: p.currency,
      status: p.status,
      created: p.created,
      customer: p.customer ?? null,
      description: p.description ?? null,
    }));
    return { count: data.length, payments: data };
  }
  if (c.email && !EMAIL_RE.test(c.email)) throw new StepError('invalid_email');
  if (!c.email && !c.name) throw new StepError('missing_email');
  const form = new URLSearchParams();
  if (c.email) form.set('email', c.email);
  if (c.name) form.set('name', c.name);
  if (c.description) form.set('description', c.description);
  form.set('metadata[source]', 'zerosoft-flow');
  const res = await call('https://api.stripe.com/v1/customers', {
    method: 'POST',
    // La misma corrida, nodo e iteración no crean dos clientes si se reintenta.
    headers: {
      ...auth,
      'content-type': 'application/x-www-form-urlencoded',
      'idempotency-key': `${ctx.runId}:${ctx.nodeId}${ctx.loopIndex === undefined ? '' : `:${ctx.loopIndex}`}`,
    },
    body: form.toString(),
  });
  if (!res.ok) throw stripeFailure(res);
  const cust = (res.body ?? {}) as { id?: string; email?: string; name?: string };
  return { customer: { id: cust.id ?? null, email: cust.email ?? null, name: cust.name ?? null } };
}

/**
 * Verifica el header Stripe-Signature (t=..., v1=...): HMAC-SHA256 del
 * `${t}.${rawBody}` con el secreto del endpoint, con tolerancia de 5 minutos.
 */
export function verifyStripeSignature(rawBody: string, header: string | null, secret: string, nowSec = Math.floor(Date.now() / 1000), toleranceSec = 300): boolean {
  if (!header || !secret) return false;
  let t = '';
  const sigs: string[] = [];
  for (const part of header.split(',')) {
    const [k, v] = part.split('=', 2).map((x) => x?.trim() ?? '');
    if (k === 't') t = v;
    else if (k === 'v1' && v) sigs.push(v);
  }
  if (!/^\d+$/.test(t) || sigs.length === 0) return false;
  if (Math.abs(nowSec - Number(t)) > toleranceSec) return false;
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`, 'utf8').digest();
  return sigs.some((s) => {
    const got = Buffer.from(s, 'hex');
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}

/** Tipos de evento aceptados por un trigger.stripe ('' = todos). */
export function stripeEventAllowed(eventsConfig: unknown, type: string): boolean {
  const list = String(eventsConfig ?? '')
    .split(/[\s,]+/)
    .map((x) => x.trim())
    .filter(Boolean);
  if (list.length === 0) return true;
  return list.some((p) => (p.endsWith('*') ? type.startsWith(p.slice(0, -1)) : p === type));
}

// ---------- Notion ----------

const NOTION_VERSION = '2022-06-28';
const notionId = z.preprocess(
  (v) => String(v ?? '').trim().replace(/^.*([0-9a-f]{32})(\?.*)?$/i, '$1'),
  z.string().regex(/^[0-9a-f-]{32,36}$/i),
);

export const notionConfigSchema = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('create_page'),
    credentialId: required(100),
    databaseId: notionId,
    title: required(2000),
    titleProperty: z.preprocess((v) => String(v ?? '').trim() || 'Name', z.string().max(100)),
    properties: z.unknown().optional(),
    content: text(20_000),
  }),
  z.object({
    operation: z.literal('append_text'),
    credentialId: required(100),
    pageId: notionId,
    content: required(20_000),
  }),
]);

function notionBlocks(content: string) {
  return paragraphs(content).map((p) => ({
    object: 'block',
    type: 'paragraph',
    paragraph: { rich_text: [{ type: 'text', text: { content: p } }] },
  }));
}

export async function notionNode(ctx: IntegrationContext, cfg: Record<string, unknown>) {
  const c = parseConfig(notionConfigSchema, { operation: 'create_page', ...cfg });
  const cred = await ctx.credential(c.credentialId, ['notion', 'oauth_token']);
  const token = cred.data.token ?? cred.data.accessToken;
  const headers = { authorization: `Bearer ${token}`, 'notion-version': NOTION_VERSION, 'content-type': 'application/json' };
  if (c.operation === 'append_text') {
    const res = await call(`https://api.notion.com/v1/blocks/${c.pageId}/children`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ children: notionBlocks(c.content) }),
    });
    if (!res.ok) throw httpFailure('notion', res, (res.body as { code?: string } | null)?.code);
    return { appended: ((res.body as { results?: unknown[] } | null)?.results ?? []).length, pageId: c.pageId };
  }
  let extra: Record<string, unknown> = {};
  if (c.properties !== undefined && c.properties !== '' && c.properties !== null) {
    let raw = c.properties;
    if (typeof raw === 'string') {
      try {
        raw = JSON.parse(raw);
      } catch {
        throw new StepError('invalid_json');
      }
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new StepError('invalid_json');
    extra = raw as Record<string, unknown>;
  }
  const res = await call('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      parent: { database_id: c.databaseId },
      properties: { ...extra, [c.titleProperty]: { title: [{ type: 'text', text: { content: c.title } }] } },
      ...(c.content ? { children: notionBlocks(c.content) } : {}),
    }),
  });
  if (!res.ok) throw httpFailure('notion', res, (res.body as { code?: string } | null)?.code);
  const page = (res.body ?? {}) as { id?: string; url?: string };
  return { page: { id: page.id ?? null, url: page.url ?? null } };
}

// ---------- Discord ----------

export const discordConfigSchema = z.object({
  credentialId: required(100),
  content: required(2000),
  username: text(80),
});

export async function discordNode(ctx: IntegrationContext, cfg: Record<string, unknown>) {
  const c = parseConfig(discordConfigSchema, cfg);
  const cred = await ctx.credential(c.credentialId, ['discord']);
  const url = cred.data.webhookUrl;
  if (!/^https:\/\/(?:[a-z]+\.)?(discord|discordapp)\.com\/api\/webhooks\//i.test(url ?? '')) {
    throw new StepError('discord_invalid_webhook');
  }
  const res = await call(`${url}${url.includes('?') ? '&' : '?'}wait=true`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: c.content, ...(c.username ? { username: c.username } : {}), allowed_mentions: { parse: [] } }),
  });
  if (!res.ok) throw httpFailure('discord', res);
  const msg = (res.body ?? {}) as { id?: string; channel_id?: string };
  return { sent: true, messageId: msg.id ?? null, channelId: msg.channel_id ?? null };
}

// ---------- Telegram ----------

export const telegramConfigSchema = z.object({
  credentialId: required(100),
  chatId: z.preprocess((v) => String(v ?? '').trim(), z.string().regex(/^(-?\d{1,20}|@[A-Za-z0-9_]{4,64})$/)),
  text: required(4096),
  parseMode: z.preprocess((v) => String(v ?? '').trim(), z.enum(['', 'HTML', 'MarkdownV2'])),
});

export async function telegramNode(ctx: IntegrationContext, cfg: Record<string, unknown>) {
  const c = parseConfig(telegramConfigSchema, cfg);
  const cred = await ctx.credential(c.credentialId, ['telegram']);
  if (!/^\d{3,20}:[A-Za-z0-9_-]{20,100}$/.test(cred.data.botToken ?? '')) throw new StepError('telegram_invalid_token');
  const res = await call(`https://api.telegram.org/bot${cred.data.botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: c.chatId, text: c.text, ...(c.parseMode ? { parse_mode: c.parseMode } : {}) }),
  });
  const body = (res.body ?? {}) as { ok?: boolean; description?: string; result?: { message_id?: number; chat?: { id?: number } } };
  if (!res.ok || !body.ok) {
    throw new StepError(`telegram_${res.status}`, res.status === 429 || res.status >= 500, { status: res.status, description: body.description ?? null });
  }
  return { sent: true, messageId: body.result?.message_id ?? null, chatId: body.result?.chat?.id ?? c.chatId };
}

// ---------- HTTP con credencial ----------

/** Headers de autenticación para action.http según el tipo de credencial. */
export function authHeaders(cred: ResolvedCredential): Record<string, string> {
  switch (cred.type) {
    case 'api_key': {
      const name = (cred.data.headerName || 'Authorization').trim();
      if (!/^[A-Za-z0-9-]{1,100}$/.test(name)) throw new StepError('invalid_credential');
      const prefix = cred.data.prefix?.trim();
      return { [name.toLowerCase()]: prefix ? `${prefix} ${cred.data.value}` : cred.data.value };
    }
    case 'basic':
      return { authorization: `Basic ${Buffer.from(`${cred.data.username}:${cred.data.password}`).toString('base64')}` };
    case 'oauth_token':
      return { authorization: `Bearer ${cred.data.accessToken}` };
    default:
      throw new StepError('invalid_credential');
  }
}
