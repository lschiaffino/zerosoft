/**
 * Groups: integraciones directas por workspace.
 *
 * - Slack: un Incoming Webhook (https://hooks.slack.com/services/...) que
 *   recibe un aviso por ticket nuevo, ticket actualizado o mensaje entrante.
 * - Freshdesk: con el dominio y la API key, cada ticket nuevo de Groups crea
 *   uno en Freshdesk (POST /api/v2/tickets) y el estado se sincroniza en los
 *   dos sentidos: nuestros cambios se mandan (PUT) y el cron trae los de allá.
 * - Zoho Desk: igual, con OAuth (client id, secret y refresh token de la
 *   consola de Zoho), el org id y el departamento.
 *
 * Zapier se conecta con los webhooks salientes (Webhooks by Zapier) y la API
 * REST con una API key: no hace falta nada acá.
 *
 * Las credenciales se guardan cifradas (secret-box) y nunca vuelven por la
 * API: el DTO dice qué campos están cargados. Las llamadas salen por
 * safeFetch. Con GROUPS_INTEGRATIONS_FAKE=1 (tests, demo) un servidor falso
 * en memoria responde como Slack, Freshdesk y Zoho, y nada sale a internet.
 * Server-only.
 */
import { randomUUID } from 'crypto';
import { getDb } from './db';
import { open, seal } from './secret-box';
import { safeFetch, UnsafeUrlError } from './safe-fetch';
import type { FetchLike } from './groups-provider';
import type { TicketStatus } from './groups-rules';

export const INTEGRATION_KINDS = ['slack', 'freshdesk', 'zoho'] as const;
export type IntegrationKind = (typeof INTEGRATION_KINDS)[number];

export const SLACK_EVENTS = ['groups.ticket.created', 'groups.ticket.updated', 'groups.message.received'] as const;

export interface IntegrationConfig {
  // slack
  webhookUrl?: string;
  // freshdesk
  domain?: string;
  apiKey?: string;
  requesterEmail?: string;
  // zoho
  dc?: string;
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  orgId?: string;
  departmentId?: string;
}

const SECRET_FIELDS = ['webhookUrl', 'apiKey', 'clientSecret', 'refreshToken'] as const;
const PLAIN_FIELDS = ['domain', 'requesterEmail', 'dc', 'clientId', 'orgId', 'departmentId'] as const;
export const ZOHO_DCS = ['com', 'eu', 'in', 'com.au', 'jp', 'ca', 'com.cn', 'sa'] as const;

export interface IntegrationDto {
  id: string;
  kind: IntegrationKind;
  active: boolean;
  events: string[];
  configured: Record<string, boolean>;
  settings: Partial<Record<(typeof PLAIN_FIELDS)[number], string>>;
  lastError: string;
  lastUsedAt: string | null;
}

interface IntegrationRow {
  id: string;
  user_id: string;
  kind: IntegrationKind;
  config: string;
  events: string;
  active: number;
  last_error: string;
  last_used_at: string | null;
}

export class IntegrationError extends Error {
  constructor(public code: string) {
    super(code);
    this.name = 'IntegrationError';
  }
}

function readConfig(row: Pick<IntegrationRow, 'config'>): IntegrationConfig {
  try {
    return JSON.parse(open(row.config) || '{}') as IntegrationConfig;
  } catch {
    return {};
  }
}

