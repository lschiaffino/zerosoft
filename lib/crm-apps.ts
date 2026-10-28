/**
 * Apps conectadas del CRM (Ajustes › Integraciones). Server-only.
 *
 * - Slack: "Incoming Webhook" del canal; avisa los eventos elegidos.
 * - Zoom: app Server-to-Server OAuth de la cuenta Zoom del workspace; crea el
 *   link de una reunión desde una actividad.
 * - Stripe: clave secreta + signing secret del endpoint; sincroniza clientes
 *   como contactos, deja los pagos en el timeline, marca ganado el deal
 *   (metadata.deal_id) y cobra cotizaciones con Checkout (lib/crm-quote-pay.ts).
 * - Zapier / Make: un webhook saliente del workspace a su catch hook.
 *
 * Los secretos se guardan cifrados (lib/secret-box) y nunca vuelven a la UI.
 * CRM_APPS_FAKE=1 (tests) no sale a internet: Slack y Zoom responden como si
 * anduvieran y Stripe usa clientes y sesiones de prueba.
 */
import { randomBytes } from 'crypto';
import { getDb } from './db';
import { open, seal } from './secret-box';
import { safeFetch } from './safe-fetch';
import { createWebhook, deleteWebhook, type WebhookEvent } from './webhooks';
import { verifyStripeSignature } from './calendar-payments';
import {
  AUTOMATION_DEFAULT_EVENTS,
  CRM_APPS,
  DEFAULT_SLACK_EVENTS,
  isAutomationHookUrl,
  isSlackWebhookUrl,
  maskSecret,
  SLACK_EVENTS,
  slackText,
  withZoomLine,
  ZOOM_DEFAULT_MINUTES,
  type CrmAppKey,
  type SlackEvent,
} from './crm-apps-schema';

export class AppError extends Error {
  constructor(
    public code: string,
    public status = 400,
  ) {
    super(code);
  }
}

export function appsFake(): boolean {
  return process.env.CRM_APPS_FAKE === '1';
}

function baseUrl(): string {
  return (process.env.NEXTAUTH_URL ?? 'https://zerosoft.ai').replace(/\/$/, '');
}

interface AppRow {
  user_id: string;
  app: CrmAppKey;
  secrets: string;
  settings: string;
  webhook_token: string | null;
  last_error: string | null;
  last_used_at: string | null;
  connected_by: string | null;
  connected_at: string;
}

type Secrets = Record<string, string>;
type Settings = Record<string, unknown>;

async function getRow(userId: string, app: CrmAppKey): Promise<AppRow | null> {
  return ((await getDb().prepare('SELECT * FROM crm_apps WHERE user_id = ? AND app = ?').get(userId, app)) as AppRow | undefined) ?? null;
}

function secretsOf(row: AppRow | null): Secrets {
  if (!row?.secrets) return {};
  try {
    return JSON.parse(open(row.secrets) || '{}') as Secrets;
  } catch {
    return {};
  }
}

function settingsOf(row: AppRow | null): Settings {
  try {
    return JSON.parse(row?.settings || '{}') as Settings;
  } catch {
    return {};
  }
}

