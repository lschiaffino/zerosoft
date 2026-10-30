/**
 * Shop: tipos, validación de entradas y utilidades puras (sin DB). Lo usan
 * las rutas, la UI y los tests.
 */
import { z } from 'zod';
import { SHOP_CURRENCIES } from './shop-money';

export class ShopError extends Error {
  constructor(
    public code: string,
    public status = 400,
    public detail?: Record<string, unknown>,
  ) {
    super(code);
  }
}

/** Quién actúa: workspace (owner), persona real y si es admin. */
export interface ShopActor {
  ws: string;
  person: string;
  admin: boolean;
}

export const ORDER_STATUSES = ['pending', 'paid', 'fulfilled', 'cancelled', 'refunded'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export const PRODUCT_STATUSES = ['draft', 'active', 'archived'] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];
export const PAYMENT_METHODS = ['stripe', 'mercadopago', 'manual'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const SHOP_THEMES = ['classic', 'bold', 'minimal'] as const;
export type ShopTheme = (typeof SHOP_THEMES)[number];
export const SHOP_FONTS = ['sans', 'serif', 'mono', 'rounded'] as const;
export type ShopFont = (typeof SHOP_FONTS)[number];
export const SHOP_LOCALES = ['en', 'es', 'pt'] as const;
export type ShopLocale = (typeof SHOP_LOCALES)[number];

export const HANDLE_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
export const STORE_HANDLE_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;
export const COUNTRY_RE = /^[A-Z]{2}$/;
export const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/** "Remera Azul Ñandú" → "remera-azul-nandu". */
export function slugify(input: string, max = 64): string {
  const s = input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
  return s || 'item';
}

/** Handles de tienda que chocan con rutas propias. */
export const RESERVED_STORE_HANDLES = new Set(['api', 'app', 'admin', 'new', 'store', 'shop', 'www', 'checkout', 'cart', 'uploads', 'sitemap', 'robots', 'favicon', 'static', 'assets', 'zerosoft', 'careers']);

export interface ProductOption {
  name: string;
  values: string[];
}

export interface StoreBrand {
  logoUrl: string | null;
  primary: string;
  accent: string;
  font: ShopFont;
  heroTitle: string;
  heroText: string;
  announcement: string;
}

export const DEFAULT_BRAND: StoreBrand = {
  logoUrl: null,
  primary: '#111111',
  accent: '#2f6bff',
  font: 'sans',
  heroTitle: '',
  heroText: '',
  announcement: '',
};

export interface StoreSettings {
  emailConfirmation: boolean;
  emailShipped: boolean;
  /** Crea o actualiza el contacto y deja la actividad en el CRM. */
  crmSync: boolean;
  /** Minutos que un pedido online espera el pago (después se libera el stock). */
  holdMinutes: number;
}

export const DEFAULT_SETTINGS: StoreSettings = { emailConfirmation: true, emailShipped: true, crmSync: true, holdMinutes: 60 };

export function parseJson<T>(raw: unknown, fallback: T): T {
  if (raw == null || raw === '') return fallback;
  if (typeof raw !== 'string') return raw as T;
  try {
    const v = JSON.parse(raw) as unknown;
    return (v ?? fallback) as T;
  } catch {
    return fallback;
  }
}

export function normalizeBrand(raw: unknown): StoreBrand {
  const b = (raw && typeof raw === 'object' ? raw : {}) as Partial<StoreBrand>;
  return {
    logoUrl: typeof b.logoUrl === 'string' && b.logoUrl ? b.logoUrl : null,
    primary: typeof b.primary === 'string' && HEX_RE.test(b.primary) ? b.primary : DEFAULT_BRAND.primary,
    accent: typeof b.accent === 'string' && HEX_RE.test(b.accent) ? b.accent : DEFAULT_BRAND.accent,
    font: (SHOP_FONTS as readonly string[]).includes(String(b.font)) ? (b.font as ShopFont) : 'sans',
    heroTitle: typeof b.heroTitle === 'string' ? b.heroTitle.slice(0, 120) : '',
    heroText: typeof b.heroText === 'string' ? b.heroText.slice(0, 400) : '',
    announcement: typeof b.announcement === 'string' ? b.announcement.slice(0, 160) : '',
  };
}

export function normalizeSettings(raw: unknown): StoreSettings {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Partial<StoreSettings>;
  const hold = Number(s.holdMinutes);
  return {
    emailConfirmation: s.emailConfirmation !== false,
    emailShipped: s.emailShipped !== false,
    crmSync: s.crmSync !== false,
    holdMinutes: Number.isFinite(hold) ? Math.min(7 * 24 * 60, Math.max(15, Math.round(hold))) : 60,
  };
}

/** Opciones limpias: hasta 3 (como Shopify), nombres únicos, valores únicos. */
export function normalizeOptions(raw: unknown): ProductOption[] {
  if (!Array.isArray(raw)) return [];
  const out: ProductOption[] = [];
  for (const o of raw.slice(0, 3)) {
    const name = String((o as ProductOption)?.name ?? '').trim().slice(0, 40);
    if (!name || out.some((x) => x.name.toLowerCase() === name.toLowerCase())) continue;
    const values: string[] = [];
    for (const v of Array.isArray((o as ProductOption).values) ? (o as ProductOption).values : []) {
      const s = String(v ?? '').trim().slice(0, 60);
      if (s && !values.some((x) => x.toLowerCase() === s.toLowerCase())) values.push(s);
    }
    if (values.length) out.push({ name, values: values.slice(0, 100) });
  }
  return out;
}

/** Todas las combinaciones de las opciones ("S / Rojo", …). */
export function optionCombos(options: ProductOption[]): string[][] {
  let combos: string[][] = [[]];
  for (const o of options) combos = combos.flatMap((c) => o.values.map((v) => [...c, v]));
  return options.length ? combos.slice(0, 250) : [[]];
}

export function variantTitle(values: string[]): string {
  return values.filter(Boolean).join(' / ');
}

const money = z.union([z.number().int().min(0).max(1_000_000_000), z.null()]);

export const variantInputSchema = z.object({
  id: z.string().max(80).optional(),
  options: z.array(z.string().max(60)).max(3).default([]),
  sku: z.string().trim().max(80).default(''),
  barcode: z.string().trim().max(80).default(''),
  priceCents: z.number().int().min(0).max(1_000_000_000),
  compareAtCents: money.optional(),
  weightGrams: z.number().int().min(0).max(1_000_000).default(0),
  trackInventory: z.boolean().default(true),
  imageUrl: z.string().max(2000).nullable().optional(),
  /** Stock inicial (solo variantes nuevas), en la ubicación por defecto. */
  initialStock: z.number().int().min(0).max(1_000_000).optional(),
});
export type VariantInput = z.infer<typeof variantInputSchema>;

export const productInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  handle: z.string().trim().max(64).optional(),
  description: z.string().max(20_000).default(''),
  vendor: z.string().trim().max(120).default(''),
  productType: z.string().trim().max(120).default(''),
  tags: z.array(z.string().trim().min(1).max(60)).max(50).default([]),
  status: z.enum(PRODUCT_STATUSES).default('draft'),
  options: z.array(z.object({ name: z.string().max(40), values: z.array(z.string().max(60)).max(100) })).max(3).default([]),
  images: z.array(z.string().max(2000)).max(20).default([]),
  seoTitle: z.string().trim().max(120).default(''),
  seoDescription: z.string().trim().max(320).default(''),
  requiresShipping: z.boolean().default(true),
  variants: z.array(variantInputSchema).min(1).max(250),
  collectionIds: z.array(z.string().max(80)).max(50).optional(),
});
export type ProductInput = z.infer<typeof productInputSchema>;