function parseEvents(raw: string): string[] {
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function toDto(row: IntegrationRow): IntegrationDto {
  const cfg = readConfig(row);
  const configured: Record<string, boolean> = {};
  for (const k of [...SECRET_FIELDS, ...PLAIN_FIELDS]) configured[k] = Boolean(cfg[k]);
  const settings: IntegrationDto['settings'] = {};
  for (const k of PLAIN_FIELDS) if (cfg[k]) settings[k] = cfg[k];
  return {
    id: row.id,
    kind: row.kind,
    active: row.active === 1,
    events: parseEvents(row.events),
    configured,
    settings,
    lastError: row.last_error,
    lastUsedAt: row.last_used_at,
  };
}

/** Dominio de Freshdesk: "acme" o "acme.freshdesk.com" → "acme.freshdesk.com". */
export function freshdeskHost(raw: string): string | null {
  const d = String(raw ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (/^[a-z0-9][a-z0-9-]{0,62}$/.test(d)) return `${d}.freshdesk.com`;
  if (/^[a-z0-9][a-z0-9-]{0,62}\.freshdesk\.com$/.test(d)) return d;
  return null;
}

/** Valida lo que manda la persona; un secreto vacío al editar conserva el anterior. */
export function cleanIntegrationConfig(kind: IntegrationKind, input: Record<string, unknown>, prev: IntegrationConfig = {}): IntegrationConfig {
  const out: IntegrationConfig = { ...prev };
  const str = (k: keyof IntegrationConfig, max = 500) => {
    const v = input[k];
    if (typeof v !== 'string') return;
    const t = v.trim().slice(0, max);
    if (t) out[k] = t;
    else if (!(SECRET_FIELDS as readonly string[]).includes(k)) delete out[k];
  };
  if (kind === 'slack') {
    str('webhookUrl', 500);
    if (!out.webhookUrl || !/^https:\/\/hooks\.slack\.com\/(services|workflows|triggers)\/[\w/-]+$/.test(out.webhookUrl)) {
      if (!(fakeMode() && out.webhookUrl?.startsWith('https://'))) throw new IntegrationError('invalid_slack_url');
    }
  } else if (kind === 'freshdesk') {
    str('domain', 120);
    str('apiKey', 200);
    str('requesterEmail', 200);
    const host = freshdeskHost(out.domain ?? '');
    if (!host) throw new IntegrationError('invalid_domain');
    out.domain = host;
    if (!out.apiKey) throw new IntegrationError('missing_api_key');
    if (out.requesterEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.requesterEmail)) throw new IntegrationError('invalid_email');
  } else {
    for (const k of ['dc', 'clientId', 'clientSecret', 'refreshToken', 'orgId', 'departmentId'] as const) str(k, 300);
    if (!out.dc || !(ZOHO_DCS as readonly string[]).includes(out.dc)) out.dc = 'com';
    if (!out.clientId) throw new IntegrationError('missing_client_id');
    if (!out.clientSecret) throw new IntegrationError('missing_client_secret');
    if (!out.refreshToken) throw new IntegrationError('missing_refresh_token');
    if (!out.orgId || !/^\d{1,30}$/.test(out.orgId)) throw new IntegrationError('invalid_org_id');
    if (!out.departmentId || !/^\d{1,30}$/.test(out.departmentId)) throw new IntegrationError('invalid_department_id');
  }
  return out;
}

export async function listIntegrations(ws: string): Promise<IntegrationDto[]> {
  const rows = (await getDb().prepare('SELECT * FROM groups_integrations WHERE user_id = ? ORDER BY kind').all(ws)) as IntegrationRow[];
  return rows.map(toDto);
}

async function getRow(ws: string, kind: IntegrationKind): Promise<IntegrationRow | null> {
  return ((await getDb().prepare('SELECT * FROM groups_integrations WHERE user_id = ? AND kind = ?').get(ws, kind)) as IntegrationRow) ?? null;
}

export async function saveIntegration(
  ws: string,
  actor: string,
  kind: IntegrationKind,
  input: { config?: Record<string, unknown>; events?: string[]; active?: boolean },
): Promise<IntegrationDto> {
  if (!(INTEGRATION_KINDS as readonly string[]).includes(kind)) throw new IntegrationError('invalid_kind');
  const prev = await getRow(ws, kind);
  const cfg = cleanIntegrationConfig(kind, input.config ?? {}, prev ? readConfig(prev) : {});
  const events =
    kind === 'slack'
      ? (input.events ?? (prev ? parseEvents(prev.events) : ['groups.ticket.created'])).filter((e) => (SLACK_EVENTS as readonly string[]).includes(e))
      : ['groups.ticket.created', 'groups.ticket.updated'];
  const now = new Date().toISOString();
  await getDb()
    .prepare(
      `INSERT INTO groups_integrations (id, user_id, kind, config, events, active, last_error, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, ?)
       ON CONFLICT(user_id, kind) DO UPDATE SET config = excluded.config, events = excluded.events, active = excluded.active,
         last_error = '', updated_at = excluded.updated_at`,
    )
    .run(prev?.id ?? randomUUID(), ws, kind, seal(JSON.stringify(cfg)), JSON.stringify(events), input.active === false ? 0 : 1, actor, now, now);
  return toDto((await getRow(ws, kind)) as IntegrationRow);
}

export async function deleteIntegration(ws: string, kind: IntegrationKind): Promise<boolean> {
  return (await getDb().prepare('DELETE FROM groups_integrations WHERE user_id = ? AND kind = ?').run(ws, kind)).changes > 0;
}

async function markUsed(id: string, error = ''): Promise<void> {
  await getDb().prepare('UPDATE groups_integrations SET last_error = ?, last_used_at = ? WHERE id = ?').run(error, new Date().toISOString(), id);
}

// ======================================================================
// HTTP (real o falso)
// ======================================================================

export function fakeMode(): boolean {
  if (process.env.GROUPS_INTEGRATIONS_FAKE !== '1' && process.env.GROUPS_FAKE !== '1') return false;
  return process.env.NODE_ENV === 'test' || process.env.DEMO_MODE === 'true';
}

interface FakeCall {
  method: string;
  url: string;
  body: unknown;
}
interface FakeServer {
  calls: FakeCall[];
  tickets: Map<string, { status: number | string }>;
  seq: number;
}
const fakeServer: FakeServer = ((globalThis as unknown as { __groupsIntegrations?: FakeServer }).__groupsIntegrations ??= {
  calls: [] as FakeCall[],
  tickets: new Map<string, { status: number | string }>(),
  seq: 1000,
});

export function fakeIntegrationCalls(): FakeCall[] {
  return fakeServer.calls;
}

/** Tests: cambia el estado de un ticket en el Freshdesk/Zoho falso (como si alguien lo cerrara allá). */
export function setFakeRemoteStatus(remoteId: string, status: number | string): void {
  fakeServer.tickets.set(remoteId, { status });
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const fakeFetch: FetchLike = async (url, init) => {
  const method = init?.method ?? 'GET';
  let body: unknown = null;
  try {
    body = init?.body ? JSON.parse(String(init.body)) : null;
  } catch {
    body = String(init?.body ?? '');
  }
  fakeServer.calls.push({ method, url, body });
  if (fakeServer.calls.length > 500) fakeServer.calls.splice(0, 100);
  const u = new URL(url);
  if (u.hostname === 'hooks.slack.com' || u.pathname.includes('/slack/')) return new Response('ok', { status: 200 });
  if (u.hostname.startsWith('accounts.zoho.')) return json(200, { access_token: 'fake-zoho-token', expires_in: 3600 });
  const m = /\/(?:api\/v2|api\/v1)\/tickets(?:\/([\w-]+))?$/.exec(u.pathname);
  if (!m) return json(404, { error: 'not_found' });
  const zoho = u.hostname.startsWith('desk.zoho.');
  if (!m[1] && method === 'POST') {
    const id = String(++fakeServer.seq);
    fakeServer.tickets.set(id, { status: zoho ? 'Open' : 2 });
    return json(201, zoho ? { id, ticketNumber: id, webUrl: `https://desk.zoho.com/support/tickets/${id}`, status: 'Open' } : { id: Number(id), status: 2 });
  }
  const t = m[1] ? fakeServer.tickets.get(m[1]) : undefined;
  if (!t) return json(404, { error: 'not_found' });
  if (method === 'PUT' || method === 'PATCH') {
    t.status = (body as { status?: number | string })?.status ?? t.status;
    return json(200, zoho ? { id: m[1], status: t.status } : { id: Number(m[1]), status: t.status });
  }
  return json(200, zoho ? { id: m[1], status: t.status, statusType: t.status === 'Closed' ? 'Closed' : t.status === 'On Hold' ? 'On Hold' : 'Open' } : { id: Number(m[1]), status: t.status });
};

function defaultFetch(): FetchLike {
  return fakeMode() ? fakeFetch : (url, init) => safeFetch(url, init, 15_000);
}

async function call(f: FetchLike, url: string, init: RequestInit): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await f(url, init);
  } catch (err) {
    throw new IntegrationError(err instanceof UnsafeUrlError ? 'invalid_url' : 'unreachable');
  }
  if (res.status === 401 || res.status === 403) throw new IntegrationError('auth_failed');
  if (res.status === 404) throw new IntegrationError('not_found');
  if (res.status === 429) throw new IntegrationError('rate_limited');
  if (!res.ok) throw new IntegrationError(`http_${res.status}`);
  const text = await res.text().catch(() => '');
  try {
    return text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// ======================================================================
// Slack
// ======================================================================

export function slackText(event: string, data: Record<string, unknown>, baseUrl: string): string {
  const ticket = (data.ticket ?? {}) as Record<string, unknown>;
  const chat = (data.chat ?? {}) as Record<string, unknown>;
  const message = (data.message ?? {}) as Record<string, unknown>;
  const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const link = (path: string, label: string) => `<${baseUrl}${path}|${esc(label)}>`;
  if (event === 'groups.ticket.created') {
    return `New ticket #${esc(ticket.number)} (${esc(ticket.priority)}): ${link(`/app/groups/tickets?open=${esc(ticket.id)}`, String(ticket.title ?? ''))}${chat.name ? ` · ${esc(chat.name)}` : ''}`;
  }
  if (event === 'groups.ticket.updated') {
    return `Ticket #${esc(ticket.number)} is now ${esc(ticket.status)}: ${link(`/app/groups/tickets?open=${esc(ticket.id)}`, String(ticket.title ?? ''))}`;
  }
  const who = message.senderName || (message.senderPhone ? `+${message.senderPhone}` : '');
  return `${link(`/app/groups/inbox/${esc(chat.id)}`, String(chat.name ?? 'WhatsApp'))}${who ? ` · ${esc(who)}` : ''}: ${esc(String(message.body ?? '').slice(0, 300))}`;
}

export async function postToSlack(webhookUrl: string, text: string, f: FetchLike = defaultFetch()): Promise<void> {
  await call(f, webhookUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) });
}