async function saveRow(
  userId: string,
  app: CrmAppKey,
  data: { secrets?: Secrets; settings?: Settings; webhookToken?: string | null; connectedBy?: string },
): Promise<void> {
  const existing = await getRow(userId, app);
  const secrets = data.secrets ? seal(JSON.stringify(data.secrets)) : (existing?.secrets ?? '');
  const settings = JSON.stringify(data.settings ?? settingsOf(existing));
  const token = data.webhookToken !== undefined ? data.webhookToken : (existing?.webhook_token ?? null);
  if (existing) {
    await getDb()
      .prepare(
        `UPDATE crm_apps SET secrets = ?, settings = ?, webhook_token = ?, last_error = NULL, updated_at = datetime('now')
         WHERE user_id = ? AND app = ?`,
      )
      .run(secrets, settings, token, userId, app);
  } else {
    await getDb()
      .prepare(
        'INSERT INTO crm_apps (user_id, app, secrets, settings, webhook_token, connected_by) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(userId, app, secrets, settings, token, data.connectedBy ?? null);
  }
}

async function logApp(userId: string, app: CrmAppKey, event: string, status: 'ok' | 'error', detail = ''): Promise<void> {
  const db = getDb();
  await db
    .prepare('INSERT INTO crm_app_log (id, user_id, app, event, status, detail) VALUES (?, ?, ?, ?, ?, ?)')
    .run(crypto.randomUUID(), userId, app, event, status, detail.slice(0, 300));
  await db
    .prepare(
      status === 'ok'
        ? "UPDATE crm_apps SET last_used_at = datetime('now'), last_error = NULL WHERE user_id = ? AND app = ?"
        : "UPDATE crm_apps SET last_error = ?, updated_at = datetime('now') WHERE user_id = ? AND app = ?",
    )
    .run(...(status === 'ok' ? [userId, app] : [detail.slice(0, 300), userId, app]));
  // Solo las últimas 50 por app.
  await db
    .prepare(
      `DELETE FROM crm_app_log WHERE user_id = ? AND app = ? AND id NOT IN
         (SELECT id FROM crm_app_log WHERE user_id = ? AND app = ? ORDER BY created_at DESC, rowid DESC LIMIT 50)`,
    )
    .run(userId, app, userId, app);
}

// ---------- Vista para la UI ----------

export interface AppLogEntry {
  event: string;
  status: 'ok' | 'error';
  detail: string;
  at: string;
}

export interface CrmAppView {
  key: CrmAppKey;
  connected: boolean;
  connectedAt: string | null;
  lastUsedAt: string | null;
  lastError: string | null;
  /** Lo que se muestra del secreto: URL o clave enmascarada. */
  hint: string;
  /** Slack: eventos elegidos. Zapier/Make: eventos del webhook. */
  events: string[];
  /** Stripe: URL del endpoint para pegar en Stripe. */
  webhookUrl: string | null;
  log: AppLogEntry[];
}

export async function listApps(userId: string): Promise<CrmAppView[]> {
  const rows = (await getDb().prepare('SELECT * FROM crm_apps WHERE user_id = ?').all(userId)) as AppRow[];
  const logs = (await getDb()
    .prepare('SELECT app, event, status, detail, created_at FROM crm_app_log WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 200')
    .all(userId)) as Array<{ app: string; event: string; status: 'ok' | 'error'; detail: string; created_at: string }>;
  return CRM_APPS.map((key) => {
    const row = rows.find((r) => r.app === key) ?? null;
    const secrets = secretsOf(row);
    const settings = settingsOf(row);
    let hint = '';
    if (key === 'slack') hint = maskSecret(secrets.webhookUrl ?? '', 34);
    if (key === 'zoom') hint = secrets.accountId ? `${secrets.accountId.slice(0, 4)}…` : '';
    if (key === 'stripe') hint = maskSecret(secrets.secretKey ?? '');
    if (key === 'zapier' || key === 'make') hint = maskSecret(String(settings.hookUrl ?? ''), 28);
    return {
      key,
      connected: row !== null,
      connectedAt: row?.connected_at ?? null,
      lastUsedAt: row?.last_used_at ?? null,
      lastError: row?.last_error ?? null,
      hint,
      events: Array.isArray(settings.events) ? (settings.events as string[]) : [],
      webhookUrl: key === 'stripe' && row?.webhook_token ? `${baseUrl()}/api/crm/stripe-webhook/${row.webhook_token}` : null,
      log: logs
        .filter((l) => l.app === key)
        .slice(0, 10)
        .map((l) => ({ event: l.event, status: l.status, detail: l.detail, at: l.created_at })),
    };
  });
}

export async function isAppConnected(userId: string, app: CrmAppKey): Promise<boolean> {
  return (await getRow(userId, app)) !== null;
}

export async function disconnectApp(userId: string, app: CrmAppKey): Promise<boolean> {
  const row = await getRow(userId, app);
  if (!row) return false;
  if (app === 'zapier' || app === 'make') {
    const hookId = settingsOf(row).webhookId;
    if (typeof hookId === 'string') await deleteWebhook(userId, hookId);
  }
  await getDb().prepare('DELETE FROM crm_apps WHERE user_id = ? AND app = ?').run(userId, app);
  await getDb().prepare('DELETE FROM crm_app_log WHERE user_id = ? AND app = ?').run(userId, app);
  return true;
}

// ---------- Slack ----------

async function postSlack(url: string, text: string): Promise<void> {
  if (appsFake()) return;
  const res = await safeFetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text, unfurl_links: false }),
  });
  if (!res.ok) throw new AppError(`slack_${res.status}`, 502);
}

