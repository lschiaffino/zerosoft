/**
 * Integraciones propias de Link (las de todo el workspace, como Slack,
 * Stripe, Zapier y Make, viven en lib/crm-apps.ts):
 *
 * - Shopify: webhook "Order payment" (orders/paid) firmado con HMAC. La venta
 *   se atribuye al click por el ?zs_id= con el que la visita llegó a la
 *   tienda (landing_site) o por el atributo de carrito zs_id.
 * - Segment: cada click, lead y venta de Link sale como evento `track` a la
 *   fuente de Segment (Link Clicked, Lead Created, Sale Created), sin IP ni
 *   datos del visitante.
 *
 * Los secretos se guardan cifrados (lib/secret-box) y nunca vuelven a la UI.
 * LINK_INTEGRATIONS_FAKE=1 (tests) no sale a internet. Server-only.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { getDb } from './db';
import { open, seal } from './secret-box';
import { trackSale, ConversionError } from './link-conversions';
import { CLICK_ID_RE } from './link-click-id';

export const LINK_INTEGRATIONS = ['shopify', 'segment'] as const;
export type LinkIntegrationKey = (typeof LINK_INTEGRATIONS)[number];

export class IntegrationError extends Error {
  constructor(
    public code: string,
    public status = 400,
  ) {
    super(code);
  }
}

function fake(): boolean {
  return process.env.LINK_INTEGRATIONS_FAKE === '1' && process.env.VERCEL_ENV !== 'production';
}

function baseUrl(): string {
  return (process.env.NEXTAUTH_URL ?? 'https://zerosoft.ai').replace(/\/$/, '');
}

interface Row {
  user_id: string;
  kind: LinkIntegrationKey;
  token: string | null;
  secrets: string;
  settings: string;
  last_used_at: string | null;
  last_error: string | null;
  connected_by: string | null;
  connected_at: string;
}

export interface LinkIntegrationView {
  key: LinkIntegrationKey;
  connected: boolean;
  connectedAt: string | null;
  lastUsedAt: string | null;
  lastError: string | null;
  /** Lo que se muestra del secreto (enmascarado). */
  hint: string;
  /** Shopify: URL del webhook para pegar en la tienda. */
  webhookUrl: string | null;
}

