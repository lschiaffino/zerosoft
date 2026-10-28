/** Eventos de webhooks salientes (puro: lo usan el servidor y la UI de Ajustes). */
export const WEBHOOK_EVENTS = [
  'booking.created',
  'booking.rescheduled',
  'booking.cancelled',
  'booking.no_show',
  'booking.requested',
  'link.created',
  'link.clicked',
  'link.updated',
  'link.deleted',
  'link.lead',
  'link.sale',
  'contact.created',
  'contact.updated',
  'contact.property_changed',
  'contact.deleted',
  'company.created',
  'company.updated',
  'company.property_changed',
  'company.deleted',
  'deal.created',
  'deal.updated',
  'deal.property_changed',
  'deal.stage_changed',
  'deal.won',
  'deal.lost',
  'deal.deleted',
  'task.created',
  'task.completed',
  'quote.accepted',
  'quote.paid',
  'form.submitted',
  'robot.run.finished',
  'robot.run.failed',
  'robot.output.changed',
  'chat.message.created',
  'chat.conversation.assigned',
  'chat.conversation.resolved',
  'chat.conversation.created',
  'chat.conversation.tagged',
  'chat.csat.submitted',
  'groups.message.received',
  'groups.ticket.created',
  'groups.ticket.updated',
  'groups.message.sent',
  'groups.chat.created',
  'groups.chat.assigned',
  'groups.chat.closed',
  'groups.member.joined',
  'groups.member.left',
  'groups.poll.voted',
  'issue.created',
  'issue.updated',
  'issue.status_changed',
  'issue.deleted',
  'comment.created',
  'project.created',
  'project.updated',
  'project.deleted',
  'page.created',
  'page.updated',
  'page.archived',
  'page.comment_created',
  'database.row_created',
  'database.property_changed',
  'talk.message.posted',
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

// ---------- Filtro de links (eventos link.*) ----------

/**
 * A qué links se limita un webhook en los eventos link.*. Una lista vacía no
 * filtra; con varias, el link tiene que cumplir todas (y dentro de cada lista,
 * alguno de los valores). `domains` usa el hostname del dominio propio y ''
 * para el dominio por defecto. Los demás eventos no se filtran.
 */
export interface LinkWebhookFilter {
  linkIds: string[];
  tags: string[];
  domains: string[];
}

/** Lo que el filtro mira de un link (sale del payload del evento). */
export interface LinkScope {
  id: string;
  tags: string[];
  /** null = dominio por defecto. */
  domain: string | null;
}

export const MAX_FILTER_VALUES = 50;

function cleanList(raw: unknown, lower: boolean): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== 'string') continue;
    const s = (lower ? v.trim().toLowerCase() : v.trim()).slice(0, 253);
    if (!out.includes(s)) out.push(s);
  }
  return out.slice(0, MAX_FILTER_VALUES);
}

/** Normaliza un filtro (sin duplicados, dominios en minúscula). Vacío del todo = null (todos los links). */
export function normalizeLinkFilter(raw: unknown): LinkWebhookFilter | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const filter: LinkWebhookFilter = {
    linkIds: cleanList(r.linkIds, false).filter(Boolean),
    tags: cleanList(r.tags, false).filter(Boolean),
    // '' es el dominio por defecto: se conserva.
    domains: cleanList(r.domains, true),
  };
  return filter.linkIds.length || filter.tags.length || filter.domains.length ? filter : null;
}

export function parseLinkFilter(json: string | null | undefined): LinkWebhookFilter | null {
  if (!json) return null;
  try {
    return normalizeLinkFilter(JSON.parse(json));
  } catch {
    return null;
  }
}

/** El link del evento pasa el filtro (sin filtro, siempre). */
export function matchesLinkFilter(filter: LinkWebhookFilter | null, link: LinkScope | null): boolean {
  if (!filter) return true;
  if (!link) return false;
  if (filter.linkIds.length && !filter.linkIds.includes(link.id)) return false;
  if (filter.tags.length && !link.tags.some((t) => filter.tags.includes(t))) return false;
  if (filter.domains.length && !filter.domains.includes((link.domain ?? '').toLowerCase())) return false;
  return true;
}

/** Saca el link de un payload link.* ({ link: { id, tags, domain } }). */
export function linkScopeOf(data: unknown): LinkScope | null {
  const link = (data as { link?: unknown } | null)?.link as Record<string, unknown> | undefined;
  if (!link || typeof link.id !== 'string') return null;
  return {
    id: link.id,
    tags: Array.isArray(link.tags) ? link.tags.filter((t): t is string => typeof t === 'string') : [],
    domain: typeof link.domain === 'string' ? link.domain : null,
  };
}

// ---------- Filtro de propiedades (eventos *.property_changed) ----------

/**
 * Como las suscripciones `propertyChange` de HubSpot: un webhook puede
 * limitarse a ciertas propiedades (columna o `custom.<nombre>`). Vacío = todas.
 */
export interface CrmWebhookFilter {
  properties: string[];
}

export function normalizeCrmFilter(raw: unknown): CrmWebhookFilter | null {
  if (!raw || typeof raw !== 'object') return null;
  const props = cleanList((raw as Record<string, unknown>).properties, false)
    .map((p) => p.replace(/\s+/g, ''))
    .filter((p) => /^(custom\.)?[\w-]{1,60}$/.test(p));
  return props.length ? { properties: [...new Set(props)] } : null;
}

export function parseCrmFilter(json: string | null | undefined): CrmWebhookFilter | null {
  if (!json) return null;
  try {
    return normalizeCrmFilter(JSON.parse(json));
  } catch {
    return null;
  }
}

/** El cambio de propiedad pasa el filtro (sin filtro, siempre; otros eventos, siempre). */
export function matchesCrmFilter(filter: CrmWebhookFilter | null, event: string, data: unknown): boolean {
  if (!filter || !event.endsWith('.property_changed')) return true;
  const property = (data as { property?: unknown } | null)?.property;
  return typeof property === 'string' && filter.properties.includes(property);
}