export async function connectSlack(
  userId: string,
  input: { webhookUrl: string; events?: string[] },
  actor: string,
): Promise<void> {
  if (!isSlackWebhookUrl(input.webhookUrl)) throw new AppError('invalid_slack_url');
  const events = (input.events ?? DEFAULT_SLACK_EVENTS).filter((e): e is SlackEvent => (SLACK_EVENTS as readonly string[]).includes(e));
  try {
    await postSlack(input.webhookUrl, 'Zerosoft CRM is connected. CRM updates will show up in this channel.');
  } catch {
    throw new AppError('slack_unreachable', 502);
  }
  await saveRow(userId, 'slack', { secrets: { webhookUrl: input.webhookUrl }, settings: { events }, connectedBy: actor });
  await logApp(userId, 'slack', 'connected', 'ok');
}

export async function setSlackEvents(userId: string, events: string[]): Promise<boolean> {
  const row = await getRow(userId, 'slack');
  if (!row) return false;
  const clean = events.filter((e) => (SLACK_EVENTS as readonly string[]).includes(e));
  await saveRow(userId, 'slack', { settings: { ...settingsOf(row), events: clean } });
  return true;
}

export async function sendSlackTest(userId: string): Promise<boolean> {
  const row = await getRow(userId, 'slack');
  const url = secretsOf(row).webhookUrl;
  if (!row || !url) return false;
  try {
    await postSlack(url, 'Test message from Zerosoft CRM.');
    await logApp(userId, 'slack', 'test', 'ok');
  } catch (err) {
    await logApp(userId, 'slack', 'test', 'error', err instanceof Error ? err.message : 'error');
  }
  return true;
}

/**
 * Avisos a las apps conectadas de un evento del CRM (lo llaman lib/events.ts
 * y lib/crm-hooks.ts). Hoy: Slack. Nunca lanza.
 */
export async function notifyApps(userId: string, event: WebhookEvent | string, data: unknown): Promise<void> {
  try {
    if (!(SLACK_EVENTS as readonly string[]).includes(event)) return;
    const row = await getRow(userId, 'slack');
    if (!row) return;
    const events = settingsOf(row).events;
    if (!Array.isArray(events) || !events.includes(event)) return;
    const url = secretsOf(row).webhookUrl;
    const text = slackText(event, data, baseUrl());
    if (!url || !text) return;
    try {
      await postSlack(url, text);
      await logApp(userId, 'slack', event, 'ok', appsFake() ? text : '');
    } catch (err) {
      await logApp(userId, 'slack', event, 'error', err instanceof Error ? err.message : 'error');
    }
  } catch {
    /* nunca corta el evento */
  }
}

// ---------- Zoom (Server-to-Server OAuth) ----------

const tokenCache = new Map<string, { token: string; until: number }>();

