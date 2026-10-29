/**
 * Agents — conexiones con servicios de terceros que trae el dueño (sus
 * propias credenciales): Stripe y Shopify (herramientas que consultan),
 * Slack, Messenger e Instagram (canales).
 *
 * - Se guardan en agents.integrations, con cada secreto cifrado (secret-box).
 *   La UI ve si está conectado, el modo y los últimos 4 caracteres: nunca el
 *   valor. Los secretos se suman a la redacción de la corrida (ningún eco de
 *   la API los devuelve al modelo ni al registro).
 * - Todas las llamadas salen por safeFetch a hosts fijos (api.stripe.com,
 *   <tienda>.myshopify.com, slack.com, graph.facebook.com): sin SSRF.
 * - AGENTS_INTEGRATIONS_FAKE=1 (solo en tests o DEMO_MODE) responde datos
 *   fijos sin salir a internet y guarda lo que se habría enviado.
 * Server-only.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { getDb } from './db';
import type { AgentRow } from './db';
import { open as openSecret, seal } from './secret-box';
import { readTextCapped, safeFetch, UnsafeUrlError } from './safe-fetch';

export const AGENT_INTEGRATION_KINDS = ['stripe', 'shopify', 'slack', 'meta'] as const;
export type AgentIntegrationKind = (typeof AGENT_INTEGRATION_KINDS)[number];

interface StoredIntegrations {
  stripe?: { key: string; mode: 'live' | 'test'; last4: string; connectedAt: string };
  shopify?: { shop: string; token: string; last4: string; connectedAt: string };
  slack?: { botToken: string; signingSecret: string; teamId: string; botUserId: string; last4: string; connectedAt: string };
  meta?: { pageToken: string; appSecret: string; verifyToken: string; pageId: string; pageName: string; last4: string; connectedAt: string };
}

/** Lo que ve la UI (sin secretos). */
export interface AgentIntegrationsDto {
  stripe: { connected: boolean; mode: 'live' | 'test' | null; last4: string | null };
  shopify: { connected: boolean; shop: string | null };
  slack: { connected: boolean; teamId: string | null; last4: string | null };
  meta: { connected: boolean; pageName: string | null; verifyToken: string | null };
}

export class IntegrationError extends Error {
  constructor(public code: string, public status = 400) {
    super(code);
  }
}

export function integrationsFake(): boolean {
  if (process.env.AGENTS_INTEGRATIONS_FAKE !== '1') return false;
  return process.env.NODE_ENV === 'test' || process.env.DEMO_MODE === 'true' || Boolean(process.env.CI);
}