export const productPatchSchema = productInputSchema.partial();
export type ProductPatch = z.infer<typeof productPatchSchema>;

export const COLLECTION_FIELDS = ['tag', 'type', 'vendor', 'title', 'price'] as const;
export const COLLECTION_OPS = ['equals', 'contains', 'gt', 'lt'] as const;
export const collectionRulesSchema = z.object({
  match: z.enum(['all', 'any']).default('all'),
  rules: z
    .array(z.object({ field: z.enum(COLLECTION_FIELDS), op: z.enum(COLLECTION_OPS), value: z.string().trim().max(120) }))
    .max(20)
    .default([]),
});
export type CollectionRules = z.infer<typeof collectionRulesSchema>;

export const collectionInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  handle: z.string().trim().max(64).optional(),
  description: z.string().max(5000).default(''),
  kind: z.enum(['manual', 'auto']).default('manual'),
  rules: collectionRulesSchema.optional(),
  productIds: z.array(z.string().max(80)).max(1000).optional(),
  imageUrl: z.string().max(2000).nullable().optional(),
  published: z.boolean().default(true),
  featured: z.boolean().default(false),
});
export type CollectionInput = z.infer<typeof collectionInputSchema>;

export const discountInputSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .regex(/^[A-Za-z0-9_-]+$/),
  kind: z.enum(['percent', 'fixed', 'free_shipping']),
  /** percent: puntos básicos (1500 = 15 %); fixed: cents. */
  value: z.number().int().min(0).max(1_000_000_000).default(0),
  minOrderCents: z.number().int().min(0).max(1_000_000_000).default(0),
  usageLimit: z.number().int().min(1).max(1_000_000).nullable().default(null),
  startsAt: z.string().max(40).nullable().default(null),
  endsAt: z.string().max(40).nullable().default(null),
  active: z.boolean().default(true),
});
export type DiscountInput = z.infer<typeof discountInputSchema>;