async function zoomToken(secrets: Secrets): Promise<string> {
  if (appsFake()) return 'fake-zoom-token';
  const cacheKey = `${secrets.accountId}:${secrets.clientId}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.until > Date.now()) return cached.token;
  const basic = Buffer.from(`${secrets.clientId}:${secrets.clientSecret}`).toString('base64');
  const res = await safeFetch(
    `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(secrets.accountId)}`,
    { method: 'POST', headers: { authorization: `Basic ${basic}` } },
    10_000,
  );
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
  if (!res.ok || !data.access_token) throw new AppError('zoom_auth_failed', 400);
  tokenCache.set(cacheKey, { token: data.access_token, until: Date.now() + Math.max(60, (data.expires_in ?? 3600) - 120) * 1000 });
  return data.access_token;
}

export async function connectZoom(
  userId: string,
  input: { accountId: string; clientId: string; clientSecret: string },
  actor: string,
): Promise<void> {
  const secrets = { accountId: input.accountId.trim(), clientId: input.clientId.trim(), clientSecret: input.clientSecret.trim() };
  if (!secrets.accountId || !secrets.clientId || !secrets.clientSecret) throw new AppError('invalid_input');
  await zoomToken(secrets);
  await saveRow(userId, 'zoom', { secrets, settings: {}, connectedBy: actor });
  await logApp(userId, 'zoom', 'connected', 'ok');
}

/** Crea una reunión de Zoom para una actividad de tipo reunión y pone el link al principio del cuerpo. */
export async function createZoomForActivity(userId: string, activityId: string): Promise<{ joinUrl: string }> {
  const row = await getRow(userId, 'zoom');
  if (!row) throw new AppError('zoom_not_connected', 409);
  const activity = (await getDb()
    .prepare('SELECT * FROM crm_activities WHERE id = ? AND user_id = ?')
    .get(activityId, userId)) as { id: string; type: string; subject: string; body: string; due_at: string | null; duration_min: number | null } | undefined;
  if (!activity) throw new AppError('not_found', 404);
  if (activity.type !== 'meeting') throw new AppError('not_a_meeting');
  const secrets = secretsOf(row);
  let joinUrl: string;
  try {
    if (appsFake()) {
      joinUrl = `https://zoom.us/j/9${activityId.replace(/\D/g, '').padEnd(9, '0').slice(0, 9)}`;
    } else {
      const token = await zoomToken(secrets);
      const start = activity.due_at ? new Date(`${activity.due_at.replace(' ', 'T')}${activity.due_at.includes('Z') ? '' : 'Z'}`) : null;
      const res = await safeFetch(
        'https://api.zoom.us/v2/users/me/meetings',
        {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            topic: (activity.subject || 'Meeting').slice(0, 200),
            type: start && !Number.isNaN(start.getTime()) ? 2 : 1,
            ...(start && !Number.isNaN(start.getTime()) ? { start_time: start.toISOString().replace(/\.\d{3}Z$/, 'Z') } : {}),
            duration: activity.duration_min || ZOOM_DEFAULT_MINUTES,
          }),
        },
        10_000,
      );
      const data = (await res.json().catch(() => ({}))) as { join_url?: string; message?: string };
      if (!res.ok || !data.join_url) throw new AppError(`zoom_error`, 502);
      joinUrl = data.join_url;
    }
  } catch (err) {
    await logApp(userId, 'zoom', 'meeting', 'error', err instanceof Error ? err.message : 'error');
    throw err instanceof AppError ? err : new AppError('zoom_error', 502);
  }
  await getDb()
    .prepare("UPDATE crm_activities SET body = ?, updated_at = datetime('now') WHERE id = ?")
    .run(withZoomLine(activity.body ?? '', joinUrl), activityId);
  await logApp(userId, 'zoom', 'meeting', 'ok', activity.subject);
  return { joinUrl };
}

