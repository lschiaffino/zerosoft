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
export type ProductCategory = 'sell' | 'support' | 'automate' | 'build' | 'run' | 'daily';
export type ProductAudience = 'team' | 'personal';

/** Orden de las categorías en los menús: construir (Track primero) y después vender, atender, automatizar, operar, trabajo diario. */
export const PRODUCT_CATEGORIES: readonly ProductCategory[] = ['build', 'sell', 'support', 'automate', 'run', 'daily'];

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
  /**
   * 'coming_soon': todavía no se puede usar. Sale como "Próximamente" con lista
   * de espera en la app y en el sitio, sus rutas, APIs y herramientas del MCP
   * se cortan para todos menos el staff (ADMIN_EMAILS) y no cuenta como app
   * disponible. Pasarla a GA es borrar este campo.
   */
  status?: 'coming_soon';
}

export const PRODUCT_CONFIG = {
  track: { name: 'Track', launch: '/app/track', path: 'track', color: '#f2611d', category: 'build', audience: 'team' },
  crm: { name: 'CRM', launch: '/app/crm', path: 'crm', color: '#7b4dff', category: 'sell', audience: 'team' },
  chat: { name: 'Chat', launch: '/app/chat', path: 'chat', color: '#e23d7f', category: 'support', audience: 'team', status: 'coming_soon' },
  groups: { name: 'Lines', launch: '/app/lines', path: 'lines', color: '#65a30d', category: 'support', audience: 'team' },
  agents: { name: 'Agents', launch: '/app/agents', path: 'agents', color: '#ff3b30', category: 'automate', audience: 'team', status: 'coming_soon' },
  flow: { name: 'Flow', launch: '/app/flow', path: 'flow', color: '#0284c7', category: 'automate', audience: 'team' },
  robots: { name: 'Robots', launch: '/app/robots', path: 'robots', color: '#6b7280', category: 'automate', audience: 'team', status: 'coming_soon' },
  link: { name: 'Link', launch: '/app/links', path: 'links', color: '#2f6bff', category: 'sell', audience: 'team' },
  docs: { name: 'Docs', launch: '/app/docs', path: 'docs', color: '#c2700a', category: 'daily', audience: 'personal' },
  notes: { name: 'Notes', launch: '/app/notes', path: 'notes', color: '#e6b400', category: 'daily', audience: 'personal' },
  cal: { name: 'Cal', launch: '/app/calendar', path: 'calendar', color: '#0e9f6e', category: 'daily', audience: 'personal' },
  board: { name: 'Board', launch: '/app/board', path: 'board', color: '#00b8a9', category: 'build', audience: 'personal' },
  voice: { name: 'Voice', launch: '/app/voice', path: 'voice', color: '#c026d3', category: 'daily', audience: 'personal' },
  inbox: { name: 'Inbox', launch: '/app/inbox', path: 'inbox', color: '#3d5a80', category: 'daily', audience: 'personal' },
  rec: { name: 'Rec', launch: '/app/rec', path: 'rec', color: '#e11d48', category: 'daily', audience: 'team' },
  talk: { name: 'Talk', launch: '/app/talk', path: 'talk', color: '#8e3a80', category: 'daily', audience: 'team' },
  design: { name: 'Design', launch: '/app/design', path: 'design', color: '#00a5c8', category: 'build', audience: 'team', status: 'coming_soon' },
  shop: { name: 'Shop', launch: '/app/shop', path: 'shop', color: '#15803d', category: 'sell', audience: 'team', status: 'coming_soon' },
  pulse: { name: 'Pulse', launch: '/app/pulse', path: 'pulse', color: '#4f46e5', category: 'build', audience: 'team' },
  social: { name: 'Social', launch: '/app/social', path: 'social', color: '#7e22ce', category: 'sell', audience: 'team', status: 'coming_soon' },
  hiring: { name: 'Hiring', launch: '/app/hiring', path: 'hiring', color: '#0f766e', category: 'run', audience: 'team', status: 'coming_soon' },
  people: { name: 'People', launch: '/app/people', path: 'people', color: '#8b5e34', category: 'run', audience: 'team' },
  books: { name: 'Books', launch: '/app/books', path: 'books', color: '#1e3a8a', category: 'run', audience: 'team', status: 'coming_soon' },
  sign: { name: 'Sign', launch: '/app/sign', path: 'sign', color: '#7f1d1d', category: 'run', audience: 'team' },
  forms: { name: 'Forms', launch: '/app/forms', path: 'forms', color: '#6e730d', category: 'sell', audience: 'team' },
  send: { name: 'Send', launch: '/app/send', path: 'send', color: '#0b7285', category: 'sell', audience: 'team' },
} as const satisfies Record<string, ProductEntry>;

/**
 * Orden del switcher de la app: Track primero, es la app más completa; después las más usadas. Nombre, ruta y color
 * salen de PRODUCT_CONFIG; acá va solo el orden.
 */
export const APP_SWITCHER_ORDER = [
  'track',
  'link',
  'crm',
  'shop',
  'books',
  'forms',
  'send',
  'docs',
  'cal',
  'chat',
  'groups',
  'social',
  'flow',
  'notes',
  'board',
  'design',
  'talk',
  'people',
  'voice',
  'inbox',
  'rec',
  'hiring',
  'sign',
  'agents',
  'robots',
  'pulse',
] as const satisfies readonly (keyof typeof PRODUCT_CONFIG)[];

/** Todas las apps de la suite. */
export type ProductKey = keyof typeof PRODUCT_CONFIG;

