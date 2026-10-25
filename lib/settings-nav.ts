/**
 * Ajustes globales (/app/settings): pestañas y grupos, en datos puros para
 * poder testearlos sin React.
 */
import { WEBHOOK_EVENTS, type WebhookEvent } from './webhooks-events';
import { PRODUCT_KEYS, productSettingsHref, type ProductKey } from './products';

export interface RouteTab {
  key: string;
  href?: string;
  /** Otras rutas que también activan la pestaña (p. ej. Admin: feedback, roadmap y changelog). */
  match?: string[];
}

/**
 * Pestaña activa en modo ruta: la de prefijo más largo entre su `href` y sus
 * `match`. `/app/settings` no le gana a `/app/settings/workspace` en esa ruta.
 */
export function activeRouteTab(items: RouteTab[], pathname: string): string | undefined {
  let best: { key: string; len: number } | undefined;
  for (const item of items) {
    for (const prefix of [item.href, ...(item.match ?? [])]) {
      if (!prefix) continue;
      if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) continue;
      if (!best || prefix.length > best.len) best = { key: item.key, len: prefix.length };
    }
  }
  return best?.key;
}

export const SETTINGS_ADMIN_ROUTES = ['/app/settings/feedback', '/app/settings/roadmap', '/app/settings/changelog'] as const;

/** Secciones de "Cuenta y workspace", en el orden de la nav. Admin va al final y solo para ADMIN_EMAILS. */
export const SETTINGS_SECTION_KEYS = [
  'profile',
  'workspace',
  'members',
  'teams',
  'billing',
  'api',
  'connections',
  'import',
  'security',
  'notifications',
] as const;
export type SettingsSectionKey = (typeof SETTINGS_SECTION_KEYS)[number] | 'admin';

export function settingsSectionKeys(isAdmin: boolean): SettingsSectionKey[] {
  return isAdmin ? [...SETTINGS_SECTION_KEYS, 'admin'] : [...SETTINGS_SECTION_KEYS];
}

export function settingsSectionHref(key: SettingsSectionKey): string {
  if (key === 'profile') return '/app/settings';
  if (key === 'admin') return SETTINGS_ADMIN_ROUTES[0];
  return `/app/settings/${key}`;
}

export interface SettingsNavItem extends RouteTab {
  href: string;
  /** Solo en el grupo Productos: la app (para el nombre y la muestra de color). */
  product?: ProductKey;
}

export interface SettingsNavGroup {
  key: 'account' | 'products';
  items: SettingsNavItem[];
}

/**
 * La nav lateral de /app/settings: "Cuenta y workspace" (una ruta por
 * sección) y "Productos" (una entrada por app hacia /app/<app>/settings).
 */
export function settingsSections(isAdmin: boolean): SettingsNavGroup[] {
  return [
    {
      key: 'account',
      items: settingsSectionKeys(isAdmin).map((key) =>
        key === 'admin'
          ? { key, href: SETTINGS_ADMIN_ROUTES[0], match: [...SETTINGS_ADMIN_ROUTES.slice(1)] }
          : { key, href: settingsSectionHref(key) },
      ),
    },
    {
      key: 'products',
      items: PRODUCT_KEYS.map((product) => ({ key: product, href: productSettingsHref(product), product })),
    },
  ];
}

/**
 * Secciones que todavía no tienen contenido propio: dónde está hoy lo
 * equivalente (la clave es el texto en settings.soon.<sección>.<label>).
 * Las tandas que llenan cada sección sacan su fila de acá.
 */
