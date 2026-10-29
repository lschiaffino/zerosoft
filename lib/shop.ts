/**
 * Shop: tienda, catálogo, inventario, colecciones, envíos, impuestos,
 * descuentos y clientes. Server-only. Los pedidos están en lib/shop-orders.ts
 * y los cobros en lib/shop-payments.ts.
 *
 * Inventario: `available` es lo que hay; `reserved` lo que ya está en un
 * pedido sin pagar. Reservar, descontar y liberar son compare-and-set sobre la
 * fila (nunca se lee y se escribe aparte), así dos compras a la vez no venden
 * la misma unidad.
 */
import { randomBytes } from 'crypto';
import { getDb } from './db';
import { sanitizeDocsHtml } from './docs-sanitize';
import { open as openSecret } from './secret-box';
import {
  DEFAULT_BRAND,
  DEFAULT_SETTINGS,
  HANDLE_RE,
  RESERVED_STORE_HANDLES,
  STORE_HANDLE_RE,
  ShopError,
  collectionInputSchema,
  descriptionParagraphs,
  discountInputSchema,
  isCurrency,
  normalizeBrand,
  normalizeOptions,
  normalizeSettings,
  optionCombos,
  parseJson,
  plainText,
  productInputSchema,
  shippingRateInputSchema,
  slugify,
  taxRateInputSchema,
  variantTitle,
  type CollectionInput,
  type CollectionRules,
  type ProductInput,
  type ProductOption,
  type ProductPatch,
  type ShopActor,
  type StoreBrand,
  type StoreSettings,
  type DiscountInput,
} from './shop-schema';
import type { DiscountRule, ShippingRate, TaxRate } from './shop-money';

export { ShopError };