// ======================================================================
// Freshdesk
// ======================================================================

const FD_STATUS: Record<TicketStatus, number> = { open: 2, in_progress: 3, resolved: 4, closed: 5 };
const FD_PRIORITY: Record<string, number> = { low: 1, medium: 2, high: 3, urgent: 4 };

export function fromFreshdeskStatus(n: unknown): TicketStatus {
  const v = Number(n);
  if (v === 2) return 'open';
  if (v === 4) return 'resolved';
  if (v === 5) return 'closed';
  return 'in_progress';
}

function fdHeaders(cfg: IntegrationConfig): Record<string, string> {
  return { authorization: `Basic ${Buffer.from(`${cfg.apiKey}:X`).toString('base64')}`, 'content-type': 'application/json' };
}

export interface RemoteTicketInput {
  title: string;
  description: string;
  priority: string;
  status: TicketStatus;
  requesterName: string;
  requesterPhone: string;
}

export async function freshdeskCreate(cfg: IntegrationConfig, t: RemoteTicketInput, f: FetchLike = defaultFetch()): Promise<{ id: string; url: string }> {
  const host = freshdeskHost(cfg.domain ?? '');
  if (!host) throw new IntegrationError('invalid_domain');
  const requester = t.requesterPhone
    ? { phone: `+${t.requesterPhone}`, name: t.requesterName || `+${t.requesterPhone}` }
    : cfg.requesterEmail
      ? { email: cfg.requesterEmail, name: t.requesterName || 'WhatsApp' }
      : null;
  if (!requester) throw new IntegrationError('missing_requester');
  const r = await call(f, `https://${host}/api/v2/tickets`, {
    method: 'POST',
    headers: fdHeaders(cfg),
    body: JSON.stringify({
      subject: t.title.slice(0, 255),
      description: t.description.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>') || t.title,
      priority: FD_PRIORITY[t.priority] ?? 2,
      status: FD_STATUS[t.status],
      source: 7,
      ...requester,
    }),
  });
  const id = String(r.id ?? '');
  if (!id) throw new IntegrationError('provider_error');
  return { id, url: `https://${host}/a/tickets/${id}` };
}

