/** Server: los límites en UTC de un rango de días de los filtros rápidos (lib/crm-date-presets.ts). */
import { dayStartUtc } from './crm-filters';
import { addDays, type ResolvedRange } from './crm-date-presets';

/**
 * Desde el comienzo de `from` (inclusive) hasta el comienzo del día siguiente a
 * `to` (exclusivo), en la zona horaria de la persona, en el formato de la base.
 */
export function utcBounds(range: ResolvedRange, timeZone?: string): { after?: string; before?: string } {
  const tz = timeZone || 'UTC';
  return {
    after: range.from ? dayStartUtc(range.from, tz) : undefined,
    before: range.to ? dayStartUtc(addDays(range.to, 1), tz) : undefined,
  };
}
