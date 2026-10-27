/**
 * Cal — qué reservas ve y gestiona cada persona (modelo de Cal.com): owner y
 * admins, todas las del workspace; un member, solo las que atiende (anfitrión
 * o co-anfitrión de un evento colectivo). Vale igual para la app, la API v1 y
 * el servidor MCP (las API keys actúan con el rol de quien las creó). Puro.
 */
import { roleAtLeast, type TeamRole } from './teams';
import type { CalendarBookingRow } from './db';

/** null = ve todas; un id = solo las reservas que atiende esa persona. */
export function bookingScopeFor(role: TeamRole | null | undefined, personId: string): string | null {
  return role && roleAtLeast(role, 'admin') ? null : personId;
}

/** La reserva entra en el alcance (anfitriona o co-anfitriona). */
export function bookingInScope(booking: Pick<CalendarBookingRow, 'host_user_id' | 'co_host_ids'>, scope: string | null): boolean {
  if (scope === null) return true;
  if (booking.host_user_id === scope) return true;
  try {
    const co: unknown = JSON.parse(booking.co_host_ids || '[]');
    return Array.isArray(co) && co.includes(scope);
  } catch {
    return false;
  }
}