export async function freshdeskSetStatus(cfg: IntegrationConfig, id: string, status: TicketStatus, f: FetchLike = defaultFetch()): Promise<void> {
  const host = freshdeskHost(cfg.domain ?? '');
  if (!host) throw new IntegrationError('invalid_domain');
  await call(f, `https://${host}/api/v2/tickets/${encodeURIComponent(id)}`, { method: 'PUT', headers: fdHeaders(cfg), body: JSON.stringify({ status: FD_STATUS[status] }) });
}

export async function freshdeskStatus(cfg: IntegrationConfig, id: string, f: FetchLike = defaultFetch()): Promise<TicketStatus> {
  const host = freshdeskHost(cfg.domain ?? '');
  if (!host) throw new IntegrationError('invalid_domain');
  const r = await call(f, `https://${host}/api/v2/tickets/${encodeURIComponent(id)}`, { method: 'GET', headers: fdHeaders(cfg) });
  return fromFreshdeskStatus(r.status);
}

// ======================================================================
// Zoho Desk
// ======================================================================

const ZOHO_STATUS: Record<TicketStatus, string> = { open: 'Open', in_progress: 'On Hold', resolved: 'Closed', closed: 'Closed' };
const ZOHO_PRIORITY: Record<string, string> = { low: 'Low', medium: 'Medium', high: 'High', urgent: 'High' };