export function nowDb(d: Date = new Date()): string {
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(9).toString('base64url')}`;
}

// ---------- Tienda ----------

export interface StoreRow {
  workspace_id: string;
  handle: string;
  name: string;
  published: number;
  currency: string;
  locale: string;
  theme: string;
  brand: string;
  settings: string;
  payments: string;
  contact_email: string;
  tax_included: number;
  low_stock: number;
  next_number: number;
  webhook_token: string;
  created_at: string;
  updated_at: string;
}

export interface StoredPayments {
  stripe?: { secret: string; webhookSecret: string; last4: string; connectedAt: string };
  mercadopago?: { token: string; webhookSecret: string; last4: string; connectedAt: string };
  manual?: { enabled: boolean; label: string; instructions: string };
}

export interface StoreDto {
  handle: string;
  name: string;
  published: boolean;
  currency: string;
  locale: string;
  theme: string;
  brand: StoreBrand;
  settings: StoreSettings;
  contactEmail: string;
  taxIncluded: boolean;
  lowStock: number;
  createdAt: string;
}

export function storeDto(s: StoreRow): StoreDto {
  return {
    handle: s.handle,
    name: s.name,
    published: s.published === 1,
    currency: s.currency,
    locale: s.locale,
    theme: s.theme,
    brand: normalizeBrand(parseJson(s.brand, DEFAULT_BRAND)),
    settings: normalizeSettings(parseJson(s.settings, DEFAULT_SETTINGS)),
    contactEmail: s.contact_email,
    taxIncluded: s.tax_included === 1,
    lowStock: s.low_stock,
    createdAt: s.created_at,
  };
}

export function storedPayments(s: Pick<StoreRow, 'payments'>): StoredPayments {
  return parseJson<StoredPayments>(s.payments, {});
}

/** Métodos de pago que el checkout ofrece hoy (con credenciales o activados). */
export function enabledMethods(s: Pick<StoreRow, 'payments'>): Array<'stripe' | 'mercadopago' | 'manual'> {
  const p = storedPayments(s);
  const out: Array<'stripe' | 'mercadopago' | 'manual'> = [];
  if (p.stripe?.secret && openSecret(p.stripe.secret)) out.push('stripe');
  if (p.mercadopago?.token && openSecret(p.mercadopago.token)) out.push('mercadopago');
  if (p.manual?.enabled) out.push('manual');
  return out;
}

export async function getStore(ws: string): Promise<StoreRow | null> {
  return ((await getDb().prepare('SELECT * FROM shop_stores WHERE workspace_id = ?').get(ws)) as StoreRow | undefined) ?? null;
}

export async function getStoreByHandle(handle: string): Promise<StoreRow | null> {
  if (!STORE_HANDLE_RE.test(handle)) return null;
  return ((await getDb().prepare('SELECT * FROM shop_stores WHERE handle = ?').get(handle)) as StoreRow | undefined) ?? null;
}

export async function getStoreByWebhookToken(token: string): Promise<StoreRow | null> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
  return ((await getDb().prepare('SELECT * FROM shop_stores WHERE webhook_token = ?').get(token)) as StoreRow | undefined) ?? null;
}

async function freeStoreHandle(base: string): Promise<string> {
  let root = slugify(base, 36);
  if (root.length < 3) root = `${root}-shop`;
  if (RESERVED_STORE_HANDLES.has(root)) root = `${root}-store`;
  for (let i = 1; i < 500; i++) {
    const candidate = i === 1 ? root : `${root}-${i}`;
    const taken = await getDb().prepare('SELECT 1 AS x FROM shop_stores WHERE handle = ?').get(candidate);
    if (!taken) return candidate;
  }
  return `${root}-${randomBytes(3).toString('hex')}`;
}

/** La tienda del workspace (la crea con una ubicación por defecto la primera vez). */
export async function ensureStore(ws: string): Promise<StoreRow> {
  const existing = await getStore(ws);
  if (existing) return existing;
  const db = getDb();
  const owner = (await db.prepare('SELECT name, email FROM users WHERE id = ?').get(ws)) as { name: string | null; email: string } | undefined;
  const team = (await db.prepare('SELECT name FROM teams WHERE owner_id = ? ORDER BY created_at ASC LIMIT 1').get(ws).catch(() => undefined)) as
    | { name: string | null }
    | undefined;
  const name = (team?.name || owner?.name || owner?.email?.split('@')[0] || 'My store').slice(0, 80);
  const handle = await freeStoreHandle(name);
  const ts = nowDb();
  await db
    .prepare(
      `INSERT OR IGNORE INTO shop_stores (workspace_id, handle, name, contact_email, brand, settings, payments, webhook_token, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, '{}', ?, ?, ?)`,
    )
    .run(ws, handle, name, owner?.email ?? '', JSON.stringify(DEFAULT_BRAND), JSON.stringify(DEFAULT_SETTINGS), randomBytes(18).toString('base64url'), ts, ts);
  const hasLocation = await db.prepare('SELECT 1 AS x FROM shop_locations WHERE workspace_id = ?').get(ws);
  if (!hasLocation) {
    await db.prepare('INSERT INTO shop_locations (id, workspace_id, name, is_default, created_at) VALUES (?, ?, ?, 1, ?)').run(newId('loc'), ws, 'Main', ts);
  }
  return (await getStore(ws))!;
}

export interface StorePatch {
  name?: string;
  handle?: string;
  published?: boolean;
  currency?: string;
  locale?: string;
  theme?: string;
  brand?: Partial<StoreBrand>;
  settings?: Partial<StoreSettings>;
  contactEmail?: string;
  taxIncluded?: boolean;
  lowStock?: number;
}

export async function updateStore(actor: ShopActor, patch: StorePatch): Promise<StoreRow> {
  const store = await ensureStore(actor.ws);
  const sets: string[] = [];
  const args: Array<string | number> = [];
  const set = (col: string, v: string | number) => {
    sets.push(`${col} = ?`);
    args.push(v);
  };
  if (patch.name !== undefined) {
    const name = patch.name.trim().slice(0, 80);
    if (!name) throw new ShopError('invalid_name');
    set('name', name);
  }
  if (patch.handle !== undefined && patch.handle !== store.handle) {
    const h = patch.handle.trim().toLowerCase();
    if (!STORE_HANDLE_RE.test(h) || RESERVED_STORE_HANDLES.has(h)) throw new ShopError('invalid_handle');
    const taken = await getDb().prepare('SELECT 1 AS x FROM shop_stores WHERE handle = ? AND workspace_id != ?').get(h, actor.ws);
    if (taken) throw new ShopError('handle_taken', 409);
    set('handle', h);
  }
  if (patch.published !== undefined) set('published', patch.published ? 1 : 0);
  if (patch.currency !== undefined) {
    if (!isCurrency(patch.currency)) throw new ShopError('invalid_currency');
    set('currency', patch.currency);
  }
  if (patch.locale !== undefined) {
    if (!['en', 'es', 'pt'].includes(patch.locale)) throw new ShopError('invalid_locale');
    set('locale', patch.locale);
  }
  if (patch.theme !== undefined) {
    if (!['classic', 'bold', 'minimal'].includes(patch.theme)) throw new ShopError('invalid_theme');
    set('theme', patch.theme);
  }
  if (patch.brand !== undefined) {
    const next = normalizeBrand({ ...normalizeBrand(parseJson(store.brand, DEFAULT_BRAND)), ...patch.brand });
    if (next.logoUrl && !isOwnShopImage(next.logoUrl)) throw new ShopError('invalid_image');
    set('brand', JSON.stringify(next));
  }
  if (patch.settings !== undefined) set('settings', JSON.stringify(normalizeSettings({ ...normalizeSettings(parseJson(store.settings, DEFAULT_SETTINGS)), ...patch.settings })));
  if (patch.contactEmail !== undefined) {
    const email = patch.contactEmail.trim().toLowerCase();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ShopError('invalid_email');
    set('contact_email', email);
  }
  if (patch.taxIncluded !== undefined) set('tax_included', patch.taxIncluded ? 1 : 0);
  if (patch.lowStock !== undefined) set('low_stock', Math.max(0, Math.min(100_000, Math.round(patch.lowStock))));
  if (!sets.length) return store;
  set('updated_at', nowDb());
  await getDb()
    .prepare(`UPDATE shop_stores SET ${sets.join(', ')} WHERE workspace_id = ?`)
    .run(...args, actor.ws);
  const next = (await getStore(actor.ws))!;
  await revalidateStore(store.handle);
  if (next.handle !== store.handle) await revalidateStore(next.handle);
  return next;
}

/** Vuelve a generar las páginas de la tienda (ISR) después de un cambio. Nunca lanza. */
export async function revalidateStore(handle: string): Promise<void> {
  try {
    const { revalidatePath } = await import('next/cache');
    revalidatePath(`/store/${handle}`, 'layout');
  } catch {
    /* fuera de un request (tests, scripts) */
  }
}

export async function revalidateWs(ws: string): Promise<void> {
  const s = await getStore(ws);
  if (s) await revalidateStore(s.handle);
}

// ---------- Imágenes ----------

/** URL de una imagen subida por Shop (disco local o Blob): lo único que se acepta en el catálogo. */
export function isOwnShopImage(url: string): boolean {
  if (/^\/uploads\/shop\/[A-Za-z0-9_-][A-Za-z0-9._-]{0,199}$/.test(url) && !url.includes('..')) return true;
  return /^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\/shop\/[A-Za-z0-9._-]+$/i.test(url);
}

/** Tipo real de una imagen por sus primeros bytes (nunca el que dice el navegador). Sin SVG. */
export function sniffRaster(bytes: Uint8Array): { mime: string; ext: string } | null {
  const b = (i: number) => bytes[i] ?? -1;
  if (b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47) return { mime: 'image/png', ext: 'png' };
  if (b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (b(0) === 0x47 && b(1) === 0x49 && b(2) === 0x46 && b(3) === 0x38) return { mime: 'image/gif', ext: 'gif' };
  if (b(0) === 0x52 && b(1) === 0x49 && b(2) === 0x46 && b(3) === 0x46 && b(8) === 0x57 && b(9) === 0x45 && b(10) === 0x42 && b(11) === 0x50) {
    return { mime: 'image/webp', ext: 'webp' };
  }
  if (b(4) === 0x66 && b(5) === 0x74 && b(6) === 0x79 && b(7) === 0x70 && b(8) === 0x61 && b(9) === 0x76 && b(10) === 0x69 && b(11) === 0x66) {
    return { mime: 'image/avif', ext: 'avif' };
  }
  return null;
}

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/** Guarda una imagen del catálogo (producto o logo) después de mirar sus bytes. */
export async function saveShopImage(buffer: Buffer): Promise<string> {
  if (buffer.byteLength === 0) throw new ShopError('empty_file');
  if (buffer.byteLength > MAX_IMAGE_BYTES) throw new ShopError('file_too_large', 413);
  const kind = sniffRaster(new Uint8Array(buffer.subarray(0, 32)));
  if (!kind) throw new ShopError('image_type', 415);
  const { saveUpload } = await import('./uploads');
  return saveUpload('shop', `image.${kind.ext}`, kind.mime, buffer);
}

// ---------- Descripción ----------

/**
 * Descripción rica: párrafos separados por una línea en blanco, cada uno con
 * el subset en línea del sanitizador de Docs (negrita, itálica, links). El
 * HTML de bloque que llega (Shopify CSV, pegado) se baja a párrafos primero.
 */
export function sanitizeDescription(raw: string): string {
  const text = String(raw ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/<\s*(script|style|iframe|object|embed|template)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '\n• ')
    .replace(/<\s*\/\s*(p|div|h[1-6]|ul|ol|li|blockquote|section|article|table|tr)\s*>/gi, '\n\n')
    .replace(/<\s*(p|div|h[1-6]|ul|ol|blockquote|section|article|table|tbody|thead|tr|td|th)(\s[^>]*)?>/gi, '');
  return descriptionParagraphs(text)
    .map((p) =>
      p
        .split('\n')
        .map((line) => sanitizeDocsHtml(line.trim()))
        .filter((line) => line.length > 0)
        .join('\n'),
    )
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 20_000);
}

/** HTML listo para la tienda: cada párrafo vuelve a pasar por el sanitizador. */
export function descriptionHtml(desc: string): string {
  return descriptionParagraphs(desc)
    .map((p) => `<p>${p.split('\n').map((l) => sanitizeDocsHtml(l)).join('<br>')}</p>`)
    .join('');
}

// ---------- Productos ----------

export interface ProductRow {
  id: string;
  workspace_id: string;
  handle: string;
  title: string;
  description: string;
  vendor: string;
  product_type: string;
  tags: string;
  status: string;
  options: string;
  images: string;
  seo_title: string;
  seo_description: string;
  requires_shipping: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface VariantRow {
  id: string;
  product_id: string;
  workspace_id: string;
  title: string;
  options: string;
  sku: string;
  barcode: string;
  price_cents: number;
  compare_at_cents: number | null;
  weight_grams: number;
  track_inventory: number;
  position: number;
  image_url: string | null;
}

export interface VariantDto {
  id: string;
  title: string;
  options: string[];
  sku: string;
  barcode: string;
  priceCents: number;
  compareAtCents: number | null;
  weightGrams: number;
  trackInventory: boolean;
  imageUrl: string | null;
  /** Disponible para vender (available − reserved, todas las ubicaciones). */
  stock: number;
  inventory: Array<{ locationId: string; available: number; reserved: number }>;
}

export interface ProductDto {
  id: string;
  handle: string;
  title: string;
  description: string;
  vendor: string;
  productType: string;
  tags: string[];
  status: string;
  options: ProductOption[];
  images: string[];
  seoTitle: string;
  seoDescription: string;
  requiresShipping: boolean;
  variants: VariantDto[];
  collectionIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ProductListItem {
  id: string;
  handle: string;
  title: string;
  status: string;
  vendor: string;
  productType: string;
  image: string | null;
  variants: number;
  stock: number;
  tracked: boolean;
  minPriceCents: number;
  maxPriceCents: number;
  updatedAt: string;
}

function variantDto(v: VariantRow, inv: Array<{ location_id: string; available: number; reserved: number }>): VariantDto {
  return {
    id: v.id,
    title: v.title,
    options: parseJson<string[]>(v.options, []),
    sku: v.sku,
    barcode: v.barcode,
    priceCents: v.price_cents,
    compareAtCents: v.compare_at_cents,
    weightGrams: v.weight_grams,
    trackInventory: v.track_inventory === 1,
    imageUrl: v.image_url,
    stock: inv.reduce((s, r) => s + Math.max(0, r.available - r.reserved), 0),
    inventory: inv.map((r) => ({ locationId: r.location_id, available: r.available, reserved: r.reserved })),
  };
}

export async function getProductRow(ws: string, id: string): Promise<ProductRow | null> {
  return ((await getDb().prepare('SELECT * FROM shop_products WHERE id = ? AND workspace_id = ?').get(id, ws)) as ProductRow | undefined) ?? null;
}

export async function getProduct(ws: string, id: string): Promise<ProductDto | null> {
  const p = await getProductRow(ws, id);
  return p ? (await productDtos(ws, [p]))[0] : null;
}

/** DTO completo de varios productos (variantes, inventario y colecciones en 3 lecturas). */
export async function productDtos(ws: string, rows: ProductRow[]): Promise<ProductDto[]> {
  if (!rows.length) return [];
  const db = getDb();
  const ids = rows.map((r) => r.id);
  const marks = ids.map(() => '?').join(',');
  const [variants, inventory, links] = await Promise.all([
    db.prepare(`SELECT * FROM shop_variants WHERE product_id IN (${marks}) ORDER BY position ASC`).all(...ids) as Promise<VariantRow[]>,
    db
      .prepare(
        `SELECT i.variant_id, i.location_id, i.available, i.reserved FROM shop_inventory i JOIN shop_variants v ON v.id = i.variant_id
         WHERE v.product_id IN (${marks})`,
      )
      .all(...ids) as Promise<Array<{ variant_id: string; location_id: string; available: number; reserved: number }>>,
    db.prepare(`SELECT collection_id, product_id FROM shop_collection_products WHERE product_id IN (${marks})`).all(...ids) as Promise<
      Array<{ collection_id: string; product_id: string }>
    >,
  ]);
  void ws;
  return rows.map((p) => ({
    id: p.id,
    handle: p.handle,
    title: p.title,
    description: p.description,
    vendor: p.vendor,
    productType: p.product_type,
    tags: parseJson<string[]>(p.tags, []),
    status: p.status,
    options: parseJson<ProductOption[]>(p.options, []),
    images: parseJson<string[]>(p.images, []),
    seoTitle: p.seo_title,
    seoDescription: p.seo_description,
    requiresShipping: p.requires_shipping === 1,
    variants: variants
      .filter((v) => v.product_id === p.id)
      .map((v) => variantDto(v, inventory.filter((i) => i.variant_id === v.id))),
    collectionIds: links.filter((l) => l.product_id === p.id).map((l) => l.collection_id),
    createdAt: p.created_at,
    updatedAt: p.updated_at,
  }));
}

const likeEsc = (q: string) => `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;

