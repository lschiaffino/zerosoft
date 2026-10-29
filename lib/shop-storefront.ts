/**
 * Shop: datos de la tienda pública (solo lo publicado y sin nada interno:
 * ni costos, ni stock exacto, ni clientes). Server-only.
 */
import { getDb } from './db';
import {
  collectionProductIds,
  descriptionHtml,
  enabledMethods,
  getStoreByHandle,
  storeDto,
  type CollectionRow,
  type ProductRow,
  type StoreDto,
  type StoreRow,
} from './shop';
import { parseJson, plainText, type ProductOption } from './shop-schema';

export interface PublicStore {
  row: StoreRow;
  dto: StoreDto;
  methods: Array<'stripe' | 'mercadopago' | 'manual'>;
  manualLabel: string;
}

/** Tienda publicada por handle (null si no existe o no está publicada). */
export async function publishedStore(handle: string): Promise<PublicStore | null> {
  const row = await getStoreByHandle(handle.toLowerCase());
  if (!row || row.published !== 1) return null;
  const payments = parseJson<{ manual?: { label?: string } }>(row.payments, {});
  return { row, dto: storeDto(row), methods: enabledMethods(row), manualLabel: payments.manual?.label ?? '' };
}

export interface ProductCard {
  id: string;
  handle: string;
  title: string;
  image: string | null;
  priceCents: number;
  maxPriceCents: number;
  compareAtCents: number | null;
  available: boolean;
}

function cardsFrom(rows: Array<Record<string, unknown>>): ProductCard[] {
  return rows.map((r) => ({
    id: String(r.id),
    handle: String(r.handle),
    title: String(r.title),
    image: parseJson<string[]>(r.images, [])[0] ?? null,
    priceCents: Number(r.min_price ?? 0),
    maxPriceCents: Number(r.max_price ?? 0),
    compareAtCents: r.compare_at == null ? null : Number(r.compare_at),
    available: Number(r.available ?? 0) > 0,
  }));
}

const CARD_SQL = `SELECT p.id, p.handle, p.title, p.images, p.created_at,
  (SELECT MIN(price_cents) FROM shop_variants v WHERE v.product_id = p.id) AS min_price,
  (SELECT MAX(price_cents) FROM shop_variants v WHERE v.product_id = p.id) AS max_price,
  (SELECT compare_at_cents FROM shop_variants v WHERE v.product_id = p.id ORDER BY price_cents ASC LIMIT 1) AS compare_at,
  (SELECT COUNT(*) FROM shop_variants v WHERE v.product_id = p.id AND (v.track_inventory = 0 OR EXISTS (
     SELECT 1 FROM shop_inventory i WHERE i.variant_id = v.id AND i.available - i.reserved > 0))) AS available
  FROM shop_products p`;