function parseStored(raw: string | null | undefined): StoredIntegrations {
  try {
    const v = JSON.parse(raw || '{}') as StoredIntegrations;
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

export function integrationsDto(row: Pick<AgentRow, 'integrations'>): AgentIntegrationsDto {
  const s = parseStored(row.integrations);
  return {
    stripe: { connected: Boolean(s.stripe?.key), mode: s.stripe?.mode ?? null, last4: s.stripe?.last4 ?? null },
    shopify: { connected: Boolean(s.shopify?.token), shop: s.shopify?.shop ?? null },
    slack: { connected: Boolean(s.slack?.botToken), teamId: s.slack?.teamId || null, last4: s.slack?.last4 ?? null },
    meta: { connected: Boolean(s.meta?.pageToken), pageName: s.meta?.pageName || null, verifyToken: s.meta?.verifyToken ?? null },
  };
}

/** Secretos descifrados (server-only): para llamar al servicio y para la redacción. */
export function integrationSecrets(row: Pick<AgentRow, 'integrations'>) {
  const s = parseStored(row.integrations);
  return {
    stripeKey: openSecret(s.stripe?.key),
    shopify: s.shopify ? { shop: s.shopify.shop, token: openSecret(s.shopify.token) } : null,
    slack: s.slack ? { botToken: openSecret(s.slack.botToken), signingSecret: openSecret(s.slack.signingSecret), teamId: s.slack.teamId, botUserId: s.slack.botUserId } : null,
    meta: s.meta ? { pageToken: openSecret(s.meta.pageToken), appSecret: openSecret(s.meta.appSecret), verifyToken: s.meta.verifyToken, pageId: s.meta.pageId } : null,
  };
}

/** Todos los valores secretos de las conexiones (para que nunca lleguen al modelo ni al registro). */
export function integrationSecretValues(row: Pick<AgentRow, 'integrations'>): string[] {
  const s = integrationSecrets(row);
  return [s.stripeKey, s.shopify?.token ?? '', s.slack?.botToken ?? '', s.slack?.signingSecret ?? '', s.meta?.pageToken ?? '', s.meta?.appSecret ?? ''].filter(Boolean);
}

async function saveStored(workspaceId: string, agentId: string, next: StoredIntegrations): Promise<void> {
  await getDb()
    .prepare('UPDATE agents SET integrations = ?, updated_at = ? WHERE id = ? AND user_id = ?')
    .run(JSON.stringify(next), new Date().toISOString(), agentId, workspaceId);
}

const last4 = (v: string) => v.slice(-4);

// ---------- Llamadas HTTP ----------

const fakeSent: Array<{ kind: string; target: string; body: unknown }> = [];

/** Tests y e2e: lo que se habría mandado a Slack, Messenger o Instagram. */
export function fakeChannelOutbox(): ReadonlyArray<{ kind: string; target: string; body: unknown }> {
  return fakeSent;
}

async function getJson(url: string, headers: Record<string, string>, timeoutMs = 8000): Promise<{ status: number; data: unknown }> {
  try {
    const res = await safeFetch(url, { headers: { accept: 'application/json', 'user-agent': 'Zerosoft-Agents/1', ...headers } }, timeoutMs);
    const text = await readTextCapped(res, 2_000_000);
    let data: unknown = null;
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
    return { status: res.status, data };
  } catch (err) {
    if (err instanceof UnsafeUrlError) throw new IntegrationError('unsafe_url');
    throw new IntegrationError(err instanceof Error && err.name === 'TimeoutError' ? 'timeout' : 'network_error', 502);
  }
}

async function postJson(url: string, headers: Record<string, string>, body: unknown, timeoutMs = 8000): Promise<{ status: number; data: unknown }> {
  try {
    const res = await safeFetch(
      url,
      { method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8', 'user-agent': 'Zerosoft-Agents/1', ...headers }, body: JSON.stringify(body) },
      timeoutMs,
    );
    const text = await readTextCapped(res, 500_000);
    let data: unknown = null;
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
    return { status: res.status, data };
  } catch (err) {
    if (err instanceof UnsafeUrlError) throw new IntegrationError('unsafe_url');
    throw new IntegrationError(err instanceof Error && err.name === 'TimeoutError' ? 'timeout' : 'network_error', 502);
  }
}

// ---------- Stripe ----------

export const STRIPE_KEY_RE = /^(sk|rk)_(live|test)_[A-Za-z0-9]{16,}$/;

interface StripeList<T> {
  data?: T[];
}

/** Cliente de Stripe por email, con sus suscripciones y últimas facturas (solo lectura). */
export async function stripeCustomerSummary(key: string, email: string): Promise<Record<string, unknown>> {
  if (integrationsFake()) {
    if (email.toLowerCase() !== 'ana@example.com') return { found: false };
    return {
      found: true,
      customer: { name: 'Ana Example', email: 'ana@example.com', currency: 'usd', delinquent: false },
      subscriptions: [{ status: 'active', plan: 'Pro', amount: 49, currency: 'usd', interval: 'month', currentPeriodEnd: '2026-11-28', cancelAtPeriodEnd: false }],
      invoices: [{ number: 'INV-0042', status: 'paid', amount: 49, currency: 'usd', created: '2026-10-28', url: 'https://invoice.stripe.com/i/fake' }],
    };
  }
  const auth = { authorization: `Bearer ${key}` };
  const q = new URLSearchParams({ email, limit: '1' });
  const cust = await getJson(`https://api.stripe.com/v1/customers?${q}`, auth);
  if (cust.status === 401) return { error: 'stripe_auth' };
  if (cust.status >= 400) return { error: `stripe_${cust.status}` };
  const c = (cust.data as StripeList<Record<string, unknown>>)?.data?.[0];
  if (!c) return { found: false };
  const id = String(c.id ?? '');
  const subs = await getJson(`https://api.stripe.com/v1/subscriptions?${new URLSearchParams({ customer: id, status: 'all', limit: '5' })}`, auth);
  const invs = await getJson(`https://api.stripe.com/v1/invoices?${new URLSearchParams({ customer: id, limit: '5' })}`, auth);
  const day = (sec: unknown) => (typeof sec === 'number' ? new Date(sec * 1000).toISOString().slice(0, 10) : null);
  const money = (cents: unknown) => (typeof cents === 'number' ? cents / 100 : null);
  return {
    found: true,
    customer: { name: c.name ?? null, email: c.email ?? null, currency: c.currency ?? null, delinquent: c.delinquent === true },
    subscriptions: ((subs.data as StripeList<Record<string, unknown>>)?.data ?? []).map((s) => {
      const item = ((s.items as StripeList<Record<string, unknown>>)?.data ?? [])[0] as Record<string, unknown> | undefined;
      const price = (item?.price ?? {}) as Record<string, unknown>;
      const recurring = (price.recurring ?? {}) as Record<string, unknown>;
      return {
        status: s.status ?? null,
        plan: price.nickname ?? price.lookup_key ?? null,
        amount: money(price.unit_amount),
        currency: price.currency ?? null,
        interval: recurring.interval ?? null,
        currentPeriodEnd: day(s.current_period_end ?? item?.current_period_end),
        cancelAtPeriodEnd: s.cancel_at_period_end === true,
      };
    }),
    invoices: ((invs.data as StripeList<Record<string, unknown>>)?.data ?? []).map((i) => ({
      number: i.number ?? null,
      status: i.status ?? null,
      amount: money(i.amount_due),
      currency: i.currency ?? null,
      created: day(i.created),
      url: typeof i.hosted_invoice_url === 'string' ? i.hosted_invoice_url : null,
    })),
  };
}

// ---------- Shopify ----------

export const SHOPIFY_SHOP_RE = /^[a-z0-9][a-z0-9-]{0,60}\.myshopify\.com$/;
const SHOPIFY_API = '2024-10';

export function normalizeShop(raw: string): string | null {
  const s = raw.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const shop = s.endsWith('.myshopify.com') ? s : `${s}.myshopify.com`;
  return SHOPIFY_SHOP_RE.test(shop) ? shop : null;
}

/** Estado de un pedido por número y email (los dos tienen que coincidir, como la página de estado de Shopify). */
export async function shopifyOrderStatus(shop: string, token: string, orderNumber: string, email: string): Promise<Record<string, unknown>> {
  const number = orderNumber.replace(/^#/, '').trim();
  if (!/^[A-Za-z0-9-]{1,30}$/.test(number)) return { error: 'invalid_order_number' };
  if (integrationsFake()) {
    if (number !== '1001' || email.toLowerCase() !== 'ana@example.com') return { found: false };
    return {
      found: true,
      order: { name: '#1001', createdAt: '2026-10-20', financialStatus: 'paid', fulfillmentStatus: 'fulfilled', cancelled: false, total: '59.00', currency: 'USD', items: ['Blue mug x2'] },
      shipments: [{ status: 'in_transit', company: 'UPS', trackingNumber: '1Z999', trackingUrl: 'https://www.ups.com/track?tracknum=1Z999' }],
    };
  }
  const q = new URLSearchParams({ name: `#${number}`, status: 'any', limit: '5' });
  const res = await getJson(`https://${shop}/admin/api/${SHOPIFY_API}/orders.json?${q}`, { 'x-shopify-access-token': token });
  if (res.status === 401 || res.status === 403) return { error: 'shopify_auth' };
  if (res.status >= 400) return { error: `shopify_${res.status}` };
  const orders = ((res.data as { orders?: Array<Record<string, unknown>> })?.orders ?? []).filter(
    (o) => String(o.email ?? (o.customer as Record<string, unknown> | undefined)?.email ?? '').toLowerCase() === email.toLowerCase(),
  );
  const o = orders[0];
  // Sin coincidencia de email no se dice si el pedido existe.
  if (!o) return { found: false };
  return {
    found: true,
    order: {
      name: o.name ?? null,
      createdAt: typeof o.created_at === 'string' ? o.created_at.slice(0, 10) : null,
      financialStatus: o.financial_status ?? null,
      fulfillmentStatus: o.fulfillment_status ?? 'unfulfilled',
      cancelled: Boolean(o.cancelled_at),
      total: o.total_price ?? null,
      currency: o.currency ?? null,
      items: ((o.line_items as Array<Record<string, unknown>>) ?? []).slice(0, 10).map((li) => `${li.name ?? li.title ?? ''} x${li.quantity ?? 1}`),
    },
    shipments: ((o.fulfillments as Array<Record<string, unknown>>) ?? []).slice(0, 5).map((f) => ({
      status: f.shipment_status ?? f.status ?? null,
      company: f.tracking_company ?? null,
      trackingNumber: f.tracking_number ?? null,
      trackingUrl: typeof f.tracking_url === 'string' ? f.tracking_url : null,
    })),
  };
}

/** Productos activos de la tienda que coinciden con el texto (título). */
export async function shopifyProductSearch(shop: string, token: string, query: string): Promise<Record<string, unknown>> {
  if (integrationsFake()) {
    const all = [
      { title: 'Blue mug', price: '19.00', available: true, url: `https://${shop}/products/blue-mug` },
      { title: 'Red mug', price: '21.00', available: false, url: `https://${shop}/products/red-mug` },
    ];
    return { products: all.filter((p) => p.title.toLowerCase().includes(query.toLowerCase().split(' ')[0] ?? '')) };
  }
  const q = new URLSearchParams({ title: query.slice(0, 100), status: 'active', limit: '5', fields: 'title,handle,variants,status' });
  const res = await getJson(`https://${shop}/admin/api/${SHOPIFY_API}/products.json?${q}`, { 'x-shopify-access-token': token });
  if (res.status === 401 || res.status === 403) return { error: 'shopify_auth' };
  if (res.status >= 400) return { error: `shopify_${res.status}` };
  const products = ((res.data as { products?: Array<Record<string, unknown>> })?.products ?? []).map((p) => {
    const variants = (p.variants as Array<Record<string, unknown>>) ?? [];
    return {
      title: p.title ?? null,
      price: variants[0]?.price ?? null,
      available: variants.some((v) => Number(v.inventory_quantity ?? 1) > 0 || v.inventory_policy === 'continue'),
      url: typeof p.handle === 'string' ? `https://${shop}/products/${p.handle}` : null,
    };
  });
  return { products };
}

// ---------- Slack ----------

/** Firma de Slack (v0=HMAC-SHA256 de "v0:<ts>:<cuerpo>"), con 5 minutos de margen. */
export function verifySlackSignature(signingSecret: string, timestamp: string | null, body: string, signature: string | null, nowSec = Math.floor(Date.now() / 1000)): boolean {
  if (!signingSecret || !timestamp || !signature || !/^\d+$/.test(timestamp)) return false;
  if (Math.abs(nowSec - Number(timestamp)) > 300) return false;
  const expected = `v0=${createHmac('sha256', signingSecret).update(`v0:${timestamp}:${body}`).digest('hex')}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function slackPost(botToken: string, channel: string, text: string, threadTs?: string | null): Promise<boolean> {
  const body = { channel, text: text.slice(0, 3900), ...(threadTs ? { thread_ts: threadTs } : {}) };
  if (integrationsFake()) {
    fakeSent.push({ kind: 'slack', target: channel, body });
    return true;
  }
  const res = await postJson('https://slack.com/api/chat.postMessage', { authorization: `Bearer ${botToken}` }, body).catch(() => null);
  return Boolean(res && (res.data as { ok?: boolean })?.ok);
}

// ---------- Messenger e Instagram (Meta) ----------

/** X-Hub-Signature-256: sha256=HMAC del cuerpo con el app secret. */
export function verifyMetaSignature(appSecret: string, body: string, signature: string | null): boolean {
  if (!appSecret || !signature?.startsWith('sha256=')) return false;
  const expected = `sha256=${createHmac('sha256', appSecret).update(body).digest('hex')}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Respuesta por la Send API (sirve para Messenger e Instagram); con quick replies si hay botones. */
export async function metaSend(pageToken: string, recipientId: string, text: string, quickReplies: string[] = []): Promise<boolean> {
  const body = {
    recipient: { id: recipientId },
    messaging_type: 'RESPONSE',
    message: {
      text: text.slice(0, 1900),
      ...(quickReplies.length
        ? { quick_replies: quickReplies.slice(0, 13).map((q) => ({ content_type: 'text', title: q.slice(0, 20), payload: q.slice(0, 1000) })) }
        : {}),
    },
  };
  if (integrationsFake()) {
    fakeSent.push({ kind: 'meta', target: recipientId, body });
    return true;
  }
  // El token va en el header (no en la URL, que puede quedar en logs).
  const res = await postJson('https://graph.facebook.com/v21.0/me/messages', { authorization: `Bearer ${pageToken}` }, body).catch(() => null);
  return Boolean(res && res.status < 300);
}

// ---------- Conectar y desconectar ----------

export type ConnectInput =
  | { kind: 'stripe'; key: string }
  | { kind: 'shopify'; shop: string; token: string }
  | { kind: 'slack'; botToken: string; signingSecret: string }
  | { kind: 'meta'; pageToken: string; appSecret: string };

/**
 * Valida las credenciales contra el servicio (una lectura inocua) y las
 * guarda cifradas. Tira IntegrationError con un código para la UI.
 */
export async function connectIntegration(workspaceId: string, row: AgentRow, input: ConnectInput): Promise<AgentIntegrationsDto> {
  const stored = parseStored(row.integrations);
  const now = new Date().toISOString();
  const fake = integrationsFake();
  if (input.kind === 'stripe') {
    const key = input.key.trim();
    if (!STRIPE_KEY_RE.test(key)) throw new IntegrationError('invalid_stripe_key');
    if (!fake) {
      const res = await getJson('https://api.stripe.com/v1/customers?limit=1', { authorization: `Bearer ${key}` });
      if (res.status === 401) throw new IntegrationError('stripe_auth');
      if (res.status >= 400) throw new IntegrationError('stripe_permissions');
    }
    stored.stripe = { key: seal(key), mode: key.includes('_live_') ? 'live' : 'test', last4: last4(key), connectedAt: now };
  } else if (input.kind === 'shopify') {
    const shop = normalizeShop(input.shop);
    const token = input.token.trim();
    if (!shop) throw new IntegrationError('invalid_shop');
    if (!/^shpat_[A-Za-z0-9]{16,}$/.test(token) && !fake) throw new IntegrationError('invalid_shopify_token');
    if (!fake) {
      const res = await getJson(`https://${shop}/admin/api/${SHOPIFY_API}/shop.json`, { 'x-shopify-access-token': token });
      if (res.status === 401 || res.status === 403) throw new IntegrationError('shopify_auth');
      if (res.status >= 400) throw new IntegrationError('shopify_unreachable');
    }
    stored.shopify = { shop, token: seal(token), last4: last4(token), connectedAt: now };
  } else if (input.kind === 'slack') {
    const botToken = input.botToken.trim();
    const signingSecret = input.signingSecret.trim();
    if (!/^xoxb-[A-Za-z0-9-]{10,}$/.test(botToken)) throw new IntegrationError('invalid_slack_token');
    if (!/^[a-f0-9]{20,64}$/i.test(signingSecret)) throw new IntegrationError('invalid_slack_secret');
    let teamId = '';
    let botUserId = '';
    if (!fake) {
      const res = await postJson('https://slack.com/api/auth.test', { authorization: `Bearer ${botToken}` }, {});
      const d = res.data as { ok?: boolean; team_id?: string; user_id?: string } | null;
      if (!d?.ok) throw new IntegrationError('slack_auth');
      teamId = d.team_id ?? '';
      botUserId = d.user_id ?? '';
    } else {
      teamId = 'TFAKE';
      botUserId = 'UBOT';
    }
    stored.slack = { botToken: seal(botToken), signingSecret: seal(signingSecret), teamId, botUserId, last4: last4(botToken), connectedAt: now };
  } else {
    const pageToken = input.pageToken.trim();
    const appSecret = input.appSecret.trim();
    if (pageToken.length < 20 || /\s/.test(pageToken)) throw new IntegrationError('invalid_meta_token');
    if (!/^[a-f0-9]{16,64}$/i.test(appSecret)) throw new IntegrationError('invalid_meta_secret');
    let pageId = '';
    let pageName = '';
    if (!fake) {
      const res = await getJson('https://graph.facebook.com/v21.0/me?fields=id,name', { authorization: `Bearer ${pageToken}` });
      const d = res.data as { id?: string; name?: string } | null;
      if (res.status >= 400 || !d?.id) throw new IntegrationError('meta_auth');
      pageId = d.id;
      pageName = d.name ?? '';
    } else {
      pageId = 'PAGEFAKE';
      pageName = 'Fake page';
    }
    stored.meta = {
      pageToken: seal(pageToken),
      appSecret: seal(appSecret),
      verifyToken: stored.meta?.verifyToken || randomBytes(18).toString('base64url'),
      pageId,
      pageName,
      last4: last4(pageToken),
      connectedAt: now,
    };
  }
  await saveStored(workspaceId, row.id, stored);
  return integrationsDto({ integrations: JSON.stringify(stored) });
}

export async function disconnectIntegration(workspaceId: string, row: AgentRow, kind: AgentIntegrationKind): Promise<AgentIntegrationsDto> {
  const stored = parseStored(row.integrations);
  delete stored[kind];
  await saveStored(workspaceId, row.id, stored);
  return integrationsDto({ integrations: JSON.stringify(stored) });
}