export async function listProducts(
  ws: string,
  opts: { q?: string; status?: string; collectionId?: string; limit?: number; offset?: number } = {},
): Promise<{ items: ProductListItem[]; total: number }> {
  const where = ['p.workspace_id = ?'];
  const args: Array<string | number> = [ws];
  if (opts.q?.trim()) {
    where.push("(p.title LIKE ? ESCAPE '\\' OR p.vendor LIKE ? ESCAPE '\\' OR p.tags LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM shop_variants sv WHERE sv.product_id = p.id AND (sv.sku LIKE ? ESCAPE '\\' OR sv.barcode LIKE ? ESCAPE '\\')))");
    const l = likeEsc(opts.q.trim());
    args.push(l, l, l, l, l);
  }
  if (opts.status && ['draft', 'active', 'archived'].includes(opts.status)) {
    where.push('p.status = ?');
    args.push(opts.status);
  }
  if (opts.collectionId) {
    where.push('EXISTS (SELECT 1 FROM shop_collection_products cp WHERE cp.product_id = p.id AND cp.collection_id = ?)');
    args.push(opts.collectionId);
  }
  const limit = Math.min(500, Math.max(1, opts.limit ?? 100));
  const offset = Math.max(0, opts.offset ?? 0);
  const db = getDb();
  const [rows, count] = await Promise.all([
    db
      .prepare(
        `SELECT p.id, p.handle, p.title, p.status, p.vendor, p.product_type, p.images, p.updated_at,
           (SELECT COUNT(*) FROM shop_variants v WHERE v.product_id = p.id) AS variants,
           (SELECT MIN(price_cents) FROM shop_variants v WHERE v.product_id = p.id) AS min_price,
           (SELECT MAX(price_cents) FROM shop_variants v WHERE v.product_id = p.id) AS max_price,
           (SELECT MAX(track_inventory) FROM shop_variants v WHERE v.product_id = p.id) AS tracked,
           (SELECT COALESCE(SUM(MAX(i.available - i.reserved, 0)), 0) FROM shop_inventory i JOIN shop_variants v ON v.id = i.variant_id WHERE v.product_id = p.id) AS stock
         FROM shop_products p WHERE ${where.join(' AND ')} ORDER BY p.updated_at DESC LIMIT ? OFFSET ?`,
      )
      .all(...args, limit, offset) as Promise<Array<Record<string, unknown>>>,
    db.prepare(`SELECT COUNT(*) AS n FROM shop_products p WHERE ${where.join(' AND ')}`).get(...args) as Promise<{ n: number }>,
  ]);
  return {
    total: Number(count?.n ?? 0),
    items: rows.map((r) => ({
      id: String(r.id),
      handle: String(r.handle),
      title: String(r.title),
      status: String(r.status),
      vendor: String(r.vendor ?? ''),
      productType: String(r.product_type ?? ''),
      image: parseJson<string[]>(r.images, [])[0] ?? null,
      variants: Number(r.variants ?? 0),
      stock: Number(r.stock ?? 0),
      tracked: Number(r.tracked ?? 0) === 1,
      minPriceCents: Number(r.min_price ?? 0),
      maxPriceCents: Number(r.max_price ?? 0),
      updatedAt: String(r.updated_at),
    })),
  };
}

async function freeProductHandle(ws: string, base: string, exceptId?: string): Promise<string> {
  const root = slugify(base);
  for (let i = 1; i < 1000; i++) {
    const candidate = i === 1 ? root : `${root}-${i}`;
    const row = (await getDb().prepare('SELECT id FROM shop_products WHERE workspace_id = ? AND handle = ?').get(ws, candidate)) as { id: string } | undefined;
    if (!row || row.id === exceptId) return candidate;
  }
  return `${root}-${randomBytes(3).toString('hex')}`;
}

async function freeCollectionHandle(ws: string, base: string, exceptId?: string): Promise<string> {
  const root = slugify(base);
  for (let i = 1; i < 1000; i++) {
    const candidate = i === 1 ? root : `${root}-${i}`;
    const row = (await getDb().prepare('SELECT id FROM shop_collections WHERE workspace_id = ? AND handle = ?').get(ws, candidate)) as { id: string } | undefined;
    if (!row || row.id === exceptId) return candidate;
  }
  return `${root}-${randomBytes(3).toString('hex')}`;
}

export async function defaultLocation(ws: string): Promise<string> {
  const db = getDb();
  const row = (await db.prepare('SELECT id FROM shop_locations WHERE workspace_id = ? ORDER BY is_default DESC, created_at ASC LIMIT 1').get(ws)) as
    | { id: string }
    | undefined;
  if (row) return row.id;
  await ensureStore(ws);
  const again = (await db.prepare('SELECT id FROM shop_locations WHERE workspace_id = ? ORDER BY is_default DESC, created_at ASC LIMIT 1').get(ws)) as { id: string };
  return again.id;
}

/**
 * Variantes del producto según sus opciones: cada variante que llega tiene
 * que tener un valor por opción, y no puede haber dos con la misma
 * combinación. Sin opciones, una sola variante ("Default").
 */
function checkVariants(options: ProductOption[], variants: ProductInput['variants']): void {
  const seen = new Set<string>();
  for (const v of variants) {
    if (options.length === 0) {
      if (variants.length > 1) throw new ShopError('options_required');
      continue;
    }
    if (v.options.length !== options.length) throw new ShopError('variant_options');
    v.options.forEach((value, i) => {
      if (!options[i].values.some((x) => x.toLowerCase() === value.trim().toLowerCase())) throw new ShopError('variant_options');
    });
    const key = v.options.map((x) => x.trim().toLowerCase()).join('|');
    if (seen.has(key)) throw new ShopError('duplicate_variant');
    seen.add(key);
  }
}

function cleanImages(images: string[]): string[] {
  const out: string[] = [];
  for (const url of images) {
    if (!isOwnShopImage(url)) throw new ShopError('invalid_image');
    if (!out.includes(url)) out.push(url);
  }
  return out;
}

async function cleanCollectionIds(ws: string, ids: string[] | undefined): Promise<string[] | undefined> {
  if (!ids) return undefined;
  const uniq = [...new Set(ids)];
  if (!uniq.length) return [];
  const rows = (await getDb()
    .prepare(`SELECT id FROM shop_collections WHERE workspace_id = ? AND kind = 'manual' AND id IN (${uniq.map(() => '?').join(',')})`)
    .all(ws, ...uniq)) as Array<{ id: string }>;
  return rows.map((r) => r.id);
}

export async function createProduct(actor: ShopActor, raw: unknown, opts: { reason?: string } = {}): Promise<ProductDto> {
  const parsed = productInputSchema.safeParse(raw);
  if (!parsed.success) throw new ShopError('invalid_input', 400, { issues: parsed.error.issues.slice(0, 5) });
  const input = parsed.data;
  await ensureStore(actor.ws);
  const options = normalizeOptions(input.options);
  checkVariants(options, input.variants);
  const images = cleanImages(input.images);
  const handle = input.handle ? slugify(input.handle) : slugify(input.title);
  if (!HANDLE_RE.test(handle)) throw new ShopError('invalid_handle');
  const finalHandle = await freeProductHandle(actor.ws, handle);
  const id = newId('prod');
  const ts = nowDb();
  const db = getDb();
  await db
    .prepare(
      `INSERT INTO shop_products (id, workspace_id, handle, title, description, vendor, product_type, tags, status, options, images, seo_title, seo_description, requires_shipping, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      actor.ws,
      finalHandle,
      input.title,
      sanitizeDescription(input.description),
      input.vendor,
      input.productType,
      JSON.stringify([...new Set(input.tags)]),
      input.status,
      JSON.stringify(options),
      JSON.stringify(images),
      input.seoTitle,
      input.seoDescription,
      input.requiresShipping ? 1 : 0,
      actor.person,
      ts,
      ts,
    );
  await writeVariants(actor, id, options, input.variants, opts.reason ?? 'initial');
  const collectionIds = await cleanCollectionIds(actor.ws, input.collectionIds);
  if (collectionIds) await setProductCollections(actor.ws, id, collectionIds);
  await revalidateWs(actor.ws);
  return (await getProduct(actor.ws, id))!;
}

/** Reemplaza las variantes: actualiza las que vienen con id, crea las nuevas y borra las que faltan. */
async function writeVariants(actor: ShopActor, productId: string, options: ProductOption[], variants: ProductInput['variants'], reason: string): Promise<void> {
  const db = getDb();
  const existing = (await db.prepare('SELECT id FROM shop_variants WHERE product_id = ?').all(productId)) as Array<{ id: string }>;
  const keep = new Set<string>();
  const loc = await defaultLocation(actor.ws);
  for (const [i, v] of variants.entries()) {
    const values = options.length ? v.options.map((x, j) => options[j].values.find((o) => o.toLowerCase() === x.trim().toLowerCase()) ?? x.trim()) : [];
    const title = options.length ? variantTitle(values) : 'Default';
    if (v.imageUrl && !isOwnShopImage(v.imageUrl)) throw new ShopError('invalid_image');
    const compare = v.compareAtCents != null && v.compareAtCents > v.priceCents ? v.compareAtCents : null;
    if (v.id && existing.some((e) => e.id === v.id)) {
      keep.add(v.id);
      await db
        .prepare(
          `UPDATE shop_variants SET title = ?, options = ?, sku = ?, barcode = ?, price_cents = ?, compare_at_cents = ?, weight_grams = ?, track_inventory = ?, position = ?, image_url = ?
           WHERE id = ? AND product_id = ?`,
        )
        .run(title, JSON.stringify(values), v.sku, v.barcode, v.priceCents, compare, v.weightGrams, v.trackInventory ? 1 : 0, i, v.imageUrl ?? null, v.id, productId);
      continue;
    }
    const vid = newId('var');
    keep.add(vid);
    await db
      .prepare(
        `INSERT INTO shop_variants (id, product_id, workspace_id, title, options, sku, barcode, price_cents, compare_at_cents, weight_grams, track_inventory, position, image_url)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(vid, productId, actor.ws, title, JSON.stringify(values), v.sku, v.barcode, v.priceCents, compare, v.weightGrams, v.trackInventory ? 1 : 0, i, v.imageUrl ?? null);
    await db.prepare('INSERT OR IGNORE INTO shop_inventory (variant_id, location_id, workspace_id, available, reserved) VALUES (?, ?, ?, 0, 0)').run(vid, loc, actor.ws);
    if (v.initialStock && v.initialStock > 0) {
      await adjustInventory(actor, { variantId: vid, locationId: loc, delta: v.initialStock, reason }, { skipRevalidate: true });
    }
  }
  const drop = existing.filter((e) => !keep.has(e.id)).map((e) => e.id);
  if (drop.length) await db.prepare(`DELETE FROM shop_variants WHERE id IN (${drop.map(() => '?').join(',')})`).run(...drop);
}

