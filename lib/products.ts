/**
 * Static catalog of the products. Kept in lib/ (no React imports) so both
 * the product pages and the /api/og/product route can share it.
 *
 * `available: false` = la app existe (shell /app) pero todavía no se publica en
 * el sitio de marketing: queda fuera de SiteProductKey / PRODUCT_KEYS y el sitio
 * la muestra como "Pronto" (components/site/catalog.ts → UPCOMING).
 */
export const PRODUCT_CONFIG = {
  link: { num: '04', name: 'Link', available: true, launch: '/app/links' },
  track: { num: '01', name: 'Track', available: true, launch: '/app/track' },
  crm: { num: '02', name: 'CRM', available: true, launch: '/app/crm' },
  cal: { num: '03', name: 'Cal', available: true, launch: '/app/calendar' },
  docs: { num: '05', name: 'Docs', available: true, launch: '/app/docs' },
  chat: { num: '06', name: 'Chat', available: true, launch: '/app/chat' },
  flow: { num: '07', name: 'Flow', available: false, launch: '/app/flow' },
} as const;

/** Todas las apps (incluye las que aún no se publican en el sitio). */
export type ProductKey = keyof typeof PRODUCT_CONFIG;

/** Productos publicados en el sitio (páginas, OG, comparativas). */
export type SiteProductKey = Exclude<ProductKey, 'flow'>;

export const PRODUCT_KEYS: SiteProductKey[] = ['link', 'track', 'crm', 'cal', 'docs', 'chat'];

export function isProductKey(value: string): value is SiteProductKey {
  return (PRODUCT_KEYS as string[]).includes(value);
}
