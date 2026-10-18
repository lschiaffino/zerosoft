/**
 * Catálogo estático de las apps. Vive en lib/ (sin React) para que lo compartan
 * las páginas de producto, las imágenes OG y el sitemap.
 *
 * `color` es la única fuente de los colores de producto del lado TS (campo de
 * ceros del home, OG). Las variables CSS --c-<key> de styles/globals.css tienen
 * que coincidir; tests/unit/site-catalog.test.ts lo verifica.
 */
export const PRODUCT_CONFIG = {
  crm: { name: 'CRM', launch: '/app/crm', path: 'crm', color: '#7b4dff' },
  chat: { name: 'Chat', launch: '/app/chat', path: 'chat', color: '#e23d7f' },
  agents: { name: 'Agents', launch: '/app/agents', path: 'agents', color: '#ff3b30' },
  flow: { name: 'Flow', launch: '/app/flow', path: 'flow', color: '#0284c7' },
  robots: { name: 'Robots', launch: '/app/robots', path: 'robots', color: '#6b7280' },
  track: { name: 'Track', launch: '/app/track', path: 'track', color: '#f2611d' },
  link: { name: 'Link', launch: '/app/links', path: 'links', color: '#2f6bff' },
  docs: { name: 'Docs', launch: '/app/docs', path: 'docs', color: '#c2700a' },
  notes: { name: 'Notes', launch: '/app/notes', path: 'notes', color: '#e6b400' },
  cal: { name: 'Cal', launch: '/app/calendar', path: 'calendar', color: '#0e9f6e' },
  board: { name: 'Board', launch: '/app/board', path: 'board', color: '#00b8a9' },
} as const;

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

/** Número de la app en la suite, con dos dígitos ("01" … "11"). */
export function productNumber(key: ProductKey): string {
  return String(PRODUCT_KEYS.indexOf(key) + 1).padStart(2, '0');
}