export function fromZohoStatus(statusType: unknown, current: TicketStatus): TicketStatus {
  const s = String(statusType ?? '').toLowerCase();
  if (s === 'closed') return current === 'resolved' || current === 'closed' ? current : 'closed';
  if (s === 'on hold') return 'in_progress';
  if (s === 'open') return 'open';
  return current;
}

const zohoTokens = ((globalThis as unknown as { __zohoTokens?: Map<string, { token: string; until: number }> }).__zohoTokens ??= new Map());

async function zohoToken(cfg: IntegrationConfig, f: FetchLike): Promise<string> {
  const key = `${cfg.dc}:${cfg.clientId}:${cfg.refreshToken?.slice(-8)}`;
  const hit = zohoTokens.get(key);
  if (hit && hit.until > Date.now() + 60_000) return hit.token;
  const q = new URLSearchParams({ refresh_token: cfg.refreshToken ?? '', client_id: cfg.clientId ?? '', client_secret: cfg.clientSecret ?? '', grant_type: 'refresh_token' });
  const r = await call(f, `https://accounts.zoho.${cfg.dc || 'com'}/oauth/v2/token?${q.toString()}`, { method: 'POST' });
  const token = String(r.access_token ?? '');
  if (!token) throw new IntegrationError('auth_failed');
  zohoTokens.set(key, { token, until: Date.now() + Math.max(60, Number(r.expires_in) || 3600) * 1000 });
  return token;
}

async function zohoHeaders(cfg: IntegrationConfig, f: FetchLike): Promise<Record<string, string>> {
  return { authorization: `Zoho-oauthtoken ${await zohoToken(cfg, f)}`, orgId: cfg.orgId ?? '', 'content-type': 'application/json' };
}

