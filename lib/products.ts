/**
 * Static catalog of the five products. Kept in lib/ (no React imports) so both
 * the product pages and the /api/og/product route can share it.
 */
export const PRODUCT_CONFIG = {
  link: { num: '04', name: 'Link', available: true, launch: '/app' },
  track: { num: '01', name: 'Track', available: false, launch: '/app' },
  crm: { num: '02', name: 'CRM', available: true, launch: '/app/crm' },
  cal: { num: '03', name: 'Cal', available: false, launch: '/app' },
  docs: { num: '05', name: 'Docs', available: true, launch: '/app/docs' },
} as const;

export type ProductKey = keyof typeof PRODUCT_CONFIG;

export const PRODUCT_KEYS = Object.keys(PRODUCT_CONFIG) as ProductKey[];

export function isProductKey(value: string): value is ProductKey {
  return (PRODUCT_KEYS as string[]).includes(value);
}