export async function updateProduct(actor: ShopActor, id: string, patch: ProductPatch): Promise<ProductDto> {
  const row = await getProductRow(actor.ws, id);
  if (!row) throw new ShopError('not_found', 404);
  const current = (await productDtos(actor.ws, [row]))[0];
  const merged = {
    title: patch.title ?? row.title,
    handle: patch.handle ?? row.handle,
    description: patch.description ?? row.description,
    vendor: patch.vendor ?? row.vendor,
    productType: patch.productType ?? row.product_type,
    tags: patch.tags ?? current.tags,
    status: patch.status ?? row.status,
    options: patch.options ?? current.options,
    images: patch.images ?? current.images,
    seoTitle: patch.seoTitle ?? row.seo_title,
    seoDescription: patch.seoDescription ?? row.seo_description,
    requiresShipping: patch.requiresShipping ?? row.requires_shipping === 1,
    variants:
      patch.variants ??
      current.variants.map((v) => ({
        id: v.id,
        options: v.options,
        sku: v.sku,
        barcode: v.barcode,
        priceCents: v.priceCents,
        compareAtCents: v.compareAtCents,
        weightGrams: v.weightGrams,
        trackInventory: v.trackInventory,
        imageUrl: v.imageUrl,
      })),
    collectionIds: patch.collectionIds,
  };
  const parsed = productInputSchema.safeParse(merged);
  if (!parsed.success) throw new ShopError('invalid_input', 400, { issues: parsed.error.issues.slice(0, 5) });
  const input = parsed.data;
  const options = normalizeOptions(input.options);
  checkVariants(options, input.variants);
  const images = cleanImages(input.images);
  let handle = row.handle;
  if (patch.handle !== undefined && slugify(patch.handle) !== row.handle) {
    const h = slugify(patch.handle);
    if (!HANDLE_RE.test(h)) throw new ShopError('invalid_handle');
    const taken = (await getDb().prepare('SELECT id FROM shop_products WHERE workspace_id = ? AND handle = ? AND id != ?').get(actor.ws, h, id)) as
      | { id: string }
      | undefined;
    if (taken) throw new ShopError('handle_taken', 409);
    handle = h;
  }
  await getDb()
    .prepare(
      `UPDATE shop_products SET handle = ?, title = ?, description = ?, vendor = ?, product_type = ?, tags = ?, status = ?, options = ?, images = ?,
         seo_title = ?, seo_description = ?, requires_shipping = ?, updated_at = ? WHERE id = ? AND workspace_id = ?`,
    )
    .run(
      handle,
      input.title,
      patch.description !== undefined ? sanitizeDescription(input.description) : row.description,
      input.vendor,
      input.productType,
      JSON.stringify([...new Set(input.tags)]),
      input.status,
      JSON.stringify(options),
      JSON.stringify(images),
      input.seoTitle,
      input.seoDescription,
      input.requiresShipping ? 1 : 0,
      nowDb(),
      id,
      actor.ws,
    );
  if (patch.variants !== undefined || patch.options !== undefined) await writeVariants(actor, id, options, input.variants, 'adjust');
  const collectionIds = await cleanCollectionIds(actor.ws, input.collectionIds);
  if (collectionIds) await setProductCollections(actor.ws, id, collectionIds);
  await revalidateWs(actor.ws);
  return (await getProduct(actor.ws, id))!;
}

export async function deleteProduct(actor: ShopActor, id: string): Promise<boolean> {
  const res = await getDb().prepare('DELETE FROM shop_products WHERE id = ? AND workspace_id = ?').run(id, actor.ws);
  if (res.changes) await revalidateWs(actor.ws);
  return res.changes > 0;
}

/** Variantes con todas las combinaciones de las opciones (para "generar variantes" en el editor). */
export function generateVariants(options: ProductOption[], base: { priceCents: number }): ProductInput['variants'] {
  return optionCombos(normalizeOptions(options)).map((combo) => ({
    options: combo,
    sku: '',
    barcode: '',
    priceCents: base.priceCents,
    compareAtCents: null,
    weightGrams: 0,
    trackInventory: true,
  }));
}

// ---------- Ubicaciones e inventario ----------

export interface LocationDto {
  id: string;
  name: string;
  isDefault: boolean;
}

export async function listLocations(ws: string): Promise<LocationDto[]> {
  await ensureStore(ws);
  const rows = (await getDb().prepare('SELECT id, name, is_default FROM shop_locations WHERE workspace_id = ? ORDER BY is_default DESC, created_at ASC').all(ws)) as Array<{
    id: string;
    name: string;
    is_default: number;
  }>;
  return rows.map((r) => ({ id: r.id, name: r.name, isDefault: r.is_default === 1 }));
}

export async function createLocation(actor: ShopActor, name: string): Promise<LocationDto> {
  const clean = name.trim().slice(0, 80);
  if (!clean) throw new ShopError('invalid_name');
  await ensureStore(actor.ws);
  const count = (await getDb().prepare('SELECT COUNT(*) AS n FROM shop_locations WHERE workspace_id = ?').get(actor.ws)) as { n: number };
  if (Number(count.n) >= 50) throw new ShopError('too_many_locations');
  const id = newId('loc');
  await getDb().prepare('INSERT INTO shop_locations (id, workspace_id, name, is_default, created_at) VALUES (?, ?, ?, 0, ?)').run(id, actor.ws, clean, nowDb());
  return { id, name: clean, isDefault: false };
}

export async function updateLocation(actor: ShopActor, id: string, patch: { name?: string; isDefault?: boolean }): Promise<void> {
  const db = getDb();
  const row = await db.prepare('SELECT id FROM shop_locations WHERE id = ? AND workspace_id = ?').get(id, actor.ws);
  if (!row) throw new ShopError('not_found', 404);
  if (patch.name !== undefined) {
    const clean = patch.name.trim().slice(0, 80);
    if (!clean) throw new ShopError('invalid_name');
    await db.prepare('UPDATE shop_locations SET name = ? WHERE id = ?').run(clean, id);
  }
  if (patch.isDefault) {
    await db.prepare('UPDATE shop_locations SET is_default = CASE WHEN id = ? THEN 1 ELSE 0 END WHERE workspace_id = ?').run(id, actor.ws);
  }
}

/** Borra una ubicación sin stock ni reservas (no la por defecto). */
export async function deleteLocation(actor: ShopActor, id: string): Promise<void> {
  const db = getDb();
  const row = (await db.prepare('SELECT is_default FROM shop_locations WHERE id = ? AND workspace_id = ?').get(id, actor.ws)) as { is_default: number } | undefined;
  if (!row) throw new ShopError('not_found', 404);
  if (row.is_default === 1) throw new ShopError('default_location', 409);
  const stock = (await db.prepare('SELECT COALESCE(SUM(available + reserved), 0) AS n FROM shop_inventory WHERE location_id = ?').get(id)) as { n: number };
  if (Number(stock.n) > 0) throw new ShopError('location_has_stock', 409);
  await db.prepare('DELETE FROM shop_locations WHERE id = ? AND workspace_id = ?').run(id, actor.ws);
}

export interface InventoryRow {
  variantId: string;
  productId: string;
  productTitle: string;
  variantTitle: string;
  sku: string;
  locationId: string;
  locationName: string;
  available: number;
  reserved: number;
  low: boolean;
}