export async function zohoCreate(cfg: IntegrationConfig, t: RemoteTicketInput, f: FetchLike = defaultFetch()): Promise<{ id: string; url: string }> {
  const r = await call(f, `https://desk.zoho.${cfg.dc || 'com'}/api/v1/tickets`, {
    method: 'POST',
    headers: await zohoHeaders(cfg, f),
    body: JSON.stringify({
      subject: t.title.slice(0, 255),
      departmentId: cfg.departmentId,
      description: t.description || t.title,
      priority: ZOHO_PRIORITY[t.priority] ?? 'Medium',
      status: ZOHO_STATUS[t.status],
      channel: 'Chat',
      contact: { lastName: t.requesterName || (t.requesterPhone ? `+${t.requesterPhone}` : 'WhatsApp'), ...(t.requesterPhone ? { phone: `+${t.requesterPhone}` } : {}) },
    }),
  });
  const id = String(r.id ?? '');
  if (!id) throw new IntegrationError('provider_error');
  return { id, url: String(r.webUrl ?? '') };
}

export async function zohoSetStatus(cfg: IntegrationConfig, id: string, status: TicketStatus, f: FetchLike = defaultFetch()): Promise<void> {
  await call(f, `https://desk.zoho.${cfg.dc || 'com'}/api/v1/tickets/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: await zohoHeaders(cfg, f),
    body: JSON.stringify({ status: ZOHO_STATUS[status] }),
  });
}

export async function zohoStatus(cfg: IntegrationConfig, id: string, current: TicketStatus, f: FetchLike = defaultFetch()): Promise<TicketStatus> {
  const r = await call(f, `https://desk.zoho.${cfg.dc || 'com'}/api/v1/tickets/${encodeURIComponent(id)}`, { method: 'GET', headers: await zohoHeaders(cfg, f) });
  return fromZohoStatus(r.statusType ?? r.status, current);
}

// ======================================================================
// Eventos → integraciones
// ======================================================================

export interface TicketLinkDto {
  kind: IntegrationKind;
  remoteId: string;
  remoteUrl: string;
  remoteStatus: string;
  syncedAt: string | null;
  lastError: string;
}

export async function ticketLinks(ticketId: string): Promise<TicketLinkDto[]> {
  const rows = (await getDb().prepare("SELECT * FROM groups_ticket_links WHERE ticket_id = ? AND remote_id != '' ORDER BY kind").all(ticketId)) as Array<{
    kind: IntegrationKind;
    remote_id: string;
    remote_url: string;
    remote_status: string;
    synced_at: string | null;
    last_error: string;
  }>;
  return rows.map((r) => ({ kind: r.kind, remoteId: r.remote_id, remoteUrl: r.remote_url, remoteStatus: r.remote_status, syncedAt: r.synced_at, lastError: r.last_error }));
}

async function ticketContext(ws: string, ticketId: string): Promise<{ input: RemoteTicketInput; status: TicketStatus } | null> {
  const t = (await getDb()
    .prepare(
      `SELECT t.title, t.status, t.priority, c.name AS chat_name, c.phone AS chat_phone, c.kind AS chat_kind, m.body, m.sender_phone, m.sender_name
       FROM groups_tickets t LEFT JOIN groups_chats c ON c.id = t.chat_id LEFT JOIN groups_messages m ON m.id = t.message_id
       WHERE t.id = ? AND t.user_id = ?`,
    )
    .get(ticketId, ws)) as
    | { title: string; status: TicketStatus; priority: string; chat_name: string | null; chat_phone: string | null; chat_kind: string | null; body: string | null; sender_phone: string | null; sender_name: string | null }
    | undefined;
  if (!t) return null;
  const phone = t.sender_phone || (t.chat_kind === 'dm' ? t.chat_phone ?? '' : '');
  const where = t.chat_name ? `WhatsApp: ${t.chat_name}` : 'WhatsApp';
  return {
    status: t.status,
    input: {
      title: t.title,
      description: [t.body ?? '', '', where].join('\n').trim(),
      priority: t.priority,
      status: t.status,
      requesterName: t.sender_name || (t.chat_kind === 'dm' ? t.chat_name ?? '' : ''),
      requesterPhone: phone,
    },
  };
}

async function pushTicket(ws: string, row: IntegrationRow, ticketId: string, created: boolean): Promise<void> {
  const cfg = readConfig(row);
  const db = getDb();
  const ctx = await ticketContext(ws, ticketId);
  if (!ctx) return;
  const link = (await db.prepare('SELECT remote_id, remote_status FROM groups_ticket_links WHERE ticket_id = ? AND kind = ?').get(ticketId, row.kind)) as
    | { remote_id: string; remote_status: string }
    | undefined;
  const now = new Date().toISOString();
  if (!link) {
    if (!created) return;
    // Claim: el vínculo vacío lo inserta uno solo; solo ese crea el ticket allá.
    const claim = await db
      .prepare("INSERT OR IGNORE INTO groups_ticket_links (ticket_id, kind, remote_id, remote_status) VALUES (?, ?, '', '')")
      .run(ticketId, row.kind);
    if (claim.changes === 0) return;
    try {
      const res = row.kind === 'freshdesk' ? await freshdeskCreate(cfg, ctx.input) : await zohoCreate(cfg, ctx.input);
      await db
        .prepare('UPDATE groups_ticket_links SET remote_id = ?, remote_url = ?, remote_status = ?, synced_at = ? WHERE ticket_id = ? AND kind = ?')
        .run(res.id, res.url, ctx.status, now, ticketId, row.kind);
    } catch (err) {
      await db.prepare("DELETE FROM groups_ticket_links WHERE ticket_id = ? AND kind = ? AND remote_id = ''").run(ticketId, row.kind);
      throw err;
    }
    return;
  }
  if (!link.remote_id) return;
  // Ya está igual allá (por ejemplo, el cambio vino de allá): no se manda de nuevo.
  if (link.remote_status === ctx.status) return;
  if (row.kind === 'freshdesk') await freshdeskSetStatus(cfg, link.remote_id, ctx.status);
  else await zohoSetStatus(cfg, link.remote_id, ctx.status);
  await db.prepare("UPDATE groups_ticket_links SET remote_status = ?, synced_at = ?, last_error = '' WHERE ticket_id = ? AND kind = ?").run(ctx.status, now, ticketId, row.kind);
}

/** Lo llama el bus de eventos (lib/events.ts) con cada evento groups.*. Nunca lanza. */
export async function dispatchGroupsEvent(ws: string, event: string, data: unknown): Promise<void> {
  try {
    const rows = (await getDb().prepare('SELECT * FROM groups_integrations WHERE user_id = ? AND active = 1').all(ws)) as IntegrationRow[];
    if (rows.length === 0) return;
    const d = (data ?? {}) as Record<string, unknown>;
    const ticketId = String(((d.ticket ?? {}) as Record<string, unknown>).id ?? '');
    for (const row of rows) {
      try {
        if (row.kind === 'slack') {
          if (!parseEvents(row.events).includes(event)) continue;
          const { groupsBaseUrl } = await import('./groups');
          await postToSlack(readConfig(row).webhookUrl ?? '', slackText(event, d, groupsBaseUrl()));
          await markUsed(row.id);
        } else if ((event === 'groups.ticket.created' || event === 'groups.ticket.updated') && ticketId) {
          await pushTicket(ws, row, ticketId, event === 'groups.ticket.created');
          await markUsed(row.id);
        }
      } catch (err) {
        await markUsed(row.id, err instanceof IntegrationError ? err.code : 'error');
        if (ticketId && row.kind !== 'slack') {
          await getDb()
            .prepare('UPDATE groups_ticket_links SET last_error = ? WHERE ticket_id = ? AND kind = ?')
            .run(err instanceof IntegrationError ? err.code : 'error', ticketId, row.kind);
        }
      }
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[groups] integrations failed', (err as Error)?.name ?? 'error');
  }
}

/** Prueba de la integración (Slack manda un mensaje; Freshdesk y Zoho validan las credenciales). */
export async function testIntegration(ws: string, kind: IntegrationKind): Promise<void> {
  const row = await getRow(ws, kind);
  if (!row) throw new IntegrationError('not_found');
  const cfg = readConfig(row);
  const f = defaultFetch();
  try {
    if (kind === 'slack') await postToSlack(cfg.webhookUrl ?? '', 'Zerosoft Groups is connected to this channel.', f);
    else if (kind === 'freshdesk') {
      const host = freshdeskHost(cfg.domain ?? '');
      if (!host) throw new IntegrationError('invalid_domain');
      if (!fakeMode()) await call(f, `https://${host}/api/v2/tickets?per_page=1`, { method: 'GET', headers: fdHeaders(cfg) });
    } else await zohoToken(cfg, f);
    await markUsed(row.id);
  } catch (err) {
    await markUsed(row.id, err instanceof IntegrationError ? err.code : 'error');
    throw err;
  }
}

/**
 * Cron: trae el estado de los tickets vinculados (cada 10 min por ticket) y,
 * si cambió allá, lo cambia acá. Reclama cada vínculo con locked_until.
 */
export async function syncRemoteTickets(limit = 20): Promise<number> {
  const db = getDb();
  const now = new Date();
  const stale = new Date(now.getTime() - 10 * 60_000).toISOString();
  const rows = (await db
    .prepare(
      `SELECT l.ticket_id, l.kind, l.remote_id, l.remote_status, t.user_id, t.status FROM groups_ticket_links l
       JOIN groups_tickets t ON t.id = l.ticket_id
       WHERE l.remote_id != '' AND (l.synced_at IS NULL OR l.synced_at < ?) AND (l.locked_until IS NULL OR l.locked_until < ?) AND t.status != 'closed'
       ORDER BY l.synced_at LIMIT ?`,
    )
    .all(stale, now.toISOString(), limit)) as Array<{ ticket_id: string; kind: IntegrationKind; remote_id: string; remote_status: string; user_id: string; status: TicketStatus }>;
  let changed = 0;
  for (const r of rows) {
    const lock = new Date(Date.now() + 120_000).toISOString();
    const claim = await db
      .prepare('UPDATE groups_ticket_links SET locked_until = ? WHERE ticket_id = ? AND kind = ? AND (locked_until IS NULL OR locked_until < ?)')
      .run(lock, r.ticket_id, r.kind, new Date().toISOString());
    if (claim.changes === 0) continue;
    try {
      const row = await getRow(r.user_id, r.kind);
      if (!row || row.active !== 1) continue;
      const cfg = readConfig(row);
      const remote = r.kind === 'freshdesk' ? await freshdeskStatus(cfg, r.remote_id) : await zohoStatus(cfg, r.remote_id, r.status);
      await db
        .prepare("UPDATE groups_ticket_links SET remote_status = ?, synced_at = ?, last_error = '' WHERE ticket_id = ? AND kind = ?")
        .run(remote, new Date().toISOString(), r.ticket_id, r.kind);
      if (remote !== r.status) {
        const { updateTicket } = await import('./groups-tickets');
        await updateTicket(r.user_id, r.ticket_id, { status: remote });
        changed++;
      }
    } catch (err) {
      await db
        .prepare('UPDATE groups_ticket_links SET last_error = ?, synced_at = ? WHERE ticket_id = ? AND kind = ?')
        .run(err instanceof IntegrationError ? err.code : 'error', new Date().toISOString(), r.ticket_id, r.kind);
    } finally {
      await db.prepare('UPDATE groups_ticket_links SET locked_until = NULL WHERE ticket_id = ? AND kind = ? AND locked_until = ?').run(r.ticket_id, r.kind, lock);
    }
  }
  return changed;
}
