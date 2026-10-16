/**
 * Etiqueta de un día (YYYY-MM-DD) para el eje X de los gráficos: en el formato
 * del locale (3 oct / Oct 3) y con año cuando el rango cruza años, así dos
 * picos de años distintos no comparten etiqueta.
 */
export function chartDateLabel(date: string, locale: string, withYear: boolean): string {
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    ...(withYear ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  }).format(d);
}

/** true si las fechas (YYYY-MM-DD) no son todas del mismo año. */
export function spansYears(dates: string[]): boolean {
  return dates.length > 0 && dates[0].slice(0, 4) !== dates[dates.length - 1].slice(0, 4);
}