/**
 * Apps personales de cada persona (sus mensajes, no los del workspace): las
 * tiene siempre, en todo workspace, sin importar las apps que le habilitaron.
 * No se dan ni se quitan en Ajustes › Miembros.
 */
export const ALWAYS_ON_APPS: readonly ProductKey[] = ['inbox'];

export function isAlwaysOnApp(key: string): boolean {
  return (ALWAYS_ON_APPS as readonly string[]).includes(key);
}

/** ¿La app entra en la lista de apps permitidas de la sesión? ('*' o lista; las personales siempre). */
export function appAllowed(allowed: '*' | readonly string[] | null | undefined, key: ProductKey): boolean {
  return allowed == null || allowed === '*' || isAlwaysOnApp(key) || allowed.includes(key);
}

/** Apps con página en el sitio (hoy, todas). */
export type SiteProductKey = ProductKey;

/** Orden canónico del sitio: equipos primero, después uso personal. */
export const PRODUCT_KEYS: SiteProductKey[] = Object.keys(PRODUCT_CONFIG) as SiteProductKey[];

export function isProductKey(value: string): value is SiteProductKey {
  return (PRODUCT_KEYS as string[]).includes(value);
}

/**
 * Segmento de la página del sitio (/products/<slug>). Es la clave salvo en
 * las apps que cambiaron de nombre: la clave sigue siendo interna (permisos,
 * datos, mensajes) y la URL pública usa el nombre nuevo.
 */
const SITE_SLUGS: Partial<Record<ProductKey, string>> = { groups: 'lines' };

export function productSlug(key: ProductKey): string {
  return SITE_SLUGS[key] ?? key;
}

/** "/products/<slug>" de una app. */
export function productHref(key: ProductKey): string {
  return `/products/${productSlug(key)}`;
}

/** La app de un slug de /products/<slug>; null si no existe (la clave vieja de una app renombrada tampoco). */
export function productKeyFromSlug(slug: string): SiteProductKey | null {
  const key = PRODUCT_KEYS.find((k) => productSlug(k) === slug);
  return key ?? null;
}

/** "#7b4dff" → "123,77,255" (formato "r,g,b"). */
export function productRgb(key: ProductKey): string {
  const hex = PRODUCT_CONFIG[key].color.slice(1);
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(',');
}

/**
 * Apps "Próximamente" (`status: 'coming_soon'` en PRODUCT_CONFIG): lista de
 * espera en vez de app. Salen de PRODUCT_CONFIG, en el orden canónico.
 */
export const COMING_SOON_APPS: readonly ProductKey[] = (Object.keys(PRODUCT_CONFIG) as ProductKey[]).filter(
  (k) => (PRODUCT_CONFIG[k] as ProductEntry).status === 'coming_soon',
);

export function isComingSoon(key: string): boolean {
  return (COMING_SOON_APPS as readonly string[]).includes(key);
}

/** Página de lista de espera de una app "Próximamente" (dentro de la app). */
export function comingSoonHref(key: ProductKey): string {
  return `/app/soon/${key}`;
}

/** Apps que se pueden usar hoy (las que cuentan en el sitio, los precios y la paridad). */
export const AVAILABLE_PRODUCT_KEYS: readonly ProductKey[] = (Object.keys(PRODUCT_CONFIG) as ProductKey[]).filter((k) => !isComingSoon(k));

/**
 * ¿La app se prende, se apaga y se restringe en Ajustes › Apps del workspace?
 * Las de equipo, sí; las personales (Inbox, Notes, Docs…) no: son de cada persona.
 */
export function isWorkspaceGatedApp(key: string): boolean {
  return isProductKey(key) && PRODUCT_CONFIG[key].audience === 'team' && !isAlwaysOnApp(key);
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

/** Segmento de ruta (/app/<x> o /api/<x>) → app. */
const PATH_APPS: Record<string, ProductKey> = (() => {
  const out: Record<string, ProductKey> = {};
  for (const key of Object.keys(PRODUCT_CONFIG) as ProductKey[]) out[PRODUCT_CONFIG[key].path] = key;
  // Lines (antes Groups): los links viejos guardados dicen /app/groups.
  out.groups = 'groups';
  return out;
})();

/** Familias de API con otro nombre que su página (Pulse conserva /api/analytics de cuando se llamaba Analytics). */
const API_APPS: Record<string, ProductKey> = { ...PATH_APPS, boards: 'board', link: 'link', analytics: 'pulse' };

/** App de un path de página (/<locale>/app/<x>/…, /app/<x>/…) o de API (/api/<x>/…). null si no es de una app. */
export function appFromPath(path: string | null | undefined): ProductKey | null {
  if (!path) return null;
  const clean = path.split(/[?#]/)[0];
  const page = /^(?:\/(?:en|es|pt))?\/app\/([^/]+)/.exec(clean);
  const api = /^\/api\/([^/]+)/.exec(clean);
  if (page) return PATH_APPS[page[1]] ?? null;
  return api ? (API_APPS[api[1]] ?? null) : null;
}

/** Lo que la persona puede abrir de las apps: '*' o su lista (rol y team_members.apps). */
export type AllowedApps = '*' | readonly ProductKey[];

/**
 * ¿Se le ofrece este destino a la persona? Sirve en cliente (Cmd+K): nada de
 * una app bloqueada, venga de la ruta o de `app` cuando la ruta no la dice
 * (como el hub de importación, que vive en Ajustes).
 */
export function hrefAllowed(allowed: AllowedApps, href: string, app?: ProductKey | null): boolean {
  const target = app ?? appFromPath(href);
  return !target || appAllowed(allowed, target);
}
