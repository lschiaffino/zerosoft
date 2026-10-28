/**
 * Conversiones de Link (como Dub Conversions): clicks → leads → ventas.
 *
 * 1. Un link con `track_conversion` le pone a cada visita un click id y lo
 *    manda al destino como ?zs_id=<id> (app/r/[slug]/route.ts).
 * 2. El sitio del cliente lo guarda (script /link-tracking.js, una cookie
 *    propia de su dominio) y, cuando alguien se registra, llama a
 *    POST /api/v1/links/track/lead con ese click id y su id de cliente.
 * 3. Las ventas llegan por POST /api/v1/links/track/sale (con el id de
 *    cliente), por Stripe (la conexión del workspace) o por Shopify.
 *
 * Nuestra analítica sigue sin cookies ni datos personales del visitante: el
 * click id es aleatorio y el lead lo identifica el cliente con su propio id
 * (nombre y email son opcionales y los manda el workspace). Server-only.
 */
import { getDb } from './db';
import { emitEventSoon } from './events';
import { linkShortUrl, parseTags, type LinkWithDomain } from './links';
import { CLICK_ID_RE } from './link-click-id';
import { linkAccess, type LinkViewer } from './link-folders';

export { CLICK_ID_PARAM, CLICK_ID_RE, newClickId, withClickId } from './link-click-id';

export class ConversionError extends Error {
  constructor(
    public code: string,
    public status = 400,
  ) {
    super(code);
  }
}

export type ConversionType = 'lead' | 'sale';
export type ConversionSource = 'api' | 'stripe' | 'shopify';

export interface ConversionDto {
  id: number;
  type: ConversionType;
  eventName: string;
  linkId: string;
  clickId: string | null;
  customerExternalId: string | null;
  /** Unidades menores (centavos). */
  amount: number;
  currency: string | null;
  invoiceId: string | null;
  source: ConversionSource;
  country: string | null;
  device: string | null;
  createdAt: string;
}

interface ConversionRow {
  id: number;
  user_id: string;
  link_id: string;
  click_id: string | null;
  type: ConversionType;
  event_name: string;
  customer_external_id: string | null;
  amount: number;
  currency: string | null;
  invoice_id: string | null;
  source: ConversionSource;
  country: string | null;
  device: string | null;
  metadata: string | null;
  ts: string;
}

function toDto(r: ConversionRow): ConversionDto {
  return {
    id: Number(r.id),
    type: r.type,
    eventName: r.event_name,
    linkId: r.link_id,
    clickId: r.click_id,
    customerExternalId: r.customer_external_id,
    amount: Number(r.amount ?? 0),
    currency: r.currency,
    invoiceId: r.invoice_id,
    source: r.source,
    country: r.country,
    device: r.device,
    createdAt: r.ts,
  };
}

interface ClickHit {
  click_id: string;
  link_id: string;
  country: string | null;
  device: string | null;
}

/** El click del workspace con ese id (null si no existe o es de otro workspace). */
async function clickOf(ws: string, clickId: string): Promise<ClickHit | null> {
  if (!CLICK_ID_RE.test(clickId)) return null;
  return ((await getDb()
    .prepare(
      `SELECT c.click_id, c.link_id, c.country, c.device FROM clicks c JOIN links l ON l.id = c.link_id
       WHERE c.click_id = ? AND l.user_id = ?`,
    )
    .get(clickId, ws)) as ClickHit | undefined) ?? null;
}

async function linkFor(ws: string, linkId: string): Promise<LinkWithDomain | null> {
  return ((await getDb()
    .prepare('SELECT l.*, d.hostname AS domain_hostname FROM links l LEFT JOIN link_domains d ON d.id = l.domain_id WHERE l.id = ? AND l.user_id = ?')
    .get(linkId, ws)) as LinkWithDomain | undefined) ?? null;
}

function linkPayload(link: LinkWithDomain | null) {
  if (!link) return null;
  return {
    id: link.id,
    slug: link.slug,
    domain: link.domain_hostname ?? null,
    url: link.url,
    short_url: linkShortUrl(link),
    tags: parseTags(link.tags),
  };
}

export interface CustomerInput {
  externalId: string;
  name?: string | null;
  email?: string | null;
}

const clean = (v: string | null | undefined, max: number): string | null => {
  const s = v?.trim();
  return s ? s.slice(0, max) : null;
};

function metadataJson(meta: Record<string, unknown> | null | undefined): string | null {
  if (!meta || typeof meta !== 'object') return null;
  const json = JSON.stringify(meta);
  return json.length > 4000 ? null : json;
}