/**
 * Cal: una reunión de Zoom por reserva con la app Server-to-Server del
 * workspace. Se crea a nombre del anfitrión si es usuario de esa cuenta de
 * Zoom (users/{email}); si no, a nombre de la cuenta (users/me). Devuelve el
 * id y el link, o null si el workspace no tiene Zoom conectado.
 */
export async function createZoomMeeting(
  userId: string,
  input: { topic: string; start: Date; durationMin: number; hostEmail?: string | null; agenda?: string; logLabel?: string },
): Promise<{ id: string; joinUrl: string } | null> {
  const row = await getRow(userId, 'zoom');
  if (!row) return null;
  if (appsFake()) {
    const id = `9${String(input.start.getTime()).slice(-9)}`;
    await logApp(userId, 'zoom', 'meeting', 'ok', input.logLabel ?? input.topic);
    return { id, joinUrl: `https://zoom.us/j/${id}` };
  }
  const token = await zoomToken(secretsOf(row));
  const body = JSON.stringify({
    topic: input.topic.slice(0, 200),
    type: 2,
    start_time: input.start.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    duration: Math.max(1, input.durationMin),
    agenda: (input.agenda ?? '').slice(0, 2000),
    settings: { join_before_host: true, waiting_room: false },
  });
  const post = (who: string) =>
    safeFetch(
      `https://api.zoom.us/v2/users/${encodeURIComponent(who)}/meetings`,
      { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body },
      10_000,
    );
  let res = input.hostEmail ? await post(input.hostEmail).catch(() => null) : null;
  // El anfitrión no es usuario de la cuenta de Zoom: va a nombre de la cuenta.
  if (!res || !res.ok) res = await post('me').catch(() => null);
  const data = res ? ((await res.json().catch(() => ({}))) as { id?: number | string; join_url?: string }) : {};
  if (!res?.ok || !data.join_url || !data.id) {
    await logApp(userId, 'zoom', 'meeting', 'error', `zoom_${res?.status ?? 0}`);
    throw new AppError('zoom_error', 502);
  }
  await logApp(userId, 'zoom', 'meeting', 'ok', input.logLabel ?? input.topic);
  return { id: String(data.id), joinUrl: data.join_url };
}

/** Mueve una reunión de Zoom de Cal (reprogramación). */
export async function updateZoomMeeting(userId: string, meetingId: string, input: { start: Date; durationMin: number }): Promise<void> {
  const row = await getRow(userId, 'zoom');
  if (!row || appsFake()) return;
  const token = await zoomToken(secretsOf(row));
  await safeFetch(
    `https://api.zoom.us/v2/meetings/${encodeURIComponent(meetingId)}`,
    {
      method: 'PATCH',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ start_time: input.start.toISOString().replace(/\.\d{3}Z$/, 'Z'), duration: Math.max(1, input.durationMin) }),
    },
    10_000,
  ).catch(() => null);
}

/** Borra una reunión de Zoom de Cal (cancelación). */
export async function deleteZoomMeeting(userId: string, meetingId: string): Promise<void> {
  const row = await getRow(userId, 'zoom');
  if (!row || appsFake()) return;
  const token = await zoomToken(secretsOf(row));
  await safeFetch(
    `https://api.zoom.us/v2/meetings/${encodeURIComponent(meetingId)}`,
    { method: 'DELETE', headers: { authorization: `Bearer ${token}` } },
    10_000,
  ).catch(() => null);
}

// ---------- Stripe ----------

const STRIPE_API = 'https://api.stripe.com/v1';

export async function stripeSecretFor(userId: string): Promise<string> {
  return secretsOf(await getRow(userId, 'stripe')).secretKey ?? '';
}

export async function stripeRequest(
  key: string,
  method: 'GET' | 'POST',
  path: string,
  form?: URLSearchParams,
): Promise<Record<string, unknown>> {
  const res = await safeFetch(
    `${STRIPE_API}${path}`,
    {
      method,
      headers: {
        authorization: `Bearer ${key}`,
        ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
      },
      body: form?.toString(),
    },
    10_000,
  );
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new AppError(res.status === 401 ? 'stripe_invalid_key' : 'stripe_error', 502);
  return data;
}

