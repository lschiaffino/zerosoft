/**
 * Shop: páginas de contenido (Sobre nosotros, Cambios y devoluciones, Términos)
 * y artículos del blog de la tienda; historial de pedidos del cliente por link
 * al email; y feed de productos para Google y Meta. Server-only.
 */
import { createHash, randomBytes } from 'crypto';
import { z } from 'zod';
import { getDb } from './db';
import { escapeHtml, namedSender, renderBrandedHtml, sendEmail } from './email';
import { descriptionHtml, ensureStore, getStore, newId, nowDb, revalidateStore, sanitizeDescription, type StoreRow } from './shop';
import { claimShopEmail, releaseEmailClaim } from './shop-email-guard';
import { isZeroDecimalCurrency } from './shop-money';
import { DEFAULT_BRAND, HANDLE_RE, ShopError, normalizeBrand, parseJson, plainText, slugify, type ShopActor } from './shop-schema';

export interface ShopPageDto {
  id: string;
  kind: 'page' | 'article';
  handle: string;
  title: string;
  body: string;
  published: boolean;
  seoTitle: string;
  seoDescription: string;
  createdAt: string;
  updatedAt: string;
}

function dto(r: Record<string, unknown>): ShopPageDto {
  return {
    id: String(r.id),
    kind: r.kind === 'article' ? 'article' : 'page',
    handle: String(r.handle),
    title: String(r.title),
    body: String(r.body ?? ''),
    published: Number(r.published) === 1,
    seoTitle: String(r.seo_title ?? ''),
    seoDescription: String(r.seo_description ?? ''),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

const pageInput = z.object({
  kind: z.enum(['page', 'article']).default('page'),
  title: z.string().trim().min(1).max(200),
  handle: z.string().trim().max(64).optional(),
  body: z.string().max(100_000).default(''),
  published: z.boolean().default(true),
  seoTitle: z.string().trim().max(120).default(''),
  seoDescription: z.string().trim().max(320).default(''),
});

export async function listPages(ws: string, opts: { q?: string } = {}): Promise<ShopPageDto[]> {
  const q = opts.q?.trim();
  const like = q ? `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%` : null;
  const rows = (await getDb()
    .prepare(`SELECT * FROM shop_pages WHERE workspace_id = ? ${like ? "AND title LIKE ? ESCAPE '\\'" : ''} ORDER BY updated_at DESC LIMIT 500`)
    .all(...(like ? [actorWs(ws), like] : [actorWs(ws)]))) as Array<Record<string, unknown>>;
  return rows.map(dto);
}

function actorWs(ws: string): string {
  return ws;
}

export async function getPage(ws: string, id: string): Promise<ShopPageDto | null> {
  const r = (await getDb().prepare('SELECT * FROM shop_pages WHERE id = ? AND workspace_id = ?').get(id, ws)) as Record<string, unknown> | undefined;
  return r ? dto(r) : null;
}

async function freeHandle(ws: string, kind: string, base: string, exceptId?: string): Promise<string> {
  const db = getDb();
  for (let i = 0; i < 50; i++) {
    const candidate = i ? `${base.slice(0, 58)}-${i + 1}` : base;
    const row = (await db.prepare('SELECT id FROM shop_pages WHERE workspace_id = ? AND kind = ? AND handle = ?').get(ws, kind, candidate)) as { id: string } | undefined;
    if (!row || row.id === exceptId) return candidate;
  }
  throw new ShopError('handle_taken', 409);
}

export async function createPage(actor: ShopActor, raw: unknown): Promise<ShopPageDto> {
  const parsed = pageInput.safeParse(raw);
  if (!parsed.success) throw new ShopError('invalid_input');
  const input = parsed.data;
  const store = await ensureStore(actor.ws);
  const slug = slugify(input.handle || input.title);
  if (!HANDLE_RE.test(slug)) throw new ShopError('invalid_handle');
  const id = newId('page');
  const ts = nowDb();
  await getDb()
    .prepare('INSERT INTO shop_pages (id, workspace_id, kind, handle, title, body, published, seo_title, seo_description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, actor.ws, input.kind, await freeHandle(actor.ws, input.kind, slug), input.title, sanitizeDescription(input.body), input.published ? 1 : 0, input.seoTitle, input.seoDescription, ts, ts);
  await revalidateStore(store.handle);
  return (await getPage(actor.ws, id))!;
}

export async function updatePage(actor: ShopActor, id: string, raw: unknown): Promise<ShopPageDto> {
  const cur = await getPage(actor.ws, id);
  if (!cur) throw new ShopError('not_found', 404);
  const parsed = pageInput.safeParse({ ...cur, ...(raw && typeof raw === 'object' ? raw : {}), kind: cur.kind });
  if (!parsed.success) throw new ShopError('invalid_input');
  const input = parsed.data;
  const slug = slugify(input.handle || input.title);
  if (!HANDLE_RE.test(slug)) throw new ShopError('invalid_handle');
  await getDb()
    .prepare('UPDATE shop_pages SET title = ?, handle = ?, body = ?, published = ?, seo_title = ?, seo_description = ?, updated_at = ? WHERE id = ? AND workspace_id = ?')
    .run(input.title, await freeHandle(actor.ws, cur.kind, slug, id), sanitizeDescription(input.body), input.published ? 1 : 0, input.seoTitle, input.seoDescription, nowDb(), id, actor.ws);
  const store = await ensureStore(actor.ws);
  await revalidateStore(store.handle);
  return (await getPage(actor.ws, id))!;
}

export async function deletePage(actor: ShopActor, id: string): Promise<boolean> {
  const res = await getDb().prepare('DELETE FROM shop_pages WHERE id = ? AND workspace_id = ?').run(id, actor.ws);
  const store = await getStore(actor.ws);
  if (store) await revalidateStore(store.handle);
  return res.changes > 0;
}

// ---------- Lo público ----------

export interface PublicPage {
  handle: string;
  title: string;
  html: string;
  excerpt: string;
  seoTitle: string;
  seoDescription: string;
  publishedAt: string;
}

function publicPage(r: Record<string, unknown>): PublicPage {
  const body = String(r.body ?? '');
  return {
    handle: String(r.handle),
    title: String(r.title),
    html: descriptionHtml(body),
    excerpt: plainText(body, 180),
    seoTitle: String(r.seo_title ?? ''),
    seoDescription: String(r.seo_description ?? ''),
    publishedAt: String(r.created_at),
  };
}

export async function storefrontPage(ws: string, kind: 'page' | 'article', handle: string): Promise<PublicPage | null> {
  const r = (await getDb().prepare('SELECT * FROM shop_pages WHERE workspace_id = ? AND kind = ? AND handle = ? AND published = 1').get(ws, kind, handle)) as Record<string, unknown> | undefined;
  return r ? publicPage(r) : null;
}

export async function storefrontPages(ws: string, kind: 'page' | 'article', limit = 50): Promise<PublicPage[]> {
  const rows = (await getDb().prepare('SELECT * FROM shop_pages WHERE workspace_id = ? AND kind = ? AND published = 1 ORDER BY created_at DESC LIMIT ?').all(ws, kind, limit)) as Array<Record<string, unknown>>;
  return rows.map(publicPage);
}

export async function sitemapPages(ws: string): Promise<Array<{ kind: string; handle: string; updated_at: string }>> {
  return (await getDb().prepare('SELECT kind, handle, updated_at FROM shop_pages WHERE workspace_id = ? AND published = 1 LIMIT 1000').all(ws)) as Array<{ kind: string; handle: string; updated_at: string }>;
}

// ---------- Mis pedidos (link por email) ----------

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

const ACCOUNT_COPY = {
  en: { subject: 'Your orders', heading: 'See your orders', lead: 'Use this link to see your orders. It works for 30 minutes.', cta: 'Open my orders' },
  es: { subject: 'Tus pedidos', heading: 'Ver tus pedidos', lead: 'Usá este link para ver tus pedidos. Funciona durante 30 minutos.', cta: 'Abrir mis pedidos' },
  pt: { subject: 'Seus pedidos', heading: 'Ver seus pedidos', lead: 'Use este link para ver seus pedidos. Funciona por 30 minutos.', cta: 'Abrir meus pedidos' },
} as const;

/**
 * Manda el link si esa dirección compró en esta tienda. Quien llama siempre
 * responde lo mismo: no se puede averiguar quién es cliente.
 */
export async function sendAccountLink(store: StoreRow, rawEmail: string, origin: string, now: Date = new Date()): Promise<void> {
  const email = rawEmail.trim().toLowerCase();
  const db = getDb();
  const known = await db.prepare("SELECT 1 AS x FROM shop_orders WHERE workspace_id = ? AND email = ? AND status != 'draft' LIMIT 1").get(store.workspace_id, email);
  if (!known) return;
  // Una referencia por cuarto de hora: como mucho 4 por hora a cada dirección, además de los topes.
  const bucket = Math.floor(now.getTime() / (15 * 60_000));
  const claim = await claimShopEmail(store.workspace_id, email, 'account_link', `${email}:${bucket}`, now);
  if (!claim.ok) return;
  await db.prepare('DELETE FROM shop_account_links WHERE expires_at < ?').run(nowDb(now));
  const token = randomBytes(24).toString('base64url');
  await db.prepare('INSERT INTO shop_account_links (token_hash, workspace_id, email, expires_at) VALUES (?, ?, ?, ?)').run(hashToken(token), store.workspace_id, email, nowDb(new Date(now.getTime() + 30 * 60_000)));
  const c = ACCOUNT_COPY[(store.locale in ACCOUNT_COPY ? store.locale : 'en') as keyof typeof ACCOUNT_COPY];
  const url = `${origin.replace(/\/$/, '')}/store/${store.handle}/account/${token}`;
  const brand = normalizeBrand(parseJson(store.brand, DEFAULT_BRAND));
  const res = await sendEmail({
    to: email,
    subject: c.subject,
    text: `${c.lead}\n${url}`,
    html: renderBrandedHtml({ heading: c.heading, paragraphs: [escapeHtml(c.lead), `<a href="${escapeHtml(url)}">${escapeHtml(c.cta)}</a>`], brandColor: brand.accent, eyebrow: store.name }),
    from: namedSender(store.name),
    idempotencyKey: `shop:account:${email}:${bucket}:${store.workspace_id}`,
  });
  if (!res.ok) await releaseEmailClaim(claim.id);
}

export interface AccountOrder {
  number: number;
  status: string;
  totalCents: number;
  currency: string;
  createdAt: string;
  statusToken: string;
}

export async function accountOrders(store: StoreRow, token: string, now: Date = new Date()): Promise<{ email: string; orders: AccountOrder[] } | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const db = getDb();
  const link = (await db.prepare('SELECT email FROM shop_account_links WHERE token_hash = ? AND workspace_id = ? AND expires_at >= ?').get(hashToken(token), store.workspace_id, nowDb(now))) as { email: string } | undefined;
  if (!link) return null;
  const rows = (await db
    .prepare("SELECT number, status, total_cents, currency, created_at, status_token FROM shop_orders WHERE workspace_id = ? AND email = ? AND status != 'draft' ORDER BY created_at DESC LIMIT 100")
    .all(store.workspace_id, link.email)) as Array<Record<string, unknown>>;
  return {
    email: link.email,
    orders: rows.map((r) => ({ number: Number(r.number), status: String(r.status), totalCents: Number(r.total_cents), currency: String(r.currency), createdAt: String(r.created_at), statusToken: String(r.status_token) })),
  };
}

// ---------- Feed de productos ----------

function xml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Feed RSS con el espacio g: que leen Google Merchant Center y el catálogo de Meta. Una entrada por variante activa. */
export async function productFeed(store: StoreRow, base: string): Promise<string> {
  const rows = (await getDb()
    .prepare(
      `SELECT p.id AS pid, p.handle, p.title, p.description, p.vendor, p.product_type, p.images, v.id, v.title AS vtitle, v.sku, v.barcode, v.price_cents, v.compare_at_cents, v.track_inventory, v.continue_selling, v.image_url,
         (SELECT COALESCE(MAX(MAX(i.available - i.reserved, 0)), 0) FROM shop_inventory i WHERE i.variant_id = v.id) AS free
       FROM shop_variants v JOIN shop_products p ON p.id = v.product_id
       WHERE v.workspace_id = ? AND p.status = 'active' ORDER BY p.created_at DESC, v.position ASC LIMIT 5000`,
    )
    .all(store.workspace_id)) as Array<Record<string, unknown>>;
  const root = `${base.replace(/\/$/, '')}/store/${store.handle}`;
  const abs = (u: string) => (u.startsWith('/') ? `${base.replace(/\/$/, '')}${u}` : u);
  const amount = (c: number) => `${isZeroDecimalCurrency(store.currency) ? Math.round(c / 100) : (c / 100).toFixed(2)} ${store.currency}`;
  const items = rows.map((r) => {
    const images = parseJson<string[]>(r.images, []);
    const image = (r.image_url as string | null) || images[0] || '';
    const track = Number(r.track_inventory) === 1;
    const inStock = !track || Number(r.free) > 0 || Number(r.continue_selling ?? 0) === 1;
    const variant = String(r.vtitle ?? '');
    const compare = r.compare_at_cents == null ? null : Number(r.compare_at_cents);
    const price = Number(r.price_cents);
    return [
      '<item>',
      `<g:id>${xml(String(r.sku || r.id))}</g:id>`,
      `<g:item_group_id>${xml(String(r.pid))}</g:item_group_id>`,
      `<title>${xml(`${String(r.title)}${variant && variant !== 'Default' ? ` ${variant}` : ''}`)}</title>`,
      `<description>${xml(plainText(String(r.description ?? ''), 4900) || String(r.title))}</description>`,
      `<link>${xml(`${root}/products/${String(r.handle)}`)}</link>`,
      image ? `<g:image_link>${xml(abs(image))}</g:image_link>` : '',
      `<g:availability>${inStock ? 'in_stock' : 'out_of_stock'}</g:availability>`,
      compare && compare > price ? `<g:price>${xml(amount(compare))}</g:price><g:sale_price>${xml(amount(price))}</g:sale_price>` : `<g:price>${xml(amount(price))}</g:price>`,
      r.vendor ? `<g:brand>${xml(String(r.vendor))}</g:brand>` : '',
      r.barcode ? `<g:gtin>${xml(String(r.barcode))}</g:gtin>` : '<g:identifier_exists>no</g:identifier_exists>',
      r.product_type ? `<g:product_type>${xml(String(r.product_type))}</g:product_type>` : '',
      '<g:condition>new</g:condition>',
      '</item>',
    ]
      .filter(Boolean)
      .join('');
  });
  return ['<?xml version="1.0" encoding="UTF-8"?>', '<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0"><channel>', `<title>${xml(store.name)}</title>`, `<link>${xml(root)}</link>`, `<description>${xml(store.name)}</description>`, ...items, '</channel></rss>'].join('\n');
}