export const shippingRateInputSchema = z.object({
  id: z.string().max(80).optional(),
  name: z.string().trim().min(1).max(80),
  kind: z.enum(['flat', 'weight']).default('flat'),
  countries: z.array(z.string().regex(COUNTRY_RE)).max(250).default([]),
  priceCents: z.number().int().min(0).max(100_000_000),
  minWeightG: z.number().int().min(0).max(10_000_000).nullable().default(null),
  maxWeightG: z.number().int().min(0).max(10_000_000).nullable().default(null),
  freeOverCents: z.number().int().min(0).max(1_000_000_000).nullable().default(null),
});
export const taxRateInputSchema = z.object({
  country: z.string().regex(COUNTRY_RE),
  region: z.string().trim().max(80).default(''),
  rateBps: z.number().int().min(0).max(10_000),
  name: z.string().trim().max(40).default(''),
  appliesToShipping: z.boolean().default(false),
});

export const addressSchema = z.object({
  name: z.string().trim().min(1).max(120),
  line1: z.string().trim().min(1).max(200),
  line2: z.string().trim().max(200).default(''),
  city: z.string().trim().min(1).max(120),
  region: z.string().trim().max(120).default(''),
  postalCode: z.string().trim().max(20).default(''),
  country: z.string().trim().toUpperCase().regex(COUNTRY_RE),
  phone: z.string().trim().max(40).default(''),
});
export type ShippingAddress = z.infer<typeof addressSchema>;

export const cartLineSchema = z.object({ variantId: z.string().min(1).max(80), quantity: z.number().int().min(1).max(999) });
export const checkoutSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  lines: z.array(cartLineSchema).min(1).max(100),
  address: addressSchema.nullable().optional(),
  shippingRateId: z.string().max(80).nullable().optional(),
  discountCode: z.string().trim().max(40).nullable().optional(),
  paymentMethod: z.enum(PAYMENT_METHODS),
  note: z.string().max(1000).default(''),
  /** Campo trampa: los bots lo completan. */
  website: z.string().max(200).optional(),
});
export type CheckoutInput = z.infer<typeof checkoutSchema>;

/** Paragraphs del texto de descripción (separados por línea en blanco). */
export function descriptionParagraphs(desc: string): string[] {
  return desc
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** Texto plano de una descripción con HTML (meta description, CSV, búsqueda). */
export function plainText(html: string, max = 320): string {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

export function isCurrency(c: string): boolean {
  return (SHOP_CURRENCIES as readonly string[]).includes(c);
}