export async function listInventory(ws: string, opts: { q?: string; lowOnly?: boolean; locationId?: string } = {}): Promise<InventoryRow[]> {
  const store = await ensureStore(ws);
  const where = ['i.workspace_id = ?', 'v.track_inventory = 1'];
  const args: Array<string | number> = [ws];
  if (opts.q?.trim()) {
    where.push("(p.title LIKE ? ESCAPE '\\' OR v.sku LIKE ? ESCAPE '\\' OR v.title LIKE ? ESCAPE '\\')");
    const l = likeEsc(opts.q.trim());
    args.push(l, l, l);
  }
  if (opts.locationId) {
    where.push('i.location_id = ?');
    args.push(opts.locationId);
  }
  if (opts.lowOnly) {
    where.push('(i.available - i.reserved) <= ?');
    args.push(store.low_stock);
  }
  const rows = (await getDb()
    .prepare(
      `SELECT i.variant_id, i.location_id, i.available, i.reserved, v.title AS vtitle, v.sku, p.id AS pid, p.title AS ptitle, l.name AS lname
       FROM shop_inventory i JOIN shop_variants v ON v.id = i.variant_id JOIN shop_products p ON p.id = v.product_id JOIN shop_locations l ON l.id = i.location_id
       WHERE ${where.join(' AND ')} ORDER BY p.title ASC, v.position ASC, l.is_default DESC LIMIT 2000`,
    )
    .all(...args)) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    variantId: String(r.variant_id),
    productId: String(r.pid),
    productTitle: String(r.ptitle),
    variantTitle: String(r.vtitle),
    sku: String(r.sku ?? ''),
    locationId: String(r.location_id),
    locationName: String(r.lname),
    available: Number(r.available),
    reserved: Number(r.reserved),
    low: Number(r.available) - Number(r.reserved) <= store.low_stock,
  }));
}

export interface AdjustInput {
  variantId: string;
  locationId: string;
  /** Suma o resta. Excluyente con `set`. */
  delta?: number;
  /** Fija el disponible (conteo). */
  set?: number;
  reason: string;
  ref?: string | null;
}

/**
 * Ajuste manual o por import, con historial. `set` se hace con
 * compare-and-set sobre el valor leído (si alguien vendió en el medio, se
 * reintenta); `delta` es una suma atómica que nunca deja el disponible por
 * debajo de lo reservado.
 */
export async function adjustInventory(actor: ShopActor, input: AdjustInput, opts: { skipRevalidate?: boolean } = {}): Promise<{ available: number; reserved: number }> {
  const db = getDb();
  const v = (await db.prepare('SELECT v.id, v.product_id FROM shop_variants v WHERE v.id = ? AND v.workspace_id = ?').get(input.variantId, actor.ws)) as
    | { id: string; product_id: string }
    | undefined;
  if (!v) throw new ShopError('not_found', 404);
  const loc = await db.prepare('SELECT id FROM shop_locations WHERE id = ? AND workspace_id = ?').get(input.locationId, actor.ws);
  if (!loc) throw new ShopError('not_found', 404);
  await db.prepare('INSERT OR IGNORE INTO shop_inventory (variant_id, location_id, workspace_id, available, reserved) VALUES (?, ?, ?, 0, 0)').run(input.variantId, input.locationId, actor.ws);
  let after: { available: number; reserved: number } | null = null;
  let delta = 0;
  for (let attempt = 0; attempt < 5 && !after; attempt++) {
    const cur = (await db.prepare('SELECT available, reserved FROM shop_inventory WHERE variant_id = ? AND location_id = ?').get(input.variantId, input.locationId)) as {
      available: number;
      reserved: number;
    };
    if (input.set !== undefined) {
      const target = Math.max(0, Math.trunc(input.set));
      if (target < cur.reserved) throw new ShopError('below_reserved', 409, { reserved: cur.reserved });
      const res = await db
        .prepare('UPDATE shop_inventory SET available = ? WHERE variant_id = ? AND location_id = ? AND available = ? AND reserved = ?')
        .run(target, input.variantId, input.locationId, cur.available, cur.reserved);
      if (res.changes) {
        delta = target - cur.available;
        after = { available: target, reserved: cur.reserved };
      }
    } else {
      const d = Math.trunc(input.delta ?? 0);
      if (d === 0) return cur;
      const res = await db
        .prepare('UPDATE shop_inventory SET available = available + ? WHERE variant_id = ? AND location_id = ? AND available + ? >= reserved AND available + ? >= 0')
        .run(d, input.variantId, input.locationId, d, d);
      if (!res.changes) throw new ShopError('below_reserved', 409, { reserved: cur.reserved });
      delta = d;
      after = (await db.prepare('SELECT available, reserved FROM shop_inventory WHERE variant_id = ? AND location_id = ?').get(input.variantId, input.locationId)) as {
        available: number;
        reserved: number;
      };
    }
  }
  if (!after) throw new ShopError('conflict', 409);
  if (delta !== 0) await logInventory(actor.ws, input.variantId, input.locationId, delta, after.available, input.reason, input.ref ?? null, actor.person);
  if (!opts.skipRevalidate) await revalidateWs(actor.ws);
  if (delta < 0) await checkLowStock(actor.ws, [input.variantId]);
  return after;
}