export interface TrackLeadInput {
  clickId: string;
  eventName?: string;
  customer: CustomerInput;
  metadata?: Record<string, unknown> | null;
  source?: ConversionSource;
  /** API v1: quien creó la key; un link de una carpeta que no ve cuenta como inexistente. */
  viewer?: LinkViewer;
}

/** El link del click está en una carpeta que `viewer` no ve: se trata como inexistente. */
async function assertVisible(ws: string, linkId: string, viewer?: LinkViewer): Promise<void> {
  if (!viewer) return;
  const link = await linkFor(ws, linkId);
  if (!link || (await linkAccess(link, viewer)) === 'none') throw new ConversionError('click_not_found', 404);
}

/**
 * Registra un lead: el cliente (externalId) queda atribuido al click y a su
 * link. Repetir el mismo evento para el mismo cliente no duplica.
 */
export async function trackLead(ws: string, input: TrackLeadInput): Promise<{ conversion: ConversionDto; duplicate: boolean }> {
  const click = await clickOf(ws, input.clickId);
  if (!click) throw new ConversionError('click_not_found', 404);
  await assertVisible(ws, click.link_id, input.viewer);
  const externalId = clean(input.customer.externalId, 255);
  if (!externalId) throw new ConversionError('invalid_customer', 400);
  const eventName = clean(input.eventName, 100) ?? 'Sign up';
  const db = getDb();
  // El primer click que trajo al cliente se queda con la atribución.
  await db
    .prepare(
      `INSERT INTO link_customers (user_id, external_id, link_id, click_id, name, email, country)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id, external_id) DO UPDATE SET
         name = COALESCE(excluded.name, link_customers.name),
         email = COALESCE(excluded.email, link_customers.email)`,
    )
    .run(ws, externalId, click.link_id, click.click_id, clean(input.customer.name, 200), clean(input.customer.email, 254), click.country);
  const res = await db
    .prepare(
      `INSERT OR IGNORE INTO link_conversions (user_id, link_id, click_id, type, event_name, customer_external_id, source, country, device, metadata)
       VALUES (?, ?, ?, 'lead', ?, ?, ?, ?, ?, ?)`,
    )
    .run(ws, click.link_id, click.click_id, eventName, externalId, input.source ?? 'api', click.country, click.device, metadataJson(input.metadata));
  const row = (await db
    .prepare(
      `SELECT * FROM link_conversions WHERE user_id = ? AND type = 'lead' AND customer_external_id = ? AND event_name = ?`,
    )
    .get(ws, externalId, eventName)) as ConversionRow;
  const duplicate = res.changes === 0;
  const conversion = toDto(row);
  if (!duplicate) {
    const link = await linkFor(ws, click.link_id);
    await emitEventSoon(ws, 'link.lead', {
      link: linkPayload(link),
      lead: { id: conversion.id, eventName, clickId: click.click_id, customer: { externalId }, at: conversion.createdAt },
    });
  }
  return { conversion, duplicate };
}

export interface TrackSaleInput {
  /** Cliente ya registrado como lead (o con un click id para ventas directas). */
  customerExternalId?: string | null;
  clickId?: string | null;
  /** Unidades menores (centavos), > 0. */
  amount: number;
  currency?: string | null;
  eventName?: string;
  /** Id del pago o factura: la misma venta no se cuenta dos veces. */
  invoiceId?: string | null;
  source?: ConversionSource;
  metadata?: Record<string, unknown> | null;
  /** Para atribuir cobros recurrentes de Stripe al mismo cliente. */
  stripeCustomerId?: string | null;
  customer?: Omit<CustomerInput, 'externalId'>;
  viewer?: LinkViewer;
}

/** A qué click se atribuye una venta: el del cliente (lead) o el click id directo. */
async function resolveSaleClick(
  ws: string,
  input: Pick<TrackSaleInput, 'customerExternalId' | 'clickId'>,
): Promise<{ click: ClickHit; customer: string | null } | null> {
  const ext = clean(input.customerExternalId, 255);
  if (ext) {
    const c = (await getDb()
      .prepare('SELECT link_id, click_id, country FROM link_customers WHERE user_id = ? AND external_id = ?')
      .get(ws, ext)) as { link_id: string | null; click_id: string | null; country: string | null } | undefined;
    if (c?.link_id) {
      const hit = c.click_id ? await clickOf(ws, c.click_id) : null;
      return {
        click: hit ?? { click_id: c.click_id ?? '', link_id: c.link_id, country: c.country, device: null },
        customer: ext,
      };
    }
  }
  if (input.clickId) {
    const hit = await clickOf(ws, input.clickId);
    if (hit) return { click: hit, customer: ext };
  }
  return null;
}

