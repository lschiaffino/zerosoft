/**
 * Shop: CSV de productos.
 *
 * - Shopify: el CSV de productos de Shopify (Handle, Title, Body (HTML),
 *   Option1 Name/Value…, Variant SKU, Variant Price, Variant Inventory Qty,
 *   Image Src…). Varias filas por Handle: la primera trae el producto y las
 *   siguientes, variantes o imágenes extra. Exportamos en el mismo formato,
 *   así se puede volver a subir a Shopify.
 * - Tiendanube: la exportación de productos que documenta su centro de ayuda
 *   (separada por ";", encabezados en español: Identificador de URL, Nombre,
 *   Nombre/Valor de propiedad 1-3, Precio, Precio promocional, Peso (kg),
 *   Stock, SKU…). "Precio promocional" es el precio de venta y "Precio" pasa
 *   a precio de comparación.
 *
 * El parseo es puro (lo prueban los tests); importar escribe con las mismas
 * funciones que la UI (lib/shop.ts).
 */
import { centsToInput, parseMoney } from './shop-money';
import { normalizeOptions, plainText, slugify, type ProductInput, type ShopActor } from './shop-schema';

/** CSV con el separador dado (comillas, separadores y saltos dentro de comillas). */
export function parseDelimited(text: string, sep: ',' | ';' | '\t' = ','): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

/** Separador de la primera línea (el que más aparece fuera de comillas). */
export function detectSeparator(text: string): ',' | ';' | '\t' {
  const first = text.replace(/^﻿/, '').split(/\r?\n/)[0] ?? '';
  const count = (c: string) => first.split(c).length - 1;
  const best = ([',', ';', '\t'] as const).map((c) => [c, count(c)] as const).sort((a, b) => b[1] - a[1])[0];
  return best[1] > 0 ? best[0] : ',';
}

export type CsvFormat = 'shopify' | 'tiendanube';

const norm = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

export function detectFormat(header: string[]): CsvFormat | null {
  const h = header.map(norm);
  if (h.includes('handle') && (h.includes('title') || h.includes('variant price'))) return 'shopify';
  if (h.includes('identificador de url') || (h.includes('nombre') && h.includes('precio'))) return 'tiendanube';
  return null;
}

export interface ParsedVariant {
  options: string[];
  sku: string;
  barcode: string;
  priceCents: number;
  compareAtCents: number | null;
  weightGrams: number;
  trackInventory: boolean;
  stock: number | null;
  imageSrc: string | null;
}

export interface ParsedProduct {
  handle: string;
  title: string;
  description: string;
  vendor: string;
  productType: string;
  tags: string[];
  status: 'draft' | 'active' | 'archived';
  optionNames: string[];
  variants: ParsedVariant[];
  images: string[];
  seoTitle: string;
  seoDescription: string;
  requiresShipping: boolean;
}

export interface ParseResult {
  format: CsvFormat;
  products: ParsedProduct[];
  /** Filas que no se pudieron leer (número de fila del CSV, 1 = encabezado). */
  errors: Array<{ row: number; error: string }>;
}

function col(header: string[], ...names: string[]): number {
  const h = header.map(norm);
  for (const n of names) {
    const i = h.indexOf(norm(n));
    if (i >= 0) return i;
  }
  return -1;
}

const cell = (row: string[], i: number) => (i >= 0 ? (row[i] ?? '').trim() : '');

function truthy(v: string, dflt: boolean): boolean {
  const s = norm(v);
  if (!s) return dflt;
  return ['true', 'yes', 'si', 'sim', '1', 'active', 'activo'].includes(s);
}

