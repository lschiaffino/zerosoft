// Taxonomía única de productos: feedback, roadmap, board público y changelog.
// Sin dependencias de servidor (la usan componentes cliente y el middleware).

export const PRODUCT_KEYS = [
  'link',
  'crm',
  'cal',
  'track',
  'chat',
  'docs',
  'flow',
  'agents',
  'notes',
  'board',
  'robots',
  'groups',
  'voice',
  'rec',
  'talk',
  'design',
  'shop',
  'analytics',
  'social',
  'hiring',
  'people',
  'books',
  'forms',
  'platform',
  'site',
  'other',
] as const;

export type ProductKey = (typeof PRODUCT_KEYS)[number];

export function isProductKey(value: unknown): value is ProductKey {
  return typeof value === 'string' && (PRODUCT_KEYS as readonly string[]).includes(value);
}

/** Color de cada producto (tokens --c-* de globals.css); plataforma y sitio en tinta. */
export const PRODUCT_COLOR: Record<ProductKey, string> = {
  link: 'var(--c-link)',
  crm: 'var(--c-crm)',
  cal: 'var(--c-cal)',
  track: 'var(--c-track)',
  chat: 'var(--c-chat)',
  docs: 'var(--c-docs)',
  flow: 'var(--c-flow)',
  agents: 'var(--c-agents)',
  notes: 'var(--c-notes)',
  board: 'var(--c-board)',
  robots: 'var(--c-robots)',
  groups: 'var(--c-groups)',
  voice: 'var(--c-voice)',
  rec: 'var(--c-rec)',
  talk: 'var(--c-talk)',
  design: 'var(--c-design)',
  shop: 'var(--c-shop)',
  analytics: 'var(--c-analytics)',
  social: 'var(--c-social)',
  hiring: 'var(--c-hiring)',
  people: 'var(--c-people)',
  books: 'var(--c-books)',
  forms: 'var(--c-forms)',
  platform: 'var(--ink)',
  site: 'var(--ink)',
  other: 'var(--dim)',
};

export function productColor(product: string): string {
  return isProductKey(product) ? PRODUCT_COLOR[product] : 'var(--dim)';
}

/** Producto a partir de la ruta de la app (/app/crm/... → crm). /app (inicio) y /app/settings: plataforma. Fuera de /app: sitio. */
export function productFromPath(pathname: string): ProductKey {
  const m = /^(?:\/(?:en|es|pt))?\/app(?:\/([a-z]+))?(?:\/|$)/.exec(pathname);
  if (!m) return 'site';
  switch (m[1]) {
    case undefined:
    case 'settings':
      return 'platform';
    case 'links':
      return 'link';
    case 'crm':
      return 'crm';
    case 'calendar':
      return 'cal';
    case 'track':
      return 'track';
    case 'chat':
      return 'chat';
    case 'docs':
      return 'docs';
    case 'flow':
      return 'flow';
    case 'notes':
      return 'notes';
    case 'board':
      return 'board';
    case 'agents':
      return 'agents';
    case 'robots':
      return 'robots';
    case 'groups':
      return 'groups';
    case 'voice':
      return 'voice';
    case 'rec':
      return 'rec';
    case 'talk':
      return 'talk';
    case 'design':
      return 'design';
    case 'shop':
      return 'shop';
    case 'analytics':
      return 'analytics';
    case 'social':
      return 'social';
    case 'hiring':
      return 'hiring';
    case 'people':
      return 'people';
    case 'books':
      return 'books';
    case 'forms':
      return 'forms';
    default:
      return 'link';
  }
}