export async function connectStripe(
  userId: string,
  input: { secretKey: string; webhookSecret?: string },
  actor: string,
): Promise<void> {
  const secretKey = input.secretKey.trim();
  if (!/^(sk|rk)_(test|live)_[A-Za-z0-9]{8,}$/.test(secretKey)) throw new AppError('stripe_invalid_key');
  if (!appsFake()) await stripeRequest(secretKey, 'GET', '/account');
  const existing = await getRow(userId, 'stripe');
  const prev = secretsOf(existing);
  await saveRow(userId, 'stripe', {
    secrets: { secretKey, webhookSecret: (input.webhookSecret ?? '').trim() || prev.webhookSecret || '' },
    settings: settingsOf(existing),
    webhookToken: existing?.webhook_token ?? randomBytes(18).toString('base64url'),
    connectedBy: actor,
  });
  await logApp(userId, 'stripe', 'connected', 'ok', secretKey.includes('_live_') ? 'live' : 'test');
}

/** Guarda solo el signing secret (se crea el endpoint en Stripe después de conectar). */
export async function setStripeWebhookSecret(userId: string, webhookSecret: string): Promise<boolean> {
  const row = await getRow(userId, 'stripe');
  if (!row) return false;
  const secret = webhookSecret.trim();
  if (secret && !/^whsec_[A-Za-z0-9]+$/.test(secret)) throw new AppError('stripe_invalid_webhook_secret');
  await saveRow(userId, 'stripe', { secrets: { ...secretsOf(row), webhookSecret: secret } });
  return true;
}

export async function stripeWebhookConfigured(userId: string): Promise<boolean> {
  return !!secretsOf(await getRow(userId, 'stripe')).webhookSecret;
}

interface StripeCustomer {
  id: string;
  email: string | null;
  name: string | null;
  phone: string | null;
}

const FAKE_CUSTOMERS: StripeCustomer[] = [
  { id: 'cus_fake_1', email: 'grace@hopper.dev', name: 'Grace Hopper', phone: null },
  { id: 'cus_fake_2', email: 'alan@turing.dev', name: 'Alan Turing', phone: '+44 20 7946 0000' },
];

/** Clientes de Stripe → contactos (por email; los que ya existen no se duplican). */
export async function syncStripeCustomers(userId: string): Promise<{ created: number; existing: number }> {
  const key = await stripeSecretFor(userId);
  if (!key) throw new AppError('stripe_not_connected', 409);
  const customers: StripeCustomer[] = [];
  if (appsFake()) customers.push(...FAKE_CUSTOMERS);
  else {
    let after = '';
    for (let page = 0; page < 10; page++) {
      const data = await stripeRequest(key, 'GET', `/customers?limit=100${after ? `&starting_after=${encodeURIComponent(after)}` : ''}`);
      const list = (Array.isArray(data.data) ? data.data : []) as StripeCustomer[];
      customers.push(...list);
      if (!data.has_more || !list.length) break;
      after = list[list.length - 1].id;
    }
  }
  const { findOrCreateContact } = await import('./crm-integrations');
  let created = 0;
  let existing = 0;
  for (const c of customers) {
    if (!c.email) continue;
    const res = await findOrCreateContact(userId, { email: c.email, name: c.name, phone: c.phone, source: 'other' });
    if (res.created) created++;
    else existing++;
  }
  await logApp(userId, 'stripe', 'sync', 'ok', `${created} new, ${existing} existing`);
  return { created, existing };
}

function emailOf(obj: Record<string, unknown>): string {
  const billing = (obj.billing_details ?? {}) as Record<string, unknown>;
  const details = (obj.customer_details ?? {}) as Record<string, unknown>;
  for (const v of [obj.email, obj.customer_email, obj.receipt_email, billing.email, details.email]) {
    if (typeof v === 'string' && v.includes('@')) return v;
  }
  return '';
}