function grams(v: string, unitKg: boolean): number {
  const n = Number(v.replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(unitKg ? n * 1000 : n);
}

function parseShopify(rows: string[][]): ParseResult {
  const [header, ...body] = rows;
  const c = {
    handle: col(header, 'Handle'),
    title: col(header, 'Title'),
    body: col(header, 'Body (HTML)', 'Body HTML', 'Description'),
    vendor: col(header, 'Vendor'),
    type: col(header, 'Type', 'Product Type'),
    tags: col(header, 'Tags'),
    published: col(header, 'Published'),
    status: col(header, 'Status'),
    o1n: col(header, 'Option1 Name'),
    o1v: col(header, 'Option1 Value'),
    o2n: col(header, 'Option2 Name'),
    o2v: col(header, 'Option2 Value'),
    o3n: col(header, 'Option3 Name'),
    o3v: col(header, 'Option3 Value'),
    sku: col(header, 'Variant SKU'),
    grams: col(header, 'Variant Grams'),
    tracker: col(header, 'Variant Inventory Tracker'),
    qty: col(header, 'Variant Inventory Qty', 'Inventory Qty'),
    price: col(header, 'Variant Price', 'Price'),
    compare: col(header, 'Variant Compare At Price', 'Compare At Price'),
    shipping: col(header, 'Variant Requires Shipping'),
    barcode: col(header, 'Variant Barcode'),
    image: col(header, 'Image Src'),
    variantImage: col(header, 'Variant Image'),
    seoTitle: col(header, 'SEO Title'),
    seoDesc: col(header, 'SEO Description'),
  };
  const out = new Map<string, ParsedProduct>();
  const errors: ParseResult['errors'] = [];
  body.forEach((row, idx) => {
    const line = idx + 2;
    const handle = slugify(cell(row, c.handle));
    if (!cell(row, c.handle)) {
      errors.push({ row: line, error: 'missing_handle' });
      return;
    }
    let p = out.get(handle);
    if (!p) {
      const title = cell(row, c.title);
      if (!title) {
        errors.push({ row: line, error: 'missing_title' });
        return;
      }
      const status = norm(cell(row, c.status));
      p = {
        handle,
        title: title.slice(0, 200),
        description: cell(row, c.body),
        vendor: cell(row, c.vendor).slice(0, 120),
        productType: cell(row, c.type).slice(0, 120),
        tags: cell(row, c.tags)
          .split(',')
          .map((t) => t.trim().slice(0, 60))
          .filter(Boolean)
          .slice(0, 50),
        status: status === 'archived' ? 'archived' : status === 'draft' ? 'draft' : status === 'active' ? 'active' : truthy(cell(row, c.published), true) ? 'active' : 'draft',
        optionNames: [cell(row, c.o1n), cell(row, c.o2n), cell(row, c.o3n)].filter((n) => n && norm(n) !== 'title'),
        variants: [],
        images: [],
        seoTitle: cell(row, c.seoTitle).slice(0, 120),
        seoDescription: cell(row, c.seoDesc).slice(0, 320),
        requiresShipping: true,
      };
      out.set(handle, p);
    }
    const img = cell(row, c.image);
    if (img && !p.images.includes(img)) p.images.push(img);
    const priceRaw = cell(row, c.price);
    if (!priceRaw) return; // fila solo de imagen
    const price = parseMoney(priceRaw);
    if (price == null) {
      errors.push({ row: line, error: 'invalid_price' });
      return;
    }
    const values = [cell(row, c.o1v), cell(row, c.o2v), cell(row, c.o3v)].slice(0, p.optionNames.length);
    const compare = parseMoney(cell(row, c.compare));
    const qtyRaw = cell(row, c.qty);
    const tracked = c.tracker >= 0 ? cell(row, c.tracker) !== '' : qtyRaw !== '';
    if (p.variants.length === 0 && c.shipping >= 0) p.requiresShipping = truthy(cell(row, c.shipping), true);
    p.variants.push({
      options: values,
      sku: cell(row, c.sku).slice(0, 80),
      barcode: cell(row, c.barcode).replace(/^'/, '').slice(0, 80),
      priceCents: price,
      compareAtCents: compare != null && compare > price ? compare : null,
      weightGrams: grams(cell(row, c.grams), false),
      trackInventory: tracked,
      stock: qtyRaw && /^-?\d+$/.test(qtyRaw) ? Math.max(0, Number(qtyRaw)) : null,
      imageSrc: cell(row, c.variantImage) || null,
    });
  });
  return { format: 'shopify', products: [...out.values()], errors };
}

function parseTiendanube(rows: string[][]): ParseResult {
  const [header, ...body] = rows;
  const c = {
    handle: col(header, 'Identificador de URL', 'URL'),
    name: col(header, 'Nombre'),
    categories: col(header, 'Categorías', 'Categorias'),
    p1n: col(header, 'Nombre de propiedad 1'),
    p1v: col(header, 'Valor de propiedad 1'),
    p2n: col(header, 'Nombre de propiedad 2'),
    p2v: col(header, 'Valor de propiedad 2'),
    p3n: col(header, 'Nombre de propiedad 3'),
    p3v: col(header, 'Valor de propiedad 3'),
    price: col(header, 'Precio'),
    promo: col(header, 'Precio promocional'),
    weight: col(header, 'Peso (kg)', 'Peso'),
    stock: col(header, 'Stock'),
    sku: col(header, 'SKU'),
    barcode: col(header, 'Código de barras', 'Codigo de barras'),
    show: col(header, 'Mostrar en tienda'),
    description: col(header, 'Descripción', 'Descripcion'),
    tags: col(header, 'Tags'),
    seoTitle: col(header, 'Título para SEO', 'Titulo para SEO'),
    seoDesc: col(header, 'Descripción para SEO', 'Descripcion para SEO'),
    brand: col(header, 'Marca'),
    physical: col(header, 'Producto Físico', 'Producto Fisico'),
  };
  const out = new Map<string, ParsedProduct>();
  const errors: ParseResult['errors'] = [];
  body.forEach((row, idx) => {
    const line = idx + 2;
    const rawHandle = cell(row, c.handle) || cell(row, c.name);
    if (!rawHandle) {
      errors.push({ row: line, error: 'missing_handle' });
      return;
    }
    const handle = slugify(rawHandle);
    let p = out.get(handle);
    if (!p) {
      const title = cell(row, c.name);
      if (!title) {
        errors.push({ row: line, error: 'missing_title' });
        return;
      }
      const categories = cell(row, c.categories)
        .split(/[,>]/)
        .map((t) => t.trim())
        .filter(Boolean);
      p = {
        handle,
        title: title.slice(0, 200),
        description: cell(row, c.description),
        vendor: cell(row, c.brand).slice(0, 120),
        productType: (categories[categories.length - 1] ?? '').slice(0, 120),
        tags: [...cell(row, c.tags).split(','), ...categories]
          .map((t) => t.trim().slice(0, 60))
          .filter(Boolean)
          .filter((t, i, a) => a.indexOf(t) === i)
          .slice(0, 50),
        status: truthy(cell(row, c.show), true) ? 'active' : 'draft',
        optionNames: [cell(row, c.p1n), cell(row, c.p2n), cell(row, c.p3n)].filter(Boolean),
        variants: [],
        images: [],
        seoTitle: cell(row, c.seoTitle).slice(0, 120),
        seoDescription: cell(row, c.seoDesc).slice(0, 320),
        requiresShipping: truthy(cell(row, c.physical), true),
      };
      out.set(handle, p);
    }
    const regular = parseMoney(cell(row, c.price));
    const promo = parseMoney(cell(row, c.promo));
    if (regular == null && promo == null) {
      errors.push({ row: line, error: 'invalid_price' });
      return;
    }
    const price = promo != null && promo > 0 ? promo : (regular ?? 0);
    const stockRaw = cell(row, c.stock);
    p.variants.push({
      options: [cell(row, c.p1v), cell(row, c.p2v), cell(row, c.p3v)].slice(0, p.optionNames.length),
      sku: cell(row, c.sku).slice(0, 80),
      barcode: cell(row, c.barcode).slice(0, 80),
      priceCents: price,
      compareAtCents: regular != null && regular > price ? regular : null,
      weightGrams: grams(cell(row, c.weight), true),
      // Tiendanube: stock vacío = infinito (no se controla).
      trackInventory: stockRaw !== '',
      stock: /^\d+$/.test(stockRaw) ? Number(stockRaw) : null,
      imageSrc: null,
    });
  });
  return { format: 'tiendanube', products: [...out.values()], errors };
}

export function parseProductCsv(text: string): ParseResult | null {
  const rows = parseDelimited(text, detectSeparator(text));
  if (rows.length < 2) return null;
  const format = detectFormat(rows[0]);
  if (format === 'shopify') return parseShopify(rows);
  if (format === 'tiendanube') return parseTiendanube(rows);
  return null;
}

/** Producto leído → entrada de createProduct (opciones con los valores que aparecen, en orden). */
export function toProductInput(p: ParsedProduct, images: string[]): ProductInput & { stocks: Array<number | null> } {
  const options = normalizeOptions(
    p.optionNames.map((name, i) => ({ name, values: p.variants.map((v) => v.options[i] ?? '').filter(Boolean) })),
  );
  const variants = (options.length ? p.variants : p.variants.slice(0, 1)).map((v) => ({
    options: options.length ? v.options.slice(0, options.length) : [],
    sku: v.sku,
    barcode: v.barcode,
    priceCents: v.priceCents,
    compareAtCents: v.compareAtCents,
    weightGrams: v.weightGrams,
    trackInventory: v.trackInventory,
  }));
  return {
    title: p.title,
    handle: p.handle,
    description: p.description,
    vendor: p.vendor,
    productType: p.productType,
    tags: p.tags,
    status: p.status,
    options,
    images,
    seoTitle: p.seoTitle,
    seoDescription: p.seoDescription,
    requiresShipping: p.requiresShipping,
    variants,
    stocks: (options.length ? p.variants : p.variants.slice(0, 1)).map((v) => v.stock),
  };
}

// ---------- Export (formato Shopify) ----------

export const SHOPIFY_EXPORT_HEADER = [
  'Handle',
  'Title',
  'Body (HTML)',
  'Vendor',
  'Type',
  'Tags',
  'Published',
  'Option1 Name',
  'Option1 Value',
  'Option2 Name',
  'Option2 Value',
  'Option3 Name',
  'Option3 Value',
  'Variant SKU',
  'Variant Grams',
  'Variant Inventory Tracker',
  'Variant Inventory Qty',
  'Variant Inventory Policy',
  'Variant Fulfillment Service',
  'Variant Price',
  'Variant Compare At Price',
  'Variant Requires Shipping',
  'Variant Barcode',
  'Image Src',
  'Image Position',
  'SEO Title',
  'SEO Description',
  'Status',
];

/** Celda CSV (con comillas si hace falta; sin fórmulas: = + - @ al inicio van con apóstrofo). */
export function csvCell(v: unknown): string {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export interface ExportProduct {
  handle: string;
  title: string;
  description: string;
  vendor: string;
  productType: string;
  tags: string[];
  status: string;
  options: Array<{ name: string; values: string[] }>;
  images: string[];
  seoTitle: string;
  seoDescription: string;
  requiresShipping: boolean;
  variants: Array<{ options: string[]; sku: string; barcode: string; priceCents: number; compareAtCents: number | null; weightGrams: number; trackInventory: boolean; stock: number }>;
}

/** Descripción guardada (párrafos con HTML en línea) → Body (HTML). */
function bodyHtml(desc: string): string {
  return desc
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`)
    .join('');
}

export function exportShopifyCsv(products: ExportProduct[], absolute: (url: string) => string): string {
  const lines = [SHOPIFY_EXPORT_HEADER.join(',')];
  for (const p of products) {
    const rows = Math.max(p.variants.length, p.images.length, 1);
    for (let i = 0; i < rows; i++) {
      const v = p.variants[i];
      const first = i === 0;
      const optCells: string[] = [];
      for (let j = 0; j < 3; j++) {
        const o = p.options[j];
        if (!o) {
          optCells.push(first && j === 0 && v ? 'Title' : '', first && j === 0 && v ? 'Default Title' : '');
          continue;
        }
        optCells.push(first ? o.name : '', v ? (v.options[j] ?? '') : '');
      }
      const row = [
        p.handle,
        first ? p.title : '',
        first ? bodyHtml(p.description) : '',
        first ? p.vendor : '',
        first ? p.productType : '',
        first ? p.tags.join(', ') : '',
        first ? (p.status === 'active' ? 'TRUE' : 'FALSE') : '',
        ...optCells,
        v?.sku ?? '',
        v ? String(v.weightGrams) : '',
        v ? (v.trackInventory ? 'shopify' : '') : '',
        v ? String(v.stock) : '',
        v ? 'deny' : '',
        v ? 'manual' : '',
        v ? centsToInput(v.priceCents) : '',
        v && v.compareAtCents != null ? centsToInput(v.compareAtCents) : '',
        v ? (p.requiresShipping ? 'TRUE' : 'FALSE') : '',
        v?.barcode ?? '',
        p.images[i] ? absolute(p.images[i]) : '',
        p.images[i] ? String(i + 1) : '',
        first ? p.seoTitle : '',
        first ? p.seoDescription || plainText(p.description, 320) : '',
        first ? p.status : '',
      ];
      lines.push(row.map(csvCell).join(','));
    }
  }
  return `${lines.join('\n')}\n`;
}

// ---------- Importar ----------

export interface ImportSummary {
  format: CsvFormat;
  created: number;
  updated: number;
  skipped: number;
  errors: Array<{ row?: number; handle?: string; error: string }>;
  imagesFailed: number;
}

/**
 * Importa el CSV: crea los productos nuevos y, si `update`, reemplaza los que
 * ya existen con ese handle. Las imágenes por URL se bajan (safeFetch, solo
 * raster, con tope) y se guardan como las subidas; si una falla se cuenta y
 * el producto se crea igual. El stock va a la ubicación por defecto.
 */
export async function importProductsCsv(
  actor: ShopActor,
  text: string,
  opts: { update?: boolean; fetchImages?: boolean; maxProducts?: number } = {},
): Promise<ImportSummary> {
  const parsed = parseProductCsv(text);
  if (!parsed) {
    const { ShopError } = await import('./shop-schema');
    throw new ShopError('csv_format');
  }
  const shop = await import('./shop');
  const { getDb } = await import('./db');
  const summary: ImportSummary = { format: parsed.format, created: 0, updated: 0, skipped: 0, errors: [...parsed.errors], imagesFailed: 0 };
  const loc = await shop.defaultLocation(actor.ws);
  let imageBudget = 200;
  for (const p of parsed.products.slice(0, opts.maxProducts ?? 2000)) {
    try {
      if (!p.variants.length) {
        summary.errors.push({ handle: p.handle, error: 'no_variants' });
        continue;
      }
      const existing = (await getDb().prepare('SELECT id FROM shop_products WHERE workspace_id = ? AND handle = ?').get(actor.ws, p.handle)) as { id: string } | undefined;
      if (existing && !opts.update) {
        summary.skipped++;
        continue;
      }
      const images: string[] = [];
      if (opts.fetchImages !== false) {
        for (const src of p.images.slice(0, 10)) {
          if (imageBudget <= 0) break;
          imageBudget--;
          const url = await fetchImage(src);
          if (url) images.push(url);
          else summary.imagesFailed++;
        }
      }
      const input = toProductInput(p, images);
      const { stocks, ...productInput } = input;
      let productId: string;
      if (existing) {
        const current = await shop.getProduct(actor.ws, existing.id);
        // Variantes que ya existían (misma combinación): conservan id y stock.
        const variants = productInput.variants.map((v) => {
          const match = current?.variants.find((cv) => cv.options.join('|').toLowerCase() === v.options.join('|').toLowerCase());
          return match ? { ...v, id: match.id } : v;
        });
        const updated = await shop.updateProduct(actor, existing.id, { ...productInput, images: images.length ? images : (current?.images ?? []), variants });
        productId = updated.id;
        summary.updated++;
      } else {
        const created = await shop.createProduct(actor, productInput, { reason: 'import' });
        productId = created.id;
        summary.created++;
      }
      const product = await shop.getProduct(actor.ws, productId);
      for (const [i, v] of (product?.variants ?? []).entries()) {
        const target = stocks[i];
        if (target == null || !v.trackInventory) continue;
        await shop.adjustInventory(actor, { variantId: v.id, locationId: loc, set: Math.max(target, v.inventory.find((x) => x.locationId === loc)?.reserved ?? 0), reason: 'import' }, { skipRevalidate: true });
      }
    } catch (err) {
      summary.errors.push({ handle: p.handle, error: err instanceof Error ? err.message : 'error' });
    }
  }
  await shop.revalidateWs(actor.ws);
  return summary;
}

async function fetchImage(src: string): Promise<string | null> {
  try {
    if (!/^https:\/\//i.test(src)) return null;
    const { safeFetch } = await import('./safe-fetch');
    const res = await safeFetch(src, { method: 'GET' }, 10_000, { maxRedirects: 3 });
    if (!res.ok) return null;
    const shop = await import('./shop');
    if (Number(res.headers.get('content-length') ?? 0) > shop.MAX_IMAGE_BYTES) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > shop.MAX_IMAGE_BYTES) return null;
    return await shop.saveShopImage(buf);
  } catch {
    return null;
  }
}