export async function logInventory(ws: string, variantId: string, locationId: string, delta: number, availableAfter: number, reason: string, ref: string | null, by: string | null): Promise<void> {
  await getDb()
    .prepare(
      'INSERT INTO shop_inventory_log (id, workspace_id, variant_id, location_id, delta, available_after, reason, ref, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run(newId('inv'), ws, variantId, locationId, delta, availableAfter, reason.slice(0, 40), ref, by, nowDb());
}

export interface InventoryLogDto {
  id: string;
  variantId: string;
  productTitle: string;
  variantTitle: string;
  locationName: string;
  delta: number;
  availableAfter: number;
  reason: string;
  ref: string | null;
  createdAt: string;
}

export async function inventoryHistory(ws: string, opts: { variantId?: string; limit?: number } = {}): Promise<InventoryLogDto[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT g.*, v.title AS vtitle, p.title AS ptitle, l.name AS lname FROM shop_inventory_log g
       LEFT JOIN shop_variants v ON v.id = g.variant_id LEFT JOIN shop_products p ON p.id = v.product_id LEFT JOIN shop_locations l ON l.id = g.location_id
       WHERE g.workspace_id = ?${opts.variantId ? ' AND g.variant_id = ?' : ''} ORDER BY g.created_at DESC, g.id DESC LIMIT ?`,
    )
    .all(...(opts.variantId ? [ws, opts.variantId] : [ws]), Math.min(500, opts.limit ?? 100))) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    variantId: String(r.variant_id),
    productTitle: String(r.ptitle ?? ''),
    variantTitle: String(r.vtitle ?? ''),
    locationName: String(r.lname ?? ''),
    delta: Number(r.delta),
    availableAfter: Number(r.available_after),
    reason: String(r.reason),
    ref: (r.ref as string | null) ?? null,
    createdAt: String(r.created_at),
  }));
}

/**
 * Aviso de stock bajo: si alguna variante quedó en el umbral o por debajo,
 * evento shop.inventory.low (Flow, webhooks) y aviso a los admins. Una vez
 * por variante y día. Nunca lanza.
 */
export async function checkLowStock(ws: string, variantIds: string[]): Promise<void> {
  if (!variantIds.length) return;
  try {
    const store = await getStore(ws);
    if (!store) return;
    const rows = (await getDb()
      .prepare(
        `SELECT v.id, v.title AS vtitle, v.sku, p.id AS pid, p.title AS ptitle, SUM(i.available - i.reserved) AS free
         FROM shop_variants v JOIN shop_products p ON p.id = v.product_id JOIN shop_inventory i ON i.variant_id = v.id
         WHERE v.workspace_id = ? AND v.track_inventory = 1 AND v.id IN (${variantIds.map(() => '?').join(',')}) GROUP BY v.id`,
      )
      .all(ws, ...variantIds)) as Array<{ id: string; vtitle: string; sku: string; pid: string; ptitle: string; free: number }>;
    const low = rows.filter((r) => Number(r.free) <= store.low_stock);
    if (!low.length) return;
    const { onLowStock } = await import('./shop-effects');
    await onLowStock(store, low.map((r) => ({ variantId: r.id, productId: r.pid, product: r.ptitle, variant: r.vtitle, sku: r.sku, available: Number(r.free) })));
  } catch (err) {
    console.error('[shop] low stock check failed', err);
  }
}

// ---------- Reservas (pedidos) ----------

export interface ReserveLine {
  variantId: string;
  quantity: number;
}

/**
 * Reserva stock para un pedido: por línea, la primera ubicación (la por
 * defecto primero) con disponible − reservado suficiente, con compare-and-set.
 * Si una línea no alcanza, deshace lo reservado y lanza out_of_stock.
 * Devuelve la ubicación de cada línea (null = la variante no lleva stock).
 */
export async function reserveStock(ws: string, lines: Array<ReserveLine & { track: boolean }>): Promise<Array<string | null>> {
  const db = getDb();
  const done: Array<{ variantId: string; locationId: string; quantity: number }> = [];
  const out: Array<string | null> = [];
  for (const line of lines) {
    if (!line.track) {
      out.push(null);
      continue;
    }
    const candidates = (await db
      .prepare(
        `SELECT i.location_id FROM shop_inventory i JOIN shop_locations l ON l.id = i.location_id
         WHERE i.variant_id = ? AND i.workspace_id = ? AND i.available - i.reserved >= ? ORDER BY l.is_default DESC, (i.available - i.reserved) DESC`,
      )
      .all(line.variantId, ws, line.quantity)) as Array<{ location_id: string }>;
    let got: string | null = null;
    for (const c of candidates) {
      const res = await db
        .prepare('UPDATE shop_inventory SET reserved = reserved + ? WHERE variant_id = ? AND location_id = ? AND available - reserved >= ?')
        .run(line.quantity, line.variantId, c.location_id, line.quantity);
      if (res.changes) {
        got = c.location_id;
        break;
      }
    }
    if (!got) {
      for (const d of done) await releaseLine(d.variantId, d.locationId, d.quantity);
      throw new ShopError('out_of_stock', 409, { variantId: line.variantId });
    }
    done.push({ variantId: line.variantId, locationId: got, quantity: line.quantity });
    out.push(got);
  }
  return out;
}

async function releaseLine(variantId: string, locationId: string, quantity: number): Promise<void> {
  await getDb()
    .prepare('UPDATE shop_inventory SET reserved = MAX(reserved - ?, 0) WHERE variant_id = ? AND location_id = ?')
    .run(quantity, variantId, locationId);
}

export interface StockItem {
  variant_id: string | null;
  location_id: string | null;
  quantity: number;
  track_inventory: number;
}

/** Libera lo reservado por un pedido (no pagado que se cancela o vence). */
export async function releaseReservation(items: StockItem[]): Promise<void> {
  for (const it of items) {
    if (it.track_inventory && it.variant_id && it.location_id) await releaseLine(it.variant_id, it.location_id, it.quantity);
  }
}

/**
 * Descuenta el stock al pagar, con compare-and-set (nunca baja de 0). Si
 * venía reservado, consume la reserva; si la reserva ya se había liberado
 * (pago tardío), toma de lo libre. Devuelve las líneas que no se pudieron
 * descontar (sobreventa a resolver con el cliente).
 */
export async function commitStock(ws: string, orderId: string, items: StockItem[], fromReserved: boolean, by: string | null): Promise<string[]> {
  const db = getDb();
  const failed: string[] = [];
  for (const it of items) {
    if (!it.track_inventory || !it.variant_id || !it.location_id) continue;
    const res = fromReserved
      ? await db
          .prepare('UPDATE shop_inventory SET available = available - ?, reserved = MAX(reserved - ?, 0) WHERE variant_id = ? AND location_id = ? AND available >= ?')
          .run(it.quantity, it.quantity, it.variant_id, it.location_id, it.quantity)
      : await db
          .prepare('UPDATE shop_inventory SET available = available - ? WHERE variant_id = ? AND location_id = ? AND available - reserved >= ?')
          .run(it.quantity, it.variant_id, it.location_id, it.quantity);
    if (!res.changes) {
      failed.push(it.variant_id);
      continue;
    }
    const after = (await db.prepare('SELECT available FROM shop_inventory WHERE variant_id = ? AND location_id = ?').get(it.variant_id, it.location_id)) as { available: number };
    await logInventory(ws, it.variant_id, it.location_id, -it.quantity, Number(after.available), 'order', orderId, by);
  }
  return failed;
}

/** Devuelve al stock lo vendido (cancelación o reembolso con reposición). */
export async function restock(ws: string, orderId: string, items: StockItem[], by: string | null, reason = 'restock'): Promise<void> {
  const db = getDb();
  for (const it of items) {
    if (!it.track_inventory || !it.variant_id || !it.location_id) continue;
    const res = await db.prepare('UPDATE shop_inventory SET available = available + ? WHERE variant_id = ? AND location_id = ?').run(it.quantity, it.variant_id, it.location_id);
    if (!res.changes) continue;
    const after = (await db.prepare('SELECT available FROM shop_inventory WHERE variant_id = ? AND location_id = ?').get(it.variant_id, it.location_id)) as { available: number };
    await logInventory(ws, it.variant_id, it.location_id, it.quantity, Number(after.available), reason, orderId, by);
  }
}

// ---------- Colecciones ----------

export interface CollectionRow {
  id: string;
  workspace_id: string;
  handle: string;
  title: string;
  description: string;
  kind: string;
  rules: string;
  image_url: string | null;
  published: number;
  featured: number;
  created_at: string;
  updated_at: string;
}

export interface CollectionDto {
  id: string;
  handle: string;
  title: string;
  description: string;
  kind: 'manual' | 'auto';
  rules: CollectionRules;
  imageUrl: string | null;
  published: boolean;
  featured: boolean;
  productIds: string[];
  productCount: number;
  updatedAt: string;
}

/** ¿El producto cumple las reglas de una colección automática? */
export function matchesRules(
  p: { title: string; vendor: string; productType: string; tags: string[]; minPriceCents: number },
  rules: CollectionRules,
): boolean {
  if (!rules.rules.length) return false;
  const test = (r: CollectionRules['rules'][number]): boolean => {
    const v = r.value.trim().toLowerCase();
    if (r.field === 'price') {
      const cents = Math.round(Number(r.value) * 100);
      if (!Number.isFinite(cents)) return false;
      if (r.op === 'gt') return p.minPriceCents > cents;
      if (r.op === 'lt') return p.minPriceCents < cents;
      return p.minPriceCents === cents;
    }
    const values =
      r.field === 'tag' ? p.tags.map((t) => t.toLowerCase()) : [(r.field === 'type' ? p.productType : r.field === 'vendor' ? p.vendor : p.title).toLowerCase()];
    if (r.op === 'equals') return values.includes(v);
    if (r.op === 'contains') return values.some((x) => x.includes(v));
    return false;
  };
  return rules.match === 'any' ? rules.rules.some(test) : rules.rules.every(test);
}

async function autoProductIds(ws: string, rules: CollectionRules, onlyActive: boolean): Promise<string[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT p.id, p.title, p.vendor, p.product_type, p.tags, (SELECT MIN(price_cents) FROM shop_variants v WHERE v.product_id = p.id) AS min_price
       FROM shop_products p WHERE p.workspace_id = ?${onlyActive ? " AND p.status = 'active'" : ''} ORDER BY p.created_at DESC LIMIT 5000`,
    )
    .all(ws)) as Array<{ id: string; title: string; vendor: string; product_type: string; tags: string; min_price: number | null }>;
  return rows
    .filter((r) => matchesRules({ title: r.title, vendor: r.vendor, productType: r.product_type, tags: parseJson<string[]>(r.tags, []), minPriceCents: Number(r.min_price ?? 0) }, rules))
    .map((r) => r.id);
}

export async function collectionProductIds(ws: string, c: CollectionRow, onlyActive = false): Promise<string[]> {
  if (c.kind === 'auto') return autoProductIds(ws, parseJson<CollectionRules>(c.rules, { match: 'all', rules: [] }), onlyActive);
  const rows = (await getDb()
    .prepare(
      `SELECT cp.product_id FROM shop_collection_products cp JOIN shop_products p ON p.id = cp.product_id
       WHERE cp.collection_id = ?${onlyActive ? " AND p.status = 'active'" : ''} ORDER BY cp.position ASC`,
    )
    .all(c.id)) as Array<{ product_id: string }>;
  return rows.map((r) => r.product_id);
}

async function collectionDto(ws: string, c: CollectionRow): Promise<CollectionDto> {
  const ids = await collectionProductIds(ws, c);
  return {
    id: c.id,
    handle: c.handle,
    title: c.title,
    description: c.description,
    kind: c.kind === 'auto' ? 'auto' : 'manual',
    rules: parseJson<CollectionRules>(c.rules, { match: 'all', rules: [] }),
    imageUrl: c.image_url,
    published: c.published === 1,
    featured: c.featured === 1,
    productIds: ids,
    productCount: ids.length,
    updatedAt: c.updated_at,
  };
}

export async function listCollections(ws: string, opts: { q?: string } = {}): Promise<CollectionDto[]> {
  const rows = (await getDb()
    .prepare(`SELECT * FROM shop_collections WHERE workspace_id = ?${opts.q?.trim() ? " AND title LIKE ? ESCAPE '\\'" : ''} ORDER BY updated_at DESC`)
    .all(...(opts.q?.trim() ? [ws, likeEsc(opts.q.trim())] : [ws]))) as CollectionRow[];
  return Promise.all(rows.map((c) => collectionDto(ws, c)));
}

export async function getCollectionRow(ws: string, id: string): Promise<CollectionRow | null> {
  return ((await getDb().prepare('SELECT * FROM shop_collections WHERE id = ? AND workspace_id = ?').get(id, ws)) as CollectionRow | undefined) ?? null;
}

export async function getCollection(ws: string, id: string): Promise<CollectionDto | null> {
  const c = await getCollectionRow(ws, id);
  return c ? collectionDto(ws, c) : null;
}

async function setCollectionProducts(ws: string, collectionId: string, productIds: string[]): Promise<void> {
  const db = getDb();
  const uniq = [...new Set(productIds)];
  const valid = uniq.length
    ? ((await db.prepare(`SELECT id FROM shop_products WHERE workspace_id = ? AND id IN (${uniq.map(() => '?').join(',')})`).all(ws, ...uniq)) as Array<{ id: string }>).map(
        (r) => r.id,
      )
    : [];
  await db.prepare('DELETE FROM shop_collection_products WHERE collection_id = ?').run(collectionId);
  for (const [i, pid] of uniq.filter((id) => valid.includes(id)).entries()) {
    await db.prepare('INSERT OR IGNORE INTO shop_collection_products (collection_id, product_id, position) VALUES (?, ?, ?)').run(collectionId, pid, i);
  }
}

