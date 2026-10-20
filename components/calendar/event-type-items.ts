import type { EventTypeWithRules } from '@/lib/calendar';
import type { EventTypeListItem } from './EventTypesView';

/** Filas livianas para la lista de event types (server → client). */
export function toListItems(rows: EventTypeWithRules[]): EventTypeListItem[] {
  return rows.map((et) => ({
    id: et.id,
    title: et.title,
    slug: et.slug,
    durationMin: et.duration_min,
    color: et.color,
    active: et.active === 1,
    oneOff: et.one_off_times !== null && et.one_off_times !== undefined,
    used: !!et.used_at,
  }));
}

/** Origen público de la app (para armar links de reserva). */
export function publicOrigin(host: string | null): string {
  return (process.env.NEXTAUTH_URL ?? `https://${host ?? 'zerosoft.ai'}`).replace(/\/$/, '');
}