function amountOf(obj: Record<string, unknown>): { amount: number; currency: string } {
  const currency = String(obj.currency ?? 'usd').toUpperCase();
  const raw = Number(obj.amount_paid ?? obj.amount_total ?? obj.amount ?? 0);
  const zeroDecimal = ['JPY', 'KRW', 'CLP', 'VND', 'PYG', 'UGX', 'XAF', 'XOF'].includes(currency);
  return { amount: zeroDecimal ? raw : raw / 100, currency };
}

export type StripeAppOutcome = 'ignored' | 'duplicate' | 'contact' | 'payment' | 'quote_paid';

/**
 * Webhook de Stripe para el workspace dueño de `token`. Verifica la firma,
 * ignora eventos repetidos (crm_stripe_events) y:
 * - customer.created → contacto;
 * - charge.succeeded / invoice.paid → actividad "Payment received" en el
 *   contacto del email; con metadata.deal_id del workspace, el deal pasa a ganado;
 * - checkout.session.completed de una cotización → cotización pagada.
 */
export async function handleStripeAppWebhook(token: string, rawBody: string, signature: string | null): Promise<StripeAppOutcome> {
  const row = (await getDb().prepare("SELECT * FROM crm_apps WHERE app = 'stripe' AND webhook_token = ?").get(token)) as
    | AppRow
    | undefined;
  if (!row) throw new AppError('not_found', 404);
  const secret = secretsOf(row).webhookSecret;
  if (!secret) throw new AppError('webhook_not_configured', 409);
  if (!verifyStripeSignature(rawBody, signature, secret)) throw new AppError('invalid_signature', 400);
  let event: { id?: string; type?: string; data?: { object?: Record<string, unknown> } };
  try {
    event = JSON.parse(rawBody);
  } catch {
    throw new AppError('invalid_input', 400);
  }
  const userId = row.user_id;
  if (!event.id || !event.type) return 'ignored';
  const fresh = await getDb()
    .prepare('INSERT OR IGNORE INTO crm_stripe_events (event_id, user_id, type) VALUES (?, ?, ?)')
    .run(`${userId}:${event.id}`, userId, event.type);
  if (fresh.changes === 0) return 'duplicate';
  const obj = event.data?.object ?? {};
  const meta = (obj.metadata ?? {}) as Record<string, string>;

  // Link: venta atribuida al click que trajo al cliente (zs_id o zs_customer_id).
  if (event.type === 'checkout.session.completed' || event.type === 'invoice.paid') {
    try {
      const { attributeStripeEvent } = await import('./link-conversions');
      if ((await attributeStripeEvent(userId, event)) === 'sale') {
        await logApp(userId, 'stripe', 'link.sale', 'ok', String(obj.id ?? ''));
      }
    } catch {
      /* la atribución no corta el resto del webhook */
    }
  }

  if (event.type === 'checkout.session.completed' && meta.source === 'zerosoft_crm_quote') {
    if (obj.payment_status !== 'paid') return 'ignored';
    const { markQuotePaidFromSession } = await import('./crm-quote-pay');
    const ok = await markQuotePaidFromSession(userId, obj);
    if (ok) await logApp(userId, 'stripe', 'quote.paid', 'ok', String(meta.quote_number ?? ''));
    return ok ? 'quote_paid' : 'ignored';
  }
  const { findOrCreateContact } = await import('./crm-integrations');
  if (event.type === 'customer.created') {
    const email = emailOf(obj);
    if (!email) return 'ignored';
    await findOrCreateContact(userId, { email, name: (obj.name as string) ?? null, phone: (obj.phone as string) ?? null, source: 'other' });
    await logApp(userId, 'stripe', 'customer.created', 'ok', email);
    return 'contact';
  }
  if (event.type === 'charge.succeeded' || event.type === 'invoice.paid') {
    // Los cobros de cotizaciones ya quedan registrados por checkout.session.completed.
    if (meta.source === 'zerosoft_crm_quote') return 'ignored';
    const email = emailOf(obj);
    const { amount, currency } = amountOf(obj);
    const crm = await import('./crm');
    let dealId: string | null = null;
    if (meta.deal_id) {
      const deal = (await getDb().prepare('SELECT id FROM crm_deals WHERE id = ? AND user_id = ?').get(meta.deal_id, userId)) as
        | { id: string }
        | undefined;
      dealId = deal?.id ?? null;
    }
    if (!email && !dealId) return 'ignored';
    const contact = email ? (await findOrCreateContact(userId, { email, name: null, source: 'other' })).contact : null;
    const money = new Intl.NumberFormat('en', { style: 'currency', currency }).format(amount);
    await crm.createActivity(userId, {
      type: 'note',
      subject: `Payment received: ${money}`,
      body: [
        `Stripe ${event.type === 'invoice.paid' ? 'invoice' : 'charge'} ${String(obj.id ?? '')}`,
        typeof obj.description === 'string' && obj.description ? obj.description : '',
      ]
        .filter(Boolean)
        .join('\n'),
      contactId: contact?.id ?? null,
      dealId,
    });
    if (dealId) await markDealWon(userId, dealId, 'stripe payment');
    await logApp(userId, 'stripe', event.type, 'ok', `${money}${email ? ` · ${email}` : ''}`);
    return 'payment';
  }
  return 'ignored';
}