/** Registra una venta atribuida. Con el mismo invoiceId no se duplica. */
export async function trackSale(ws: string, input: TrackSaleInput): Promise<{ conversion: ConversionDto; duplicate: boolean }> {
  if (!Number.isInteger(input.amount) || input.amount < 0 || input.amount > 1e12) throw new ConversionError('invalid_amount', 400);
  const resolved = await resolveSaleClick(ws, input);
  if (!resolved) throw new ConversionError(input.customerExternalId ? 'customer_not_found' : 'click_not_found', 404);
  const { click, customer } = resolved;
  await assertVisible(ws, click.link_id, input.viewer);
  const db = getDb();
  // Venta directa con click id y cliente nuevo: el cliente queda atribuido (para las próximas).
  if (customer) {
    await db
      .prepare(
        `INSERT INTO link_customers (user_id, external_id, link_id, click_id, name, email, country, stripe_customer_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (user_id, external_id) DO UPDATE SET
           stripe_customer_id = COALESCE(excluded.stripe_customer_id, link_customers.stripe_customer_id)`,
      )
      .run(
        ws,
        customer,
        click.link_id,
        click.click_id || null,
        clean(input.customer?.name, 200),
        clean(input.customer?.email, 254),
        click.country,
        clean(input.stripeCustomerId, 255),
      );
  }
  const currency = (clean(input.currency, 3) ?? 'USD').toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new ConversionError('invalid_currency', 400);
  const invoiceId = clean(input.invoiceId, 255);
  const eventName = clean(input.eventName, 100) ?? 'Purchase';
  const res = await db
    .prepare(
      `INSERT OR IGNORE INTO link_conversions (user_id, link_id, click_id, type, event_name, customer_external_id, amount, currency, invoice_id, source, country, device, metadata)
       VALUES (?, ?, ?, 'sale', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      ws,
      click.link_id,
      click.click_id || null,
      eventName,
      customer,
      input.amount,
      currency,
      invoiceId,
      input.source ?? 'api',
      click.country,
      click.device,
      metadataJson(input.metadata),
    );
  const duplicate = res.changes === 0;
  const row = (duplicate && invoiceId
    ? await db.prepare('SELECT * FROM link_conversions WHERE user_id = ? AND invoice_id = ?').get(ws, invoiceId)
    : await db.prepare('SELECT * FROM link_conversions WHERE id = ?').get(Number(res.lastInsertRowid))) as ConversionRow;
  const conversion = toDto(row);
  if (!duplicate) {
    const link = await linkFor(ws, click.link_id);
    await emitEventSoon(ws, 'link.sale', {
      link: linkPayload(link),
      sale: {
        id: conversion.id,
        eventName,
        amount: input.amount,
        currency,
        invoiceId,
        source: input.source ?? 'api',
        clickId: click.click_id || null,
        customer: customer ? { externalId: customer } : null,
        at: conversion.createdAt,
      },
    });
  }
  return { conversion, duplicate };
}

// ---------- Lecturas ----------

export interface ConversionTotals {
  leads: number;
  sales: number;
  /** Ingresos por moneda, en unidades menores. */
  revenue: Array<{ currency: string; amount: number }>;
}

/** Totales de conversiones de un link (todo su historial o desde `since`, 'YYYY-MM-DD HH:MM:SS'). */
export async function linkConversionTotals(linkId: string, since?: string | null): Promise<ConversionTotals> {
  const rows = (await getDb()
    .prepare(
      `SELECT type, currency, COUNT(*) AS n, SUM(amount) AS amount FROM link_conversions
       WHERE link_id = ?${since ? ' AND ts >= ?' : ''} GROUP BY type, currency`,
    )
    .all(...(since ? [linkId, since] : [linkId]))) as Array<{ type: ConversionType; currency: string | null; n: number; amount: number }>;
  return totalsOf(rows);
}

export function totalsOf(rows: Array<{ type: string; currency: string | null; n: number; amount: number }>): ConversionTotals {
  const revenue = new Map<string, number>();
  let leads = 0;
  let sales = 0;
  for (const r of rows) {
    if (r.type === 'lead') leads += Number(r.n);
    else {
      sales += Number(r.n);
      const cur = r.currency ?? 'USD';
      revenue.set(cur, (revenue.get(cur) ?? 0) + Number(r.amount ?? 0));
    }
  }
  return {
    leads,
    sales,
    revenue: [...revenue.entries()].map(([currency, amount]) => ({ currency, amount })).sort((a, b) => b.amount - a.amount),
  };
}

/** Últimas conversiones de un link (lo más nuevo primero). */
export async function listLinkConversions(linkId: string, limit = 50): Promise<ConversionDto[]> {
  const rows = (await getDb()
    .prepare('SELECT * FROM link_conversions WHERE link_id = ? ORDER BY id DESC LIMIT ?')
    .all(linkId, Math.min(Math.max(limit, 1), 500))) as ConversionRow[];
  return rows.map(toDto);
}

/** Formato de dinero para la UI y Slack (unidades menores → moneda). */
export function formatMoney(amountMinor: number, currency: string, locale = 'en'): string {
  const zeroDecimal = ['JPY', 'KRW', 'CLP', 'VND', 'PYG', 'UGX', 'XAF', 'XOF'].includes(currency.toUpperCase());
  const value = zeroDecimal ? amountMinor : amountMinor / 100;
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: currency.toUpperCase() }).format(value);
  } catch {
    return `${value} ${currency}`;
  }
}

// ---------- Stripe (conexión del workspace, lib/crm-apps.ts) ----------

const STRIPE_CLICK_PREFIX = 'zs_id_';

/**
 * Venta de Link desde un evento de Stripe ya verificado. Se atribuye por:
 * client_reference_id "zs_id_<clickId>" o metadata.zs_id (Checkout),
 * metadata.zs_customer_id (un lead registrado) o, en facturas recurrentes,
 * el cliente de Stripe de una venta anterior. Devuelve si registró algo.
 */
export async function attributeStripeEvent(
  ws: string,
  event: { id?: string; type?: string; data?: { object?: Record<string, unknown> } },
): Promise<'sale' | 'duplicate' | 'ignored'> {
  const obj = event.data?.object ?? {};
  const meta = (obj.metadata ?? {}) as Record<string, string>;
  if (meta.source === 'zerosoft_crm_quote') return 'ignored';
  const stripeCustomer = typeof obj.customer === 'string' ? obj.customer : null;
  const currency = String(obj.currency ?? 'usd').toUpperCase();
  let amount: number;
  let invoiceId: string;
  let clickId: string | null = null;
  let customerExternalId: string | null = meta.zs_customer_id ?? null;

  if (event.type === 'checkout.session.completed') {
    if (obj.payment_status !== 'paid' && obj.payment_status !== 'no_payment_required') return 'ignored';
    // Un Checkout de 0 (prueba gratis, cupón del 100 %) cuenta como venta de 0, igual que por la API.
    amount = Number(obj.amount_total ?? 0);
    // La primera factura de una suscripción llega también como invoice.paid: misma clave.
    invoiceId = `stripe:${String(obj.invoice ?? obj.payment_intent ?? obj.id ?? event.id)}`;
    const ref = typeof obj.client_reference_id === 'string' ? obj.client_reference_id : '';
    clickId = ref.startsWith(STRIPE_CLICK_PREFIX) ? ref.slice(STRIPE_CLICK_PREFIX.length) : (meta.zs_id ?? null);
  } else if (event.type === 'invoice.paid') {
    amount = Number(obj.amount_paid ?? 0);
    invoiceId = `stripe:${String(obj.id ?? event.id)}`;
    if (!customerExternalId && stripeCustomer) {
      const c = (await getDb()
        .prepare('SELECT external_id FROM link_customers WHERE user_id = ? AND stripe_customer_id = ?')
        .get(ws, stripeCustomer)) as { external_id: string } | undefined;
      customerExternalId = c?.external_id ?? null;
    }
  } else {
    return 'ignored';
  }
  if (!clickId && !customerExternalId) return 'ignored';
  if (!Number.isFinite(amount) || amount < 0) return 'ignored';
  // Sin id de cliente propio, el cliente de Stripe hace de id (para las facturas siguientes).
  if (!customerExternalId && stripeCustomer) customerExternalId = `stripe:${stripeCustomer}`;
  try {
    const res = await trackSale(ws, {
      clickId,
      customerExternalId,
      amount: Math.round(amount),
      currency,
      invoiceId,
      source: 'stripe',
      eventName: event.type === 'invoice.paid' ? 'Invoice paid' : 'Checkout completed',
      stripeCustomerId: stripeCustomer,
    });
    return res.duplicate ? 'duplicate' : 'sale';
  } catch (err) {
    if (err instanceof ConversionError) return 'ignored';
    throw err;
  }
}