async function setProductCollections(ws: string, productId: string, collectionIds: string[]): Promise<void> {
  const db = getDb();
  await db
    .prepare(
      `DELETE FROM shop_collection_products WHERE product_id = ? AND collection_id IN (SELECT id FROM shop_collections WHERE workspace_id = ? AND kind = 'manual')`,
    )
    .run(productId, ws);
  for (const cid of collectionIds) {
    const pos = (await db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS n FROM shop_collection_products WHERE collection_id = ?').get(cid)) as { n: number };
    await db.prepare('INSERT OR IGNORE INTO shop_collection_products (collection_id, product_id, position) VALUES (?, ?, ?)').run(cid, productId, Number(pos.n));
  }
}

export async function createCollection(actor: ShopActor, raw: unknown): Promise<CollectionDto> {
  const parsed = collectionInputSchema.safeParse(raw);
  if (!parsed.success) throw new ShopError('invalid_input');
  const input: CollectionInput = parsed.data;
  if (input.imageUrl && !isOwnShopImage(input.imageUrl)) throw new ShopError('invalid_image');
  await ensureStore(actor.ws);
  const id = newId('col');
  const handle = await freeCollectionHandle(actor.ws, input.handle || input.title);
  const ts = nowDb();
  await getDb()
    .prepare(
      `INSERT INTO shop_collections (id, workspace_id, handle, title, description, kind, rules, image_url, published, featured, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      actor.ws,
      handle,
      input.title,
      sanitizeDescription(input.description),
      input.kind,
      JSON.stringify(input.rules ?? { match: 'all', rules: [] }),
      input.imageUrl ?? null,
      input.published ? 1 : 0,
      input.featured ? 1 : 0,
      ts,
      ts,
    );
  if (input.kind === 'manual' && input.productIds) await setCollectionProducts(actor.ws, id, input.productIds);
  await revalidateWs(actor.ws);
  return (await getCollection(actor.ws, id))!;
}

export async function updateCollection(actor: ShopActor, id: string, raw: unknown): Promise<CollectionDto> {
  const c = await getCollectionRow(actor.ws, id);
  if (!c) throw new ShopError('not_found', 404);
  const parsed = collectionInputSchema.partial().safeParse(raw);
  if (!parsed.success) throw new ShopError('invalid_input');
  const p = parsed.data;
  if (p.imageUrl && !isOwnShopImage(p.imageUrl)) throw new ShopError('invalid_image');
  let handle = c.handle;
  if (p.handle !== undefined && slugify(p.handle) !== c.handle) {
    const h = slugify(p.handle);
    const taken = await getDb().prepare('SELECT 1 AS x FROM shop_collections WHERE workspace_id = ? AND handle = ? AND id != ?').get(actor.ws, h, id);
    if (taken) throw new ShopError('handle_taken', 409);
    handle = h;
  }
  await getDb()
    .prepare(
      `UPDATE shop_collections SET handle = ?, title = ?, description = ?, kind = ?, rules = ?, image_url = ?, published = ?, featured = ?, updated_at = ?
       WHERE id = ? AND workspace_id = ?`,
    )
    .run(
      handle,
      p.title ?? c.title,
      p.description !== undefined ? sanitizeDescription(p.description) : c.description,
      p.kind ?? c.kind,
      p.rules ? JSON.stringify(p.rules) : c.rules,
      p.imageUrl !== undefined ? p.imageUrl : c.image_url,
      p.published !== undefined ? (p.published ? 1 : 0) : c.published,
      p.featured !== undefined ? (p.featured ? 1 : 0) : c.featured,
      nowDb(),
      id,
      actor.ws,
    );
  if ((p.kind ?? c.kind) === 'manual' && p.productIds) await setCollectionProducts(actor.ws, id, p.productIds);
  await revalidateWs(actor.ws);
  return (await getCollection(actor.ws, id))!;
}

export async function deleteCollection(actor: ShopActor, id: string): Promise<boolean> {
  const res = await getDb().prepare('DELETE FROM shop_collections WHERE id = ? AND workspace_id = ?').run(id, actor.ws);
  if (res.changes) await revalidateWs(actor.ws);
  return res.changes > 0;
}

// ---------- Envíos e impuestos ----------

export async function listShippingRates(ws: string): Promise<ShippingRate[]> {
  const rows = (await getDb().prepare('SELECT * FROM shop_shipping_rates WHERE workspace_id = ? ORDER BY position ASC').all(ws)) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    kind: r.kind === 'weight' ? 'weight' : 'flat',
    countries: parseJson<string[]>(r.countries, []),
    priceCents: Number(r.price_cents),
    minWeightG: r.min_weight_g == null ? null : Number(r.min_weight_g),
    maxWeightG: r.max_weight_g == null ? null : Number(r.max_weight_g),
    freeOverCents: r.free_over_cents == null ? null : Number(r.free_over_cents),
  }));
}

export async function replaceShippingRates(actor: ShopActor, raw: unknown): Promise<ShippingRate[]> {
  const parsed = shippingRateInputSchema.array().max(50).safeParse(raw);
  if (!parsed.success) throw new ShopError('invalid_input');
  await ensureStore(actor.ws);
  const db = getDb();
  await db.prepare('DELETE FROM shop_shipping_rates WHERE workspace_id = ?').run(actor.ws);
  for (const [i, r] of parsed.data.entries()) {
    if (r.kind === 'weight' && r.minWeightG != null && r.maxWeightG != null && r.minWeightG > r.maxWeightG) throw new ShopError('invalid_weight_range');
    await db
      .prepare(
        'INSERT INTO shop_shipping_rates (id, workspace_id, name, kind, countries, price_cents, min_weight_g, max_weight_g, free_over_cents, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        r.id && /^ship_[A-Za-z0-9_-]{6,20}$/.test(r.id) ? r.id : newId('ship'),
        actor.ws,
        r.name,
        r.kind,
        JSON.stringify([...new Set(r.countries)]),
        r.priceCents,
        r.kind === 'weight' ? r.minWeightG : null,
        r.kind === 'weight' ? r.maxWeightG : null,
        r.freeOverCents,
        i,
      );
  }
  return listShippingRates(actor.ws);
}

export async function listTaxRates(ws: string): Promise<TaxRate[]> {
  const rows = (await getDb().prepare('SELECT * FROM shop_tax_rates WHERE workspace_id = ? ORDER BY country ASC, region ASC').all(ws)) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    country: String(r.country),
    region: String(r.region ?? ''),
    rateBps: Number(r.rate_bps),
    name: String(r.name ?? ''),
    appliesToShipping: Number(r.applies_to_shipping) === 1,
  }));
}

export async function replaceTaxRates(actor: ShopActor, raw: unknown): Promise<TaxRate[]> {
  const parsed = taxRateInputSchema.array().max(300).safeParse(raw);
  if (!parsed.success) throw new ShopError('invalid_input');
  await ensureStore(actor.ws);
  const seen = new Set<string>();
  for (const r of parsed.data) {
    const key = `${r.country}|${r.region.toLowerCase()}`;
    if (seen.has(key)) throw new ShopError('duplicate_tax_rate');
    seen.add(key);
  }
  const db = getDb();
  await db.prepare('DELETE FROM shop_tax_rates WHERE workspace_id = ?').run(actor.ws);
  for (const r of parsed.data) {
    await db
      .prepare('INSERT INTO shop_tax_rates (id, workspace_id, country, region, rate_bps, name, applies_to_shipping) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(newId('tax'), actor.ws, r.country, r.region, r.rateBps, r.name, r.appliesToShipping ? 1 : 0);
  }
  return listTaxRates(actor.ws);
}

// ---------- Descuentos ----------

export interface DiscountDto extends DiscountRule {
  id: string;
  createdAt: string;
}

function discountDto(r: Record<string, unknown>): DiscountDto {
  return {
    id: String(r.id),
    code: String(r.code),
    kind: (['percent', 'fixed', 'free_shipping'].includes(String(r.kind)) ? r.kind : 'percent') as DiscountDto['kind'],
    value: Number(r.value),
    minOrderCents: Number(r.min_order_cents),
    usageLimit: r.usage_limit == null ? null : Number(r.usage_limit),
    usedCount: Number(r.used_count),
    startsAt: (r.starts_at as string | null) ?? null,
    endsAt: (r.ends_at as string | null) ?? null,
    active: Number(r.active) === 1,
    createdAt: String(r.created_at),
  };
}

export async function listDiscounts(ws: string, opts: { q?: string } = {}): Promise<DiscountDto[]> {
  const rows = (await getDb()
    .prepare(`SELECT * FROM shop_discounts WHERE workspace_id = ?${opts.q?.trim() ? " AND code LIKE ? ESCAPE '\\'" : ''} ORDER BY created_at DESC`)
    .all(...(opts.q?.trim() ? [ws, likeEsc(opts.q.trim().toUpperCase())] : [ws]))) as Array<Record<string, unknown>>;
  return rows.map(discountDto);
}

export async function getDiscount(ws: string, id: string): Promise<DiscountDto | null> {
  const r = (await getDb().prepare('SELECT * FROM shop_discounts WHERE id = ? AND workspace_id = ?').get(id, ws)) as Record<string, unknown> | undefined;
  return r ? discountDto(r) : null;
}

export async function findDiscountByCode(ws: string, code: string): Promise<DiscountDto | null> {
  const clean = code.trim().toUpperCase();
  if (!clean || clean.length > 40) return null;
  const r = (await getDb().prepare('SELECT * FROM shop_discounts WHERE workspace_id = ? AND code = ?').get(ws, clean)) as Record<string, unknown> | undefined;
  return r ? discountDto(r) : null;
}

function cleanDiscount(input: DiscountInput): DiscountInput {
  if (input.kind === 'percent' && (input.value < 1 || input.value > 10_000)) throw new ShopError('invalid_value');
  if (input.kind === 'fixed' && input.value < 1) throw new ShopError('invalid_value');
  const norm = (d: string | null) => {
    if (!d) return null;
    const t = Date.parse(d);
    if (Number.isNaN(t)) throw new ShopError('invalid_date');
    return nowDb(new Date(t));
  };
  const startsAt = norm(input.startsAt);
  const endsAt = norm(input.endsAt);
  if (startsAt && endsAt && endsAt < startsAt) throw new ShopError('invalid_date');
  return { ...input, code: input.code.toUpperCase(), value: input.kind === 'free_shipping' ? 0 : input.value, startsAt, endsAt };
}

export async function createDiscount(actor: ShopActor, raw: unknown): Promise<DiscountDto> {
  const parsed = discountInputSchema.safeParse(raw);
  if (!parsed.success) throw new ShopError('invalid_input');
  const d = cleanDiscount(parsed.data);
  await ensureStore(actor.ws);
  if (await findDiscountByCode(actor.ws, d.code)) throw new ShopError('code_taken', 409);
  const id = newId('disc');
  const ts = nowDb();
  await getDb()
    .prepare(
      `INSERT INTO shop_discounts (id, workspace_id, code, kind, value, min_order_cents, usage_limit, used_count, starts_at, ends_at, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
    )
    .run(id, actor.ws, d.code, d.kind, d.value, d.minOrderCents, d.usageLimit, d.startsAt, d.endsAt, d.active ? 1 : 0, ts, ts);
  return (await getDiscount(actor.ws, id))!;
}

export async function updateDiscount(actor: ShopActor, id: string, raw: unknown): Promise<DiscountDto> {
  const cur = await getDiscount(actor.ws, id);
  if (!cur) throw new ShopError('not_found', 404);
  const merged = { ...cur, ...(raw && typeof raw === 'object' ? raw : {}) };
  const parsed = discountInputSchema.safeParse(merged);
  if (!parsed.success) throw new ShopError('invalid_input');
  const d = cleanDiscount(parsed.data);
  if (d.code !== cur.code) {
    const other = await findDiscountByCode(actor.ws, d.code);
    if (other && other.id !== id) throw new ShopError('code_taken', 409);
  }
  await getDb()
    .prepare(
      `UPDATE shop_discounts SET code = ?, kind = ?, value = ?, min_order_cents = ?, usage_limit = ?, starts_at = ?, ends_at = ?, active = ?, updated_at = ?
       WHERE id = ? AND workspace_id = ?`,
    )
    .run(d.code, d.kind, d.value, d.minOrderCents, d.usageLimit, d.startsAt, d.endsAt, d.active ? 1 : 0, nowDb(), id, actor.ws);
  return (await getDiscount(actor.ws, id))!;
}

export async function deleteDiscount(actor: ShopActor, id: string): Promise<boolean> {
  const res = await getDb().prepare('DELETE FROM shop_discounts WHERE id = ? AND workspace_id = ?').run(id, actor.ws);
  return res.changes > 0;
}

/** Suma un uso con compare-and-set contra el tope. false = ya no quedan usos. */
export async function claimDiscountUse(id: string): Promise<boolean> {
  const res = await getDb()
    .prepare('UPDATE shop_discounts SET used_count = used_count + 1 WHERE id = ? AND active = 1 AND (usage_limit IS NULL OR used_count < usage_limit)')
    .run(id);
  return res.changes > 0;
}

export async function releaseDiscountUse(id: string): Promise<void> {
  await getDb().prepare('UPDATE shop_discounts SET used_count = MAX(used_count - 1, 0) WHERE id = ?').run(id);
}

// ---------- Clientes ----------

export interface CustomerDto {
  id: string;
  email: string;
  name: string;
  phone: string;
  ordersCount: number;
  totalSpentCents: number;
  crmContactId: string | null;
  createdAt: string;
  updatedAt: string;
}

function customerDto(r: Record<string, unknown>): CustomerDto {
  return {
    id: String(r.id),
    email: String(r.email),
    name: String(r.name ?? ''),
    phone: String(r.phone ?? ''),
    ordersCount: Number(r.orders_count ?? 0),
    totalSpentCents: Number(r.total_spent_cents ?? 0),
    crmContactId: (r.crm_contact_id as string | null) ?? null,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

export async function listCustomers(ws: string, opts: { q?: string; limit?: number } = {}): Promise<CustomerDto[]> {
  const q = opts.q?.trim();
  const rows = (await getDb()
    .prepare(
      `SELECT * FROM shop_customers WHERE workspace_id = ?${q ? " AND (email LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\')" : ''} ORDER BY updated_at DESC LIMIT ?`,
    )
    .all(...(q ? [ws, likeEsc(q), likeEsc(q)] : [ws]), Math.min(500, opts.limit ?? 200))) as Array<Record<string, unknown>>;
  return rows.map(customerDto);
}

export async function getCustomer(ws: string, id: string): Promise<CustomerDto | null> {
  const r = (await getDb().prepare('SELECT * FROM shop_customers WHERE id = ? AND workspace_id = ?').get(id, ws)) as Record<string, unknown> | undefined;
  return r ? customerDto(r) : null;
}

/** Cliente del pedido (por email; cuentas opcionales: el checkout es como invitado). */
export async function upsertCustomer(ws: string, input: { email: string; name: string; phone: string }): Promise<string> {
  const db = getDb();
  const email = input.email.trim().toLowerCase();
  const ts = nowDb();
  await db
    .prepare(
      `INSERT INTO shop_customers (id, workspace_id, email, name, phone, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (workspace_id, email) DO UPDATE SET name = CASE WHEN excluded.name != '' THEN excluded.name ELSE shop_customers.name END,
         phone = CASE WHEN excluded.phone != '' THEN excluded.phone ELSE shop_customers.phone END, updated_at = excluded.updated_at`,
    )
    .run(newId('cus'), ws, email, input.name.slice(0, 120), input.phone.slice(0, 40), ts, ts);
  const row = (await db.prepare('SELECT id FROM shop_customers WHERE workspace_id = ? AND email = ?').get(ws, email)) as { id: string };
  return row.id;
}

// ---------- Búsqueda (⌘K) ----------

export interface ShopSearchHit {
  kind: 'product' | 'order' | 'collection' | 'discount' | 'customer';
  id: string;
  label: string;
  meta: string;
}

export async function searchShop(ws: string, q: string): Promise<ShopSearchHit[]> {
  const term = q.trim();
  if (!term) return [];
  const db = getDb();
  const l = likeEsc(term);
  const num = /^#?(\d{1,9})$/.exec(term)?.[1];
  const [products, orders, collections, discounts, customers] = await Promise.all([
    db
      .prepare("SELECT id, title, status FROM shop_products WHERE workspace_id = ? AND title LIKE ? ESCAPE '\\' ORDER BY updated_at DESC LIMIT 6")
      .all(ws, l) as Promise<Array<{ id: string; title: string; status: string }>>,
    db
      .prepare(
        `SELECT id, number, email, status FROM shop_orders WHERE workspace_id = ? AND (${num ? 'number = ? OR ' : ''}email LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\') ORDER BY created_at DESC LIMIT 6`,
      )
      .all(...(num ? [ws, Number(num), l, l] : [ws, l, l])) as Promise<Array<{ id: string; number: number; email: string; status: string }>>,
    db
      .prepare("SELECT id, title FROM shop_collections WHERE workspace_id = ? AND title LIKE ? ESCAPE '\\' ORDER BY updated_at DESC LIMIT 4")
      .all(ws, l) as Promise<Array<{ id: string; title: string }>>,
    db
      .prepare("SELECT id, code FROM shop_discounts WHERE workspace_id = ? AND code LIKE ? ESCAPE '\\' ORDER BY created_at DESC LIMIT 4")
      .all(ws, likeEsc(term.toUpperCase())) as Promise<Array<{ id: string; code: string }>>,
    db
      .prepare("SELECT id, email, name FROM shop_customers WHERE workspace_id = ? AND (email LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\') ORDER BY updated_at DESC LIMIT 4")
      .all(ws, l, l) as Promise<Array<{ id: string; email: string; name: string }>>,
  ]);
  return [
    ...products.map((p) => ({ kind: 'product' as const, id: p.id, label: p.title, meta: p.status })),
    ...orders.map((o) => ({ kind: 'order' as const, id: o.id, label: `#${o.number}`, meta: `${o.email} · ${o.status}` })),
    ...collections.map((c) => ({ kind: 'collection' as const, id: c.id, label: c.title, meta: '' })),
    ...discounts.map((d) => ({ kind: 'discount' as const, id: d.id, label: d.code, meta: '' })),
    ...customers.map((c) => ({ kind: 'customer' as const, id: c.id, label: c.name || c.email, meta: c.name ? c.email : '' })),
  ];
}

/** Para el texto plano de una descripción (meta, CSV). */
export { plainText };
