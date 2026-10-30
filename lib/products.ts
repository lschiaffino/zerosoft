/**
 * Catálogo estático de las apps. Vive en lib/ (sin React) para que lo compartan
 * las páginas de producto, las imágenes OG y el sitemap.
 *
 * `color` es la única fuente de los colores de producto del lado TS (campo de
 * ceros del home, OG). Las variables CSS --c-<key> de styles/globals.css tienen
 * que coincidir; tests/unit/site-catalog.test.ts lo verifica.
 *
 * `category` y `audience` ordenan los menús: el catálogo del sitio
 * (AUDIENCE_PRODUCTS) y el switcher de la app salen de acá.
 */
export type ProductCategory = 'sell' | 'support' | 'automate' | 'build' | 'daily';
export type ProductAudience = 'team' | 'personal';

/** Orden de las categorías en los menús: vender, atender, automatizar, construir, trabajo diario. */
export const PRODUCT_CATEGORIES: readonly ProductCategory[] = ['sell', 'support', 'automate', 'build', 'daily'];

interface ProductEntry {
  name: string;
  /** Ruta de entrada de la app. */
  launch: string;
  /** Segmento de la URL dentro de /app. */
  path: string;
  color: string;
  category: ProductCategory;
  /** Equipos (B2B) o uso personal. */
  audience: ProductAudience;
}

export const PRODUCT_CONFIG = {
  crm: { name: 'CRM', launch: '/app/crm', path: 'crm', color: '#7b4dff', category: 'sell', audience: 'team' },
  chat: { name: 'Chat', launch: '/app/chat', path: 'chat', color: '#e23d7f', category: 'support', audience: 'team' },
  groups: { name: 'Groups', launch: '/app/groups', path: 'groups', color: '#65a30d', category: 'support', audience: 'team' },
  agents: { name: 'Agents', launch: '/app/agents', path: 'agents', color: '#ff3b30', category: 'automate', audience: 'team' },
  flow: { name: 'Flow', launch: '/app/flow', path: 'flow', color: '#0284c7', category: 'automate', audience: 'team' },
  robots: { name: 'Robots', launch: '/app/robots', path: 'robots', color: '#6b7280', category: 'automate', audience: 'team' },
  track: { name: 'Track', launch: '/app/track', path: 'track', color: '#f2611d', category: 'build', audience: 'team' },
  link: { name: 'Link', launch: '/app/links', path: 'links', color: '#2f6bff', category: 'sell', audience: 'team' },
  docs: { name: 'Docs', launch: '/app/docs', path: 'docs', color: '#c2700a', category: 'daily', audience: 'personal' },
  notes: { name: 'Notes', launch: '/app/notes', path: 'notes', color: '#e6b400', category: 'daily', audience: 'personal' },
  cal: { name: 'Cal', launch: '/app/calendar', path: 'calendar', color: '#0e9f6e', category: 'daily', audience: 'personal' },
  board: { name: 'Board', launch: '/app/board', path: 'board', color: '#00b8a9', category: 'build', audience: 'personal' },
  voice: { name: 'Voice', launch: '/app/voice', path: 'voice', color: '#c026d3', category: 'daily', audience: 'personal' },
  rec: { name: 'Rec', launch: '/app/rec', path: 'rec', color: '#e11d48', category: 'daily', audience: 'team' },
  talk: { name: 'Talk', launch: '/app/talk', path: 'talk', color: '#8e3a80', category: 'daily', audience: 'team' },
  design: { name: 'Design', launch: '/app/design', path: 'design', color: '#00a5c8', category: 'build', audience: 'team' },
  shop: { name: 'Shop', launch: '/app/shop', path: 'shop', color: '#15803d', category: 'sell', audience: 'team' },
  analytics: { name: 'Analytics', launch: '/app/analytics', path: 'analytics', color: '#4f46e5', category: 'build', audience: 'team' },
  social: { name: 'Social', launch: '/app/social', path: 'social', color: '#7e22ce', category: 'sell', audience: 'team' },
  hiring: { name: 'Hiring', launch: '/app/hiring', path: 'hiring', color: '#0f766e', category: 'daily', audience: 'team' },
  books: { name: 'Books', launch: '/app/books', path: 'books', color: '#1e3a8a', category: 'sell', audience: 'team' },
} as const satisfies Record<string, ProductEntry>;

/**
 * Orden del switcher de la app (las más usadas arriba). Nombre, ruta y color
 * salen de PRODUCT_CONFIG; acá va solo el orden.
 */
export const APP_SWITCHER_ORDER = [
  'link',
  'crm',
  'shop',
  'books',
  'docs',
  'cal',
  'track',
  'chat',
  'groups',
  'social',
  'flow',
  'notes',
  'board',
  'design',
  'talk',
  'voice',
  'rec',
  'hiring',
  'agents',
  'robots',
  'analytics',
] as const satisfies readonly (keyof typeof PRODUCT_CONFIG)[];

/** Todas las apps de la suite. */
export type ProductKey = keyof typeof PRODUCT_CONFIG;

/** Apps con página en el sitio (hoy, todas). */
export type SiteProductKey = ProductKey;

/** Orden canónico del sitio: equipos primero, después uso personal. */
export const PRODUCT_KEYS: SiteProductKey[] = Object.keys(PRODUCT_CONFIG) as SiteProductKey[];

export function isProductKey(value: string): value is SiteProductKey {
  return (PRODUCT_KEYS as string[]).includes(value);
}

/** "#7b4dff" → "123,77,255" (formato "r,g,b"). */
export function productRgb(key: ProductKey): string {
  const hex = PRODUCT_CONFIG[key].color.slice(1);
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(',');
}

/**
 * Apps registradas que todavía se están construyendo: tienen shell en /app,
 * landing que lo dice y paridad en 0 %. Al salir la primera versión, se
 * sacan de acá.
 */
export const BUILDING_PRODUCTS: readonly ProductKey[] = [];

export function isBuildingProduct(key: string): boolean {
  return (BUILDING_PRODUCTS as readonly string[]).includes(key);
}

/** Número de la app en la suite, con dos dígitos ("01" … "15"). */
export function productNumber(key: ProductKey): string {
  return String(PRODUCT_KEYS.indexOf(key) + 1).padStart(2, '0');
}

/** Apps de un público, en el orden canónico. */
export function productsByAudience(audience: ProductAudience): SiteProductKey[] {
  return PRODUCT_KEYS.filter((k) => PRODUCT_CONFIG[k].audience === audience);
}

/** Apps de una categoría, en el orden canónico. */
export function productsByCategory(category: ProductCategory): SiteProductKey[] {
  return PRODUCT_KEYS.filter((k) => PRODUCT_CONFIG[k].category === category);
}

/** Ajustes propios de cada app: /app/<app>/settings. */
export function productSettingsHref(key: ProductKey): string {
  return `${PRODUCT_CONFIG[key].launch}/settings`;
}
