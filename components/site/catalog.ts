import {
  PRODUCT_CATEGORIES,
  PRODUCT_CONFIG,
  PRODUCT_KEYS,
  productsByAudience,
  productsByCategory,
  type ProductCategory,
  type SiteProductKey as ProductKey,
} from '@/lib/products';

/** Repositorio público (self-host, estrellas, issues). */
export const GITHUB_URL = 'https://github.com/lschiaffino/zerosoft';

/** Orden de los productos en el sitio de marketing (el de lib/products). */
export const SITE_PRODUCTS: readonly ProductKey[] = PRODUCT_KEYS;

export const PRODUCT_NAMES = Object.fromEntries(PRODUCT_KEYS.map((k) => [k, PRODUCT_CONFIG[k].name])) as Record<
  ProductKey,
  string
>;

/** La herramienta paga que reemplaza cada app (lo que muestran la suite y el menú). */
export const RIVALS: Record<ProductKey, string> = {
  crm: 'HubSpot',
  chat: 'Intercom',
  groups: 'Periskope',
  agents: 'Intercom Fin',
  flow: 'Zapier · n8n',
  robots: 'UiPath',
  track: 'Linear',
  link: 'Bitly',
  docs: 'Notion',
  notes: 'Evernote',
  cal: 'Calendly',
  board: 'Miro',
  voice: 'Wispr Flow · Granola',
  rec: 'Loom',
  talk: 'Slack',
  analytics: 'PostHog',
};

/** Las seis apps de la tabla de costos del home (precio por usuario o plan fijo). */
export type IncumbentKey = 'crm' | 'chat' | 'cal' | 'docs' | 'track' | 'link';

/**
 * Lo que reemplaza cada producto y su precio de lista, tal como lo citan las
 * páginas de producto (messages/<locale>/pages.json → products.<key>.compare).
 * `perUser: false` = plan mensual fijo (Bitly Core).
 */
export const INCUMBENTS: Record<IncumbentKey, { rival: string; monthly: number; perUser: boolean }> = {
  crm: { rival: 'HubSpot', monthly: 50, perUser: true },
  chat: { rival: 'Intercom', monthly: 29, perUser: true },
  cal: { rival: 'Calendly', monthly: 12, perUser: true },
  docs: { rival: 'Notion', monthly: 10, perUser: true },
  track: { rival: 'Linear', monthly: 8, perUser: true },
  link: { rival: 'Bitly', monthly: 35, perUser: false },
};

/** Costo anual a precio de lista para un equipo de `seats` personas. */
export function annualCost(key: IncumbentKey, seats = 10): number {
  const inc = INCUMBENTS[key];
  return inc.monthly * 12 * (inc.perUser ? seats : 1);
}

/** A quién le sirve cada app: equipos (B2B) o uso personal. */
export type Audience = 'teams' | 'personal';

/** Sale de `audience` en PRODUCT_CONFIG (lib/products.ts), en el orden canónico. */
export const AUDIENCE_PRODUCTS: Record<Audience, readonly ProductKey[]> = {
  teams: productsByAudience('team'),
  personal: productsByAudience('personal'),
};

/**
 * Menú de productos y la suite del sitio: por categoría (vender, atender,
 * automatizar, construir, trabajo diario), en el orden de PRODUCT_CATEGORIES.
 */
export const CATEGORY_PRODUCTS: ReadonlyArray<{ category: ProductCategory; products: readonly ProductKey[] }> =
  PRODUCT_CATEGORIES.map((category) => ({ category, products: productsByCategory(category) })).filter((g) => g.products.length > 0);

/** Productos con endpoints en la API v1 pública (ver lib/api-docs.ts). */
export const HAS_API: readonly ProductKey[] = ['link', 'crm', 'cal'];

/* ------------------------------------------------------------------ */
/* Páginas de producto: una sola plantilla, armada desde estos datos.  */
/* ------------------------------------------------------------------ */