export const SETTINGS_ELSEWHERE: Partial<Record<SettingsSectionKey, Array<{ href: string; label: string }>>> = {
  workspace: [{ href: '/app/crm/settings?tab=team', label: 'members' }],
  members: [{ href: '/app/crm/settings?tab=team', label: 'crmTeam' }],
  teams: [{ href: '/app/crm/settings?tab=team', label: 'crmSalesTeams' }],
  import: [
    { href: '/app/crm/settings?tab=import', label: 'crm' },
    { href: '/app/track/settings?tab=import', label: 'track' },
    { href: '/app/calendar/settings?tab=import', label: 'cal' },
    { href: '/app/docs/import', label: 'docs' },
    { href: '/app/links/settings?tab=import', label: 'link' },
    { href: '/app/notes', label: 'notes' },
  ],
  security: [
    { href: '/app/settings/api', label: 'apiKeys' },
    { href: '/app/links/settings?tab=domains', label: 'domains' },
  ],
  notifications: [{ href: '/app/track/settings?tab=notifications', label: 'track' }],
};

/**
 * Anchors de cuando todo vivía en /app/settings y /app/settings/workspace:
 * cada uno cae en la sección nueva (con su anchor, si la sección tiene varias).
 */
export const LEGACY_SETTINGS_ANCHORS: Record<string, string> = {
  api: '/app/settings/api#api-keys',
  'api-keys': '/app/settings/api#api-keys',
  keys: '/app/settings/api#api-keys',
  webhooks: '/app/settings/api#webhooks',
  credentials: '/app/settings/connections#credentials',
  ai: '/app/settings/billing#ai',
  usage: '/app/settings/billing#ai',
  domains: '/app/links/settings?tab=domains',
  link: '/app/links/settings?tab=export',
  export: '/app/links/settings?tab=export',
  import: '/app/links/settings?tab=import',
};

/** Destino de un anchor viejo de Ajustes (`#api` en /app/settings/workspace), o null si no es uno. */
export function legacySettingsTarget(pathname: string, hash: string): string | null {
  if (pathname !== '/app/settings' && pathname !== '/app/settings/workspace') return null;
  const key = hash.replace(/^#/, '');
  return LEGACY_SETTINGS_ANCHORS[key] ?? null;
}

export type WebhookGroupKey =
  | 'booking'
  | 'link'
  | 'contact'
  | 'company'
  | 'deal'
  | 'task'
  | 'quote'
  | 'form'
  | 'robot'
  | 'chat'
  | 'groups'
  | 'issue'
  | 'comment'
  | 'project'
  | 'page'
  | 'database';

/** Los eventos agrupados por recurso (el prefijo antes del primer punto), en el orden de WEBHOOK_EVENTS. */
export function webhookEventGroups(
  events: readonly WebhookEvent[] = WEBHOOK_EVENTS,
): Array<{ key: WebhookGroupKey; events: WebhookEvent[] }> {
  const groups: Array<{ key: WebhookGroupKey; events: WebhookEvent[] }> = [];
  for (const ev of events) {
    const key = ev.split('.')[0] as WebhookGroupKey;
    const group = groups.find((g) => g.key === key);
    if (group) group.events.push(ev);
    else groups.push({ key, events: [ev] });
  }
  return groups;
}

/** Estado del checkbox de un grupo: todos, ninguno o algunos (indeterminado). */
export function groupState(group: readonly WebhookEvent[], selected: readonly WebhookEvent[]): 'all' | 'none' | 'some' {
  const n = group.filter((e) => selected.includes(e)).length;
  return n === 0 ? 'none' : n === group.length ? 'all' : 'some';
}

/** Click en el checkbox del grupo: si estaban todos, los saca; si no, los agrega todos. */
export function toggleGroup(group: readonly WebhookEvent[], selected: readonly WebhookEvent[]): WebhookEvent[] {
  if (groupState(group, selected) === 'all') return selected.filter((e) => !group.includes(e));
  const next = [...selected];
  for (const e of group) if (!next.includes(e)) next.push(e);
  return WEBHOOK_EVENTS.filter((e) => next.includes(e));
}

/** Porcentaje de la cuota de IA usado (0–100). Sin cuota (null) es 0; con cuota 0 y algo usado, 100. */
export function quotaPct(total: number, free: number | null): number {
  if (free === null) return 0;
  if (free === 0) return total > 0 ? 100 : 0;
  return Math.min(100, Math.round((total / free) * 100));
}
