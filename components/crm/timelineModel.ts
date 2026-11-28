/**
 * Lógica pura del timeline de la ficha (la usan el componente y los tests): pestañas, filtros por tipo y
 * por persona, búsqueda, actividad de asociados y agrupado (Fijada, Próximas, Este mes, por mes).
 */
import { parseDbUtc } from '@/lib/utils';

export const TIMELINE_TYPES = ['note', 'email', 'call', 'task', 'meeting', 'whatsapp'] as const;
export type TimelineType = (typeof TIMELINE_TYPES)[number];
export type TimelineTab = 'all' | TimelineType;

export interface ModelItem {
  id: string;
  type: string;
  subject: string;
  body: string;
  due_at: string | null;
  created_at: string;
  done: 0 | 1;
  pinned: 0 | 1;
  rollup?: 0 | 1;
  author_id?: string;
  author_name?: string | null;
  contact_name?: string | null;
  company_name?: string | null;
  deal_name?: string | null;
  from_email?: string;
  thread?: { subject?: string; messages: Array<{ subject?: string; snippet?: string; from?: string }> };
  wa?: { messages: Array<{ who: string; text: string }> };
}

export interface TimelineFilters {
  tab: TimelineTab;
  /** Tipos tildados en "Filtrar actividad" (solo cuentan en la pestaña Actividad). */
  types: readonly TimelineType[];
  /** null = todas las personas. */
  users: readonly string[] | null;
  query: string;
  /** Mostrar la actividad de registros asociados. */
  associated: boolean;
  /** Mostrar los cambios de propiedades (en "Toda la actividad"); sin el dato, se muestran. */
  changes?: boolean;
}

/** Minúsculas y sin acentos, para buscar "reunion" y encontrar "Reunión". */
export function normalize(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function haystack(i: ModelItem): string {
  const parts = [i.subject, i.body, i.author_name, i.contact_name, i.company_name, i.deal_name, i.from_email];
  for (const m of i.thread?.messages ?? []) parts.push(m.subject, m.snippet, m.from);
  for (const m of i.wa?.messages ?? []) parts.push(m.who, m.text);
  return normalize(parts.filter(Boolean).join('\n'));
}

export function matchesQuery(i: ModelItem, query: string): boolean {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const h = haystack(i);
  return words.every((w) => h.includes(w));
}

/** Lo que queda a la vista con la actividad de asociados prendida o apagada (antes de pestañas y filtros). */
export function scopeItems<T extends ModelItem>(items: T[], associated: boolean): T[] {
  return associated ? items : items.filter((i) => !i.rollup);
}

export function applyFilters<T extends ModelItem>(items: T[], f: TimelineFilters): T[] {
  return scopeItems(items, f.associated).filter((i) => {
    if (f.tab !== 'all' && i.type !== f.tab) return false;
    // Los cambios de propiedades van en "Toda la actividad", con su propia casilla en vez del filtro por tipo.
    if (i.type === 'change' && f.changes === false) return false;
    if (f.tab === 'all' && i.type !== 'change' && !f.types.includes(i.type as TimelineType)) return false;
    if (f.users && !(i.author_id && f.users.includes(i.author_id))) return false;
    return matchesQuery(i, f.query);
  });
}

export function tabCounts(items: ModelItem[], associated: boolean): Record<TimelineTab, number> {
  const out = { all: 0, note: 0, email: 0, call: 0, task: 0, meeting: 0, whatsapp: 0 } as Record<TimelineTab, number>;
  for (const i of scopeItems(items, associated)) {
    // Un cambio de propiedad no es actividad: no suma.
    if (i.type === 'change') continue;
    out.all += 1;
    if (i.type in out) out[i.type as TimelineType] += 1;
  }
  return out;
}

/** Personas que registraron algo en el timeline, por nombre. */
export function timelineAuthors(items: ModelItem[]): Array<{ id: string; name: string }> {
  const seen = new Map<string, string>();
  for (const i of items) if (i.author_id && !seen.has(i.author_id)) seen.set(i.author_id, i.author_name || '');
  return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}

export function when(i: ModelItem): Date {
  return parseDbUtc(i.due_at ?? i.created_at);
}

/**
 * Va en "Próximas", arriba, como en HubSpot: toda tarea abierta con vencimiento (también las vencidas, que
 * así no se hunden en su mes) y las reuniones por venir.
 */
export function isUpcoming(i: ModelItem, now: Date): boolean {
  if (!i.due_at) return false;
  if (i.type === 'task') return !i.done;
  if (i.type !== 'meeting') return false;
  return parseDbUtc(i.due_at).getTime() > now.getTime();
}

export type GroupKind = 'pinned' | 'upcoming' | 'thisMonth' | 'month';

export interface TimelineGroup<T> {
  key: string;
  kind: GroupKind;
  /** Primer día del mes (kind 'month'), en la hora local. */
  month?: Date;
  items: T[];
}

/**
 * Grupos en orden: Fijada, Próximas (de la más cercana a la más lejana), Este mes y un grupo por mes
 * hacia atrás. Los meses salen de la hora local de quien mira.
 */
export function groupTimeline<T extends ModelItem>(items: T[], now: Date): TimelineGroup<T>[] {
  const pinned: T[] = [];
  const upcoming: T[] = [];
  const months = new Map<string, TimelineGroup<T>>();
  const thisKey = `${now.getFullYear()}-${now.getMonth()}`;
  for (const i of items) {
    if (i.pinned) {
      pinned.push(i);
      continue;
    }
    if (isUpcoming(i, now)) {
      upcoming.push(i);
      continue;
    }
    const d = when(i);
    const own = `${d.getFullYear()}-${d.getMonth()}`;
    // Lo fechado más adelante que no es "próximo" (una llamada registrada para mañana) cuenta en este mes.
    const key = own === thisKey || d.getTime() > now.getTime() ? 'thisMonth' : own;
    let g = months.get(key);
    if (!g) {
      g = key === 'thisMonth'
        ? { key, kind: 'thisMonth', items: [] }
        : { key, kind: 'month', month: new Date(d.getFullYear(), d.getMonth(), 1), items: [] };
      months.set(key, g);
    }
    g.items.push(i);
  }
  upcoming.sort((a, b) => when(a).getTime() - when(b).getTime());
  const out: TimelineGroup<T>[] = [];
  if (pinned.length) out.push({ key: 'pinned', kind: 'pinned', items: pinned });
  if (upcoming.length) out.push({ key: 'upcoming', kind: 'upcoming', items: upcoming });
  const ordered = [...months.values()];
  ordered.sort((a, b) => {
    if (a.kind === 'thisMonth') return -1;
    if (b.kind === 'thisMonth') return 1;
    return (b.month?.getTime() ?? 0) - (a.month?.getTime() ?? 0);
  });
  for (const g of ordered) {
    g.items.sort((a, b) => when(b).getTime() - when(a).getTime());
    out.push(g);
  }
  return out;
}

/** "hace 3 días", "en 2 horas": la unidad más grande que tenga sentido. */
export function relativeTime(d: Date, now: Date, locale: string): string {
  const diff = (d.getTime() - now.getTime()) / 1000;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (abs < 60) return rtf.format(Math.round(diff), 'second');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day');
  if (abs < 86400 * 365) return rtf.format(Math.round(diff / (86400 * 30)), 'month');
  return rtf.format(Math.round(diff / (86400 * 365)), 'year');
}