/** Mueve el deal a la primera etapa ganada de su pipeline si todavía está abierto. */
export async function markDealWon(userId: string, dealId: string, reason: string): Promise<boolean> {
  const deal = (await getDb().prepare('SELECT * FROM crm_deals WHERE id = ? AND user_id = ?').get(dealId, userId)) as
    | { id: string; pipeline_id: string; stage_id: string }
    | undefined;
  if (!deal) return false;
  const current = (await getDb().prepare('SELECT is_won, is_lost FROM crm_stages WHERE id = ?').get(deal.stage_id)) as
    | { is_won: number; is_lost: number }
    | undefined;
  if (current?.is_won) return false;
  const won = (await getDb()
    .prepare('SELECT id FROM crm_stages WHERE pipeline_id = ? AND is_won = 1 ORDER BY position ASC LIMIT 1')
    .get(deal.pipeline_id)) as { id: string } | undefined;
  if (!won) return false;
  const { moveDeal } = await import('./crm');
  await moveDeal(userId, deal.id, won.id, null, undefined, reason, { enforceRequired: false });
  return true;
}

// ---------- Zapier / Make ----------

export async function connectAutomation(
  userId: string,
  app: 'zapier' | 'make',
  input: { hookUrl: string; events?: string[] },
  actor: string,
): Promise<void> {
  if (!isAutomationHookUrl(app, input.hookUrl)) throw new AppError(app === 'zapier' ? 'invalid_zapier_url' : 'invalid_make_url');
  const { WEBHOOK_EVENTS } = await import('./webhooks-events');
  const events = (input.events?.length ? input.events : [...AUTOMATION_DEFAULT_EVENTS]).filter((e): e is WebhookEvent =>
    (WEBHOOK_EVENTS as readonly string[]).includes(e),
  );
  if (!events.length) throw new AppError('invalid_input');
  const previous = await getRow(userId, app);
  const prevHook = settingsOf(previous).webhookId;
  const hook = await createWebhook(userId, { url: input.hookUrl, events, createdBy: actor });
  if (typeof prevHook === 'string') await deleteWebhook(userId, prevHook);
  await saveRow(userId, app, { secrets: {}, settings: { hookUrl: input.hookUrl, webhookId: hook.id, events }, connectedBy: actor });
  await logApp(userId, app, 'connected', 'ok');
}