/**
 * Bloques de la página de producto, en el orden en que aparecen. El hero va
 * siempre primero; el resto de la suite y el cierre, siempre al final.
 * - shot: vista del producto (mockup)
 * - features: lista de funciones (2 columnas, sin íconos)
 * - how: los tres pasos
 * - video: grabación real (solo si existe /videos/<key>.mp4)
 * - parity: paridad de funciones contra el competidor y la tabla de todo lo incluido
 * - compare: la cuenta contra el rival, con la placa de $0
 * - model: las tres formas de tenerlo y la tabla de precios (costo × 3)
 * - faq: preguntas
 */
export type PageSection = 'shot' | 'features' | 'parity' | 'how' | 'video' | 'compare' | 'model' | 'faq';

/** id de cada bloque en la página: las anclas del índice de secciones (ProductSectionNav). */
export const SECTION_IDS: Record<PageSection, string> = {
  shot: 'vista',
  features: 'features',
  parity: 'parity',
  how: 'how',
  video: 'video',
  compare: 'pricing',
  model: 'model',
  faq: 'faq',
};

export interface ProductPageSpec {
  /** Orden de los bloques: cambia el ritmo entre páginas. */
  sections: readonly PageSection[];
  /** Cantidad de features (claves f1…fN en pages.json). */
  features: number;
  /** Cantidad de preguntas (claves faq.f1…fN). */
  faqs: number;
  /** "split": título fijo a la izquierda y lista a la derecha. "columns": título arriba, lista a dos columnas. */
  featureLayout: 'split' | 'columns';
}

export const PRODUCT_PAGES: Record<ProductKey, ProductPageSpec> = {
  crm: { sections: ['shot', 'features', 'parity', 'how', 'compare', 'video', 'model', 'faq'], features: 9, faqs: 5, featureLayout: 'columns' },
  chat: { sections: ['shot', 'how', 'features', 'parity', 'compare', 'video', 'model', 'faq'], features: 9, faqs: 5, featureLayout: 'split' },
  groups: { sections: ['shot', 'features', 'how', 'parity', 'compare', 'model', 'faq'], features: 9, faqs: 5, featureLayout: 'split' },
  agents: { sections: ['how', 'shot', 'features', 'parity', 'compare', 'model', 'faq'], features: 6, faqs: 5, featureLayout: 'split' },
  flow: { sections: ['shot', 'how', 'features', 'parity', 'compare', 'model', 'faq'], features: 6, faqs: 5, featureLayout: 'columns' },
  robots: { sections: ['how', 'features', 'shot', 'parity', 'compare', 'model', 'faq'], features: 6, faqs: 5, featureLayout: 'columns' },
  track: { sections: ['shot', 'features', 'parity', 'video', 'compare', 'how', 'model', 'faq'], features: 9, faqs: 5, featureLayout: 'split' },
  link: { sections: ['shot', 'compare', 'features', 'parity', 'how', 'video', 'model', 'faq'], features: 9, faqs: 5, featureLayout: 'columns' },
  docs: { sections: ['shot', 'features', 'parity', 'compare', 'video', 'model', 'faq'], features: 9, faqs: 5, featureLayout: 'split' },
  notes: { sections: ['features', 'shot', 'parity', 'compare', 'model', 'faq'], features: 6, faqs: 5, featureLayout: 'columns' },
  cal: { sections: ['shot', 'how', 'compare', 'features', 'parity', 'video', 'model', 'faq'], features: 9, faqs: 5, featureLayout: 'columns' },
  board: { sections: ['shot', 'features', 'parity', 'compare', 'model', 'faq'], features: 6, faqs: 5, featureLayout: 'split' },
  // En construcción: lo que va a hacer, la paridad en 0 % y la cuenta contra el rival.
  voice: { sections: ['features', 'parity', 'how', 'compare', 'shot', 'model', 'faq'], features: 6, faqs: 5, featureLayout: 'columns' },
  rec: { sections: ['features', 'how', 'parity', 'compare', 'shot', 'model', 'faq'], features: 6, faqs: 5, featureLayout: 'split' },
  talk: { sections: ['features', 'parity', 'compare', 'how', 'shot', 'model', 'faq'], features: 6, faqs: 5, featureLayout: 'split' },
  analytics: { sections: ['shot', 'features', 'how', 'parity', 'compare', 'model', 'faq'], features: 6, faqs: 5, featureLayout: 'columns' },
};
