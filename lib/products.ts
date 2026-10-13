/**
 * Static catalog of the six products. Kept in lib/ (no React imports) so both
 * the product pages and the /api/og/product route can share it.
 */
export const PRODUCT_CONFIG = {
  link: { num: '04', name: 'Link', available: true, launch: '/app/links' },
  track: { num: '01', name: 'Track', available: true, launch: '/app/track' },
  crm: { num: '02', name: 'CRM', available: true, launch: '/app/crm' },
  cal: { num: '03', name: 'Cal', available: true, launch: '/app/calendar' },
  docs: { num: '05', name: 'Docs', available: true, launch: '/app/docs' },
  chat: { num: '06', name: 'Chat', available: true, launch: '/app/chat' },
} as const;

export type ProductKey = keyof typeof PRODUCT_CONFIG;

export const PRODUCT_KEYS = Object.keys(PRODUCT_CONFIG) as ProductKey[];

export function isProductKey(value: string): value is ProductKey {
  return (PRODUCT_KEYS as string[]).includes(value);
}

/**
 * Productos que ya existen dentro de la app pero que el sitio de marketing
 * todavía muestra como "Pronto" (components/site/catalog.ts → UPCOMING).
 * Van aparte de PRODUCT_CONFIG para no generar páginas /products/<key> ni
 * entrar en los Record<ProductKey, …> del catálogo.
 */
export const APP_ONLY_PRODUCTS = {
  notes: { name: 'Notes', launch: '/app/notes' },
  board: { name: 'Board', launch: '/app/board' },
} as const;

export type AppOnlyProductKey = keyof typeof APP_ONLY_PRODUCTS;
