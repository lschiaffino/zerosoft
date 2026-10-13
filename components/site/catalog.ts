import type { SiteProductKey as ProductKey } from '@/lib/products';

/** Repositorio público (self-host, estrellas, issues). */
export const GITHUB_URL = 'https://github.com/lschiaffino/zerosoft';

/** Orden de los productos en el sitio de marketing. */
export const SITE_PRODUCTS: readonly ProductKey[] = ['link', 'crm', 'cal', 'track', 'chat', 'docs'];

export const PRODUCT_NAMES: Record<ProductKey, string> = {
  link: 'Link',
  crm: 'CRM',
  cal: 'Cal',
  track: 'Track',
  chat: 'Chat',
  docs: 'Docs',
};

/**
 * Lo que reemplaza cada producto y su precio de lista, tal como lo citan las
 * páginas de producto (messages/<locale>/pages.json → products.<key>.compare).
 * `perUser: false` = plan mensual fijo (Bitly Core).
 */
export const INCUMBENTS: Record<ProductKey, { rival: string; monthly: number; perUser: boolean }> = {
  crm: { rival: 'HubSpot', monthly: 50, perUser: true },
  chat: { rival: 'Intercom', monthly: 29, perUser: true },
  cal: { rival: 'Calendly', monthly: 12, perUser: true },
  docs: { rival: 'Notion', monthly: 10, perUser: true },
  track: { rival: 'Linear', monthly: 8, perUser: true },
  link: { rival: 'Bitly', monthly: 35, perUser: false },
};

/** Costo anual a precio de lista para un equipo de `seats` personas. */
export function annualCost(key: ProductKey, seats = 10): number {
  const inc = INCUMBENTS[key];
  return inc.monthly * 12 * (inc.perUser ? seats : 1);
}

/** Ícono por feature (f1…f9) de cada página de producto. */
export const FEATURE_ICONS: Record<ProductKey, readonly string[]> = {
  link: ['globe', 'chart', 'qr', 'lock', 'import', 'user', 'tag', 'plug', 'download'],
  crm: ['kanban', 'users', 'mail', 'clock', 'chart', 'import', 'share', 'bolt', 'plug'],
  cal: ['calendar', 'sync', 'clock', 'shuffle', 'user', 'mail', 'embed', 'plug', 'shield'],
  track: ['layout', 'cycle', 'gantt', 'tree', 'inbox', 'flag', 'hash', 'filter', 'message'],
  chat: ['message', 'inbox', 'flag', 'clock', 'bot', 'star', 'reply', 'user', 'users'],
  docs: ['blocks', 'tree', 'at', 'share', 'users', 'database', 'search', 'eye', 'server'],
};

/** A quién le sirve cada app: equipos (B2B) o uso personal. */
export type Audience = 'teams' | 'personal';

export const AUDIENCE_PRODUCTS: Record<Audience, readonly ProductKey[]> = {
  teams: ['crm', 'chat', 'track', 'link'],
  personal: ['docs', 'cal'],
};

/**
 * Productos en construcción. Se muestran como "Pronto" y sin link: no se
 * publicitan features hasta que estén en producción.
 */
export type UpcomingKey = 'agents' | 'flow' | 'robots' | 'notes' | 'board';

/**
 * `href` = ya está en la app pero todavía sin página de producto: se muestra
 * como "Nuevo" con link a la app en vez de "Pronto".
 */
export const UPCOMING: ReadonlyArray<{ key: UpcomingKey; name: string; rival: string; audience: Audience; href?: string }> = [
  { key: 'agents', name: 'Agents', rival: 'Intercom Fin', audience: 'teams', href: '/app/agents' },
  { key: 'flow', name: 'Flow', rival: 'Zapier · n8n', audience: 'teams', href: '/app/flow' },
  { key: 'robots', name: 'Robots', rival: 'UiPath', audience: 'teams', href: '/app/robots' },
  { key: 'notes', name: 'Notes', rival: 'Evernote', audience: 'personal', href: '/app/notes' },
  { key: 'board', name: 'Board', rival: 'Miro', audience: 'personal', href: '/app/board' },
];

/** Productos con endpoints en la API v1 pública (ver lib/api-docs.ts). */
export const HAS_API: readonly ProductKey[] = ['link', 'crm', 'cal'];
