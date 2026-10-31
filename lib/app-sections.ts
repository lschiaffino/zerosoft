/**
 * Secciones de las apps en una sola ruta ([[...zs]]). Con ellas el layout del
 * catch-all responde un 404 de verdad: el notFound() de la página llega tarde
 * porque loading.tsx ya mandó los headers con status 200.
 */
export const APP_SECTIONS = {
  sign: ['new', 'envelopes', 'templates', 'settings'],
  shop: ['orders', 'products', 'collections', 'inventory', 'customers', 'discounts', 'analytics', 'settings'],
  books: ['invoices', 'credit-notes', 'bills', 'recurring', 'quotes', 'contacts', 'items', 'expenses', 'purchase-orders', 'banking', 'accounts', 'journal', 'reports', 'settings'],
  people: ['me', 'u', 'org', 'time-off', 'onboarding', 'reviews', 'reports', 'settings', 'welcome'],
  hiring: ['jobs', 'candidates', 'reports', 'templates', 'settings'],
} as const;

/** People: /app/people/<id de la ficha> también es una ruta válida. */
const ID_PREFIX: Partial<Record<keyof typeof APP_SECTIONS, string>> = { people: 'emp_' };

export function isAppSection(app: keyof typeof APP_SECTIONS, section: string | undefined): boolean {
  if (section === undefined || (APP_SECTIONS[app] as readonly string[]).includes(section)) return true;
  const prefix = ID_PREFIX[app];
  return prefix !== undefined && section.startsWith(prefix);
}