function secretsOf(row: Row | null): Record<string, string> {
  if (!row?.secrets) return {};
  try {
    return JSON.parse(open(row.secrets) || '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

function mask(v: string): string {
  if (!v) return '';
  return v.length <= 8 ? `${v.slice(0, 2)}…` : `${v.slice(0, 4)}…${v.slice(-4)}`;
}

async function getRow(userId: string, kind: LinkIntegrationKey): Promise<Row | null> {
  return ((await getDb().prepare('SELECT * FROM link_integrations WHERE user_id = ? AND kind = ?').get(userId, kind)) as Row | undefined) ?? null;
}

export async function listLinkIntegrations(userId: string): Promise<LinkIntegrationView[]> {
  const rows = (await getDb().prepare('SELECT * FROM link_integrations WHERE user_id = ?').all(userId)) as Row[];
  return LINK_INTEGRATIONS.map((key) => {
    const row = rows.find((r) => r.kind === key) ?? null;
    const s = secretsOf(row);
    return {
      key,
      connected: !!row,
      connectedAt: row?.connected_at ?? null,
      lastUsedAt: row?.last_used_at ?? null,
      lastError: row?.last_error ?? null,
      hint: key === 'shopify' ? mask(s.webhookSecret ?? '') : mask(s.writeKey ?? ''),
      webhookUrl: key === 'shopify' && row?.token ? `${baseUrl()}/api/links/shopify-webhook?token=${row.token}` : null,
    };
  });
}

export async function connectLinkIntegration(
  userId: string,
  kind: LinkIntegrationKey,
  input: { secret: string },
  actor: string,
): Promise<void> {
  const secret = input.secret.trim();
  if (kind === 'shopify' && !/^[A-Za-z0-9_.:-]{16,200}$/.test(secret)) throw new IntegrationError('invalid_shopify_secret');
  if (kind === 'segment' && !/^[A-Za-z0-9]{16,64}$/.test(secret)) throw new IntegrationError('invalid_segment_key');
  const existing = await getRow(userId, kind);
  const token = existing?.token ?? (kind === 'shopify' ? randomBytes(18).toString('base64url') : null);
  const secrets = seal(JSON.stringify(kind === 'shopify' ? { webhookSecret: secret } : { writeKey: secret }));
  await getDb()
    .prepare(
      `INSERT INTO link_integrations (user_id, kind, token, secrets, connected_by) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (user_id, kind) DO UPDATE SET secrets = excluded.secrets, token = excluded.token, last_error = NULL`,
    )
    .run(userId, kind, token, secrets, actor);
  configCache.delete(userId);
}

export async function disconnectLinkIntegration(userId: string, kind: LinkIntegrationKey): Promise<boolean> {
  const res = await getDb().prepare('DELETE FROM link_integrations WHERE user_id = ? AND kind = ?').run(userId, kind);
  configCache.delete(userId);
  return res.changes > 0;
}

const lastMarked = new Map<string, number>();

async function markUsed(userId: string, kind: LinkIntegrationKey, error: string | null): Promise<void> {
  // Segment recibe cada click: el "último uso" se escribe a lo sumo una vez por minuto (los errores siempre).
  const key = `${userId}:${kind}`;
  if (!error && Date.now() - (lastMarked.get(key) ?? 0) < 60_000) return;
  lastMarked.set(key, Date.now());
  await getDb()
    .prepare(`UPDATE link_integrations SET last_used_at = datetime('now'), last_error = ? WHERE user_id = ? AND kind = ?`)
    .run(error, userId, kind);
}

// ---------- Shopify ----------

/** HMAC-SHA256 en base64 del cuerpo crudo, como lo firma Shopify. */
export function shopifySignature(rawBody: string, secret: string): string {
  return createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64');
}

export function verifyShopifySignature(rawBody: string, header: string | null, secret: string): boolean {
  if (!header || !secret) return false;
  const expected = Buffer.from(shopifySignature(rawBody, secret));
  const got = Buffer.from(header.trim());
  return got.length === expected.length && timingSafeEqual(got, expected);
}

const ZERO_DECIMAL = ['JPY', 'KRW', 'CLP', 'VND', 'PYG', 'UGX', 'XAF', 'XOF'];

/** "49.90" → 4990 (unidades menores). */
export function toMinorUnits(amount: string | number, currency: string): number {
  const n = Number(amount);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(ZERO_DECIMAL.includes(currency.toUpperCase()) ? n : n * 100);
}

/** Click id de un pedido: atributo de carrito zs_id o ?zs_id= de la página de entrada. */
export function shopifyClickId(order: Record<string, unknown>): string | null {
  const attrs = Array.isArray(order.note_attributes) ? (order.note_attributes as Array<{ name?: unknown; value?: unknown }>) : [];
  const attr = attrs.find((a) => a?.name === 'zs_id');
  if (attr && typeof attr.value === 'string' && CLICK_ID_RE.test(attr.value)) return attr.value;
  for (const field of ['landing_site', 'landing_site_ref', 'referring_site']) {
    const raw = order[field];
    if (typeof raw !== 'string' || !raw.includes('zs_id=')) continue;
    try {
      const id = new URL(raw, 'https://shop.invalid').searchParams.get('zs_id');
      if (id && CLICK_ID_RE.test(id)) return id;
    } catch {
      /* sigue */
    }
  }
  return null;
}

export type ShopifyOutcome = 'sale' | 'duplicate' | 'ignored';

/** Webhook de Shopify (orders/paid) del workspace dueño de `token`. */
export async function handleShopifyWebhook(
  token: string,
  rawBody: string,
  headers: { hmac: string | null; topic: string | null },
): Promise<ShopifyOutcome> {
  if (!token || token.length > 64) throw new IntegrationError('not_found', 404);
  const row = (await getDb().prepare("SELECT * FROM link_integrations WHERE kind = 'shopify' AND token = ?").get(token)) as Row | undefined;
  if (!row) throw new IntegrationError('not_found', 404);
  const secret = secretsOf(row).webhookSecret ?? '';
  if (!verifyShopifySignature(rawBody, headers.hmac, secret)) throw new IntegrationError('invalid_signature', 401);
  // Solo pedidos pagados: sin topic (no es un webhook de Shopify) o con otro, no cuenta.
  if (headers.topic !== 'orders/paid' && headers.topic !== 'orders/create') return 'ignored';
  let order: Record<string, unknown>;
  try {
    order = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    throw new IntegrationError('invalid_input', 400);
  }
  if (order.id === undefined || order.id === null || String(order.id).trim() === '') throw new IntegrationError('invalid_input', 400);
  const status = typeof order.financial_status === 'string' ? order.financial_status : null;
  if (headers.topic === 'orders/create' ? status !== 'paid' : status !== null && status !== 'paid' && status !== 'partially_paid') {
    return 'ignored';
  }
  const clickId = shopifyClickId(order);
  const customer = (order.customer ?? {}) as Record<string, unknown>;
  const customerExternalId = customer.id ? `shopify:${String(customer.id)}` : null;
  if (!clickId && !customerExternalId) return 'ignored';
  const currency = String(order.currency ?? order.presentment_currency ?? 'USD').toUpperCase();
  try {
    const res = await trackSale(row.user_id, {
      clickId,
      customerExternalId,
      amount: toMinorUnits(String(order.total_price ?? order.current_total_price ?? '0'), currency),
      currency,
      invoiceId: `shopify:${String(order.id)}`,
      source: 'shopify',
      eventName: 'Order paid',
    });
    await markUsed(row.user_id, 'shopify', null);
    return res.duplicate ? 'duplicate' : 'sale';
  } catch (err) {
    if (err instanceof ConversionError) {
      // Pedido que no vino de un link (o de un click de otro workspace): no es un error.
      await markUsed(row.user_id, 'shopify', null);
      return 'ignored';
    }
    throw err;
  }
}

// ---------- Segment ----------

const configCache = new Map<string, { at: number; writeKey: string | null }>();
const CACHE_MS = 60_000;

async function segmentKey(userId: string): Promise<string | null> {
  const hit = configCache.get(userId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.writeKey;
  const row = await getRow(userId, 'segment');
  const writeKey = row ? (secretsOf(row).writeKey ?? null) : null;
  configCache.set(userId, { at: Date.now(), writeKey });
  return writeKey;
}

/** Evento `track` de Segment para un evento de Link (null = no se manda). */
export function segmentPayload(type: string, data: unknown): Record<string, unknown> | null {
  const d = (data ?? {}) as Record<string, unknown>;
  const link = (d.link ?? {}) as Record<string, unknown>;
  const linkProps = { linkId: link.id, shortLink: link.short_url, url: link.url, domain: link.domain ?? null, tags: link.tags ?? [] };
  if (type === 'link.clicked') {
    const click = (d.click ?? {}) as Record<string, unknown>;
    return {
      event: 'Link Clicked',
      anonymousId: `zs-${String(link.id ?? 'link')}-${Date.now().toString(36)}`,
      properties: { ...linkProps, country: click.country ?? null, city: click.city ?? null, device: click.device ?? null, browser: click.browser ?? null, os: click.os ?? null, referrer: click.referrer ?? null },
      timestamp: click.at ?? new Date().toISOString(),
    };
  }
  if (type === 'link.lead') {
    const lead = (d.lead ?? {}) as Record<string, unknown>;
    const customer = (lead.customer ?? {}) as Record<string, unknown>;
    return {
      event: 'Lead Created',
      userId: customer.externalId,
      properties: { ...linkProps, eventName: lead.eventName, clickId: lead.clickId },
      timestamp: new Date().toISOString(),
    };
  }
  if (type === 'link.sale') {
    const sale = (d.sale ?? {}) as Record<string, unknown>;
    const customer = (sale.customer ?? {}) as Record<string, unknown>;
    const currency = String(sale.currency ?? 'USD');
    const amount = Number(sale.amount ?? 0);
    return {
      event: 'Sale Created',
      ...(customer.externalId ? { userId: customer.externalId } : { anonymousId: `zs-sale-${String(sale.id ?? Date.now())}` }),
      properties: {
        ...linkProps,
        eventName: sale.eventName,
        revenue: ZERO_DECIMAL.includes(currency) ? amount : amount / 100,
        currency,
        invoiceId: sale.invoiceId ?? null,
        source: sale.source ?? null,
      },
      timestamp: new Date().toISOString(),
    };
  }
  return null;
}

/** Despacha un evento de Link a las integraciones del workspace (lo llama lib/events.ts). Nunca lanza. */
export async function dispatchLinkEvent(userId: string, type: string, data: unknown): Promise<void> {
  try {
    const payload = segmentPayload(type, data);
    if (!payload) return;
    const writeKey = await segmentKey(userId);
    if (!writeKey) return;
    if (fake()) {
      await markUsed(userId, 'segment', null);
      return;
    }
    // Host fijo de Segment (no es una URL del usuario).
    const res = await fetch('https://api.segment.io/v1/track', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Basic ${Buffer.from(`${writeKey}:`).toString('base64')}` },
      body: JSON.stringify({ ...payload, context: { library: { name: 'zerosoft-link', version: '1.0.0' } } }),
      signal: AbortSignal.timeout(5000),
    });
    await markUsed(userId, 'segment', res.ok ? null : `segment_${res.status}`);
  } catch (err) {
    await markUsed(userId, 'segment', err instanceof Error ? err.name : 'error').catch(() => {});
  }
}