export async function storefrontProducts(ws: string, opts: { ids?: string[]; q?: string; limit?: number } = {}): Promise<ProductCard[]> {
  const where = ["p.workspace_id = ?", "p.status = 'active'"];
  const args: Array<string | number> = [ws];
  if (opts.ids) {
    if (!opts.ids.length) return [];
    where.push(`p.id IN (${opts.ids.map(() => '?').join(',')})`);
    args.push(...opts.ids);
  }
  if (opts.q?.trim()) {
    const l = `%${opts.q.trim().replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    where.push("(p.title LIKE ? ESCAPE '\\' OR p.tags LIKE ? ESCAPE '\\' OR p.product_type LIKE ? ESCAPE '\\' OR p.vendor LIKE ? ESCAPE '\\')");
    args.push(l, l, l, l);
  }
  const rows = (await getDb()
    .prepare(`${CARD_SQL} WHERE ${where.join(' AND ')} ORDER BY p.created_at DESC LIMIT ?`)
    .all(...args, Math.min(500, opts.limit ?? 200))) as Array<Record<string, unknown>>;
  const cards = cardsFrom(rows);
  // Colección manual: el orden de la colección.
  if (opts.ids) return opts.ids.map((id) => cards.find((c) => c.id === id)).filter((c): c is ProductCard => Boolean(c));
  return cards;
}

export interface PublicVariant {
  id: string;
  title: string;
  options: string[];
  priceCents: number;
  compareAtCents: number | null;
  sku: string;
  available: boolean;
  /** Pocas unidades (para "quedan pocas"): null si hay de sobra o no se controla. */
  low: boolean;
  imageUrl: string | null;
}

export interface PublicProduct {
  id: string;
  handle: string;
  title: string;
  descriptionHtml: string;
  descriptionText: string;
  vendor: string;
  productType: string;
  options: ProductOption[];
  images: string[];
  seoTitle: string;
  seoDescription: string;
  variants: PublicVariant[];
}

export async function storefrontProduct(store: StoreRow, handle: string): Promise<PublicProduct | null> {
  const db = getDb();
  const p = (await db.prepare("SELECT * FROM shop_products WHERE workspace_id = ? AND handle = ? AND status = 'active'").get(store.workspace_id, handle)) as ProductRow | undefined;
  if (!p) return null;
  const variants = (await db
    .prepare(
      `SELECT v.*, (SELECT COALESCE(SUM(MAX(i.available - i.reserved, 0)), 0) FROM shop_inventory i WHERE i.variant_id = v.id) AS free
       FROM shop_variants v WHERE v.product_id = ? ORDER BY v.position ASC`,
    )
    .all(p.id)) as Array<Record<string, unknown>>;
  return {
    id: p.id,
    handle: p.handle,
    title: p.title,
    descriptionHtml: descriptionHtml(p.description),
    descriptionText: plainText(p.description, 500),
    vendor: p.vendor,
    productType: p.product_type,
    options: parseJson<ProductOption[]>(p.options, []),
    images: parseJson<string[]>(p.images, []),
    seoTitle: p.seo_title,
    seoDescription: p.seo_description,
    variants: variants.map((v) => {
      const track = Number(v.track_inventory) === 1;
      const free = Number(v.free ?? 0);
      return {
        id: String(v.id),
        title: String(v.title),
        options: parseJson<string[]>(v.options, []),
        priceCents: Number(v.price_cents),
        compareAtCents: v.compare_at_cents == null ? null : Number(v.compare_at_cents),
        sku: String(v.sku ?? ''),
        available: !track || free > 0,
        low: track && free > 0 && free <= store.low_stock,
        imageUrl: (v.image_url as string | null) ?? null,
      };
    }),
  };
}

export interface PublicCollection {
  id: string;
  handle: string;
  title: string;
  descriptionHtml: string;
  imageUrl: string | null;
  featured: boolean;
}

function publicCollection(c: CollectionRow): PublicCollection {
  return { id: c.id, handle: c.handle, title: c.title, descriptionHtml: descriptionHtml(c.description), imageUrl: c.image_url, featured: c.featured === 1 };
}

export async function storefrontCollections(ws: string): Promise<PublicCollection[]> {
  const rows = (await getDb().prepare('SELECT * FROM shop_collections WHERE workspace_id = ? AND published = 1 ORDER BY featured DESC, title ASC').all(ws)) as CollectionRow[];
  return rows.map(publicCollection);
}

export async function storefrontCollection(ws: string, handle: string): Promise<{ collection: PublicCollection; products: ProductCard[] } | null> {
  const c = (await getDb().prepare('SELECT * FROM shop_collections WHERE workspace_id = ? AND handle = ? AND published = 1').get(ws, handle)) as CollectionRow | undefined;
  if (!c) return null;
  const ids = await collectionProductIds(ws, c, true);
  return { collection: publicCollection(c), products: await storefrontProducts(ws, { ids }) };
}

/** Productos de las colecciones destacadas (portada), o los últimos si no hay. */
export async function storefrontHome(ws: string): Promise<{ featured: Array<{ collection: PublicCollection; products: ProductCard[] }>; latest: ProductCard[] }> {
  const rows = (await getDb().prepare('SELECT * FROM shop_collections WHERE workspace_id = ? AND published = 1 AND featured = 1 ORDER BY title ASC LIMIT 3').all(ws)) as CollectionRow[];
  const featured = await Promise.all(
    rows.map(async (c) => ({ collection: publicCollection(c), products: (await storefrontProducts(ws, { ids: await collectionProductIds(ws, c, true) })).slice(0, 8) })),
  );
  return { featured: featured.filter((f) => f.products.length), latest: await storefrontProducts(ws, { limit: 24 }) };
}

/** sitemap.xml de la tienda: portada, colecciones publicadas y productos activos. */
export async function storefrontSitemap(store: StoreRow, base: string): Promise<string> {
  const db = getDb();
  const [products, collections] = await Promise.all([
    db.prepare("SELECT handle, updated_at FROM shop_products WHERE workspace_id = ? AND status = 'active' ORDER BY updated_at DESC LIMIT 5000").all(store.workspace_id) as Promise<
      Array<{ handle: string; updated_at: string }>
    >,
    db.prepare('SELECT handle, updated_at FROM shop_collections WHERE workspace_id = ? AND published = 1 LIMIT 1000').all(store.workspace_id) as Promise<
      Array<{ handle: string; updated_at: string }>
    >,
  ]);
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const root = `${base}/store/${store.handle}`;
  const url = (loc: string, mod: string) => `<url><loc>${esc(loc)}</loc><lastmod>${esc(mod.slice(0, 10))}</lastmod></url>`;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    url(root, store.updated_at),
    ...collections.map((c) => url(`${root}/collections/${encodeURIComponent(c.handle)}`, c.updated_at)),
    ...products.map((p) => url(`${root}/products/${encodeURIComponent(p.handle)}`, p.updated_at)),
    '</urlset>',
  ].join('\n');
}
