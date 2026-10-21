/**
 * Ajustes globales (/app/settings): pestañas y grupos, en datos puros para
 * poder testearlos sin React.
 */
import { WEBHOOK_EVENTS, type WebhookEvent } from './webhooks-events';

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

/** Pestañas de Ajustes; Admin solo para ADMIN_EMAILS. */
export function settingsTabs(isAdmin: boolean): RouteTab[] {
  const tabs: RouteTab[] = [
    { key: 'account', href: '/app/settings' },
    { key: 'workspace', href: '/app/settings/workspace' },
  ];
  if (isAdmin) tabs.push({ key: 'admin', href: SETTINGS_ADMIN_ROUTES[0], match: [...SETTINGS_ADMIN_ROUTES.slice(1)] });
  return tabs;
}

export type WebhookGroupKey = 'booking' | 'link' | 'contact' | 'deal' | 'robot' | 'chat';

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
