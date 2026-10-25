/**
 * CRM — etiquetas de los períodos de los gráficos (puro: lo usan Reports y
 * Dashboards). Las claves vienen de SQLite: 2026-10-20 (día), 2026-W42
 * (semana con lunes de inicio, %W), 2026-10 (mes) y 2026-Q4 (trimestre).
 */

const DAY_MS = 86_400_000;

/** Lunes con que arranca la semana %W de SQLite (la semana 00 arranca el 1 de enero). */
export function weekBucketStart(bucket: string): Date | null {
  const m = /^(\d{4})-W(\d{2})$/.exec(bucket);
  if (!m) return null;
  const year = Number(m[1]);
  const week = Number(m[2]);
  const jan1 = Date.UTC(year, 0, 1);
  const jan1Dow = new Date(jan1).getUTCDay(); // 0 = domingo
  const firstMonday = jan1 + ((8 - jan1Dow) % 7) * DAY_MS;
  if (week === 0) return new Date(jan1);
  return new Date(firstMonday + (week - 1) * 7 * DAY_MS);
}

export function monthLabel(month: string, locale: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 1)));
}

/** Etiqueta legible por locale: "Oct 20" / "20 oct" para días y semanas (su lunes), "oct" para meses, "Q4 2026". */
export function bucketLabel(bucket: string, locale: string): string {
  const day = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' });
  if (/^\d{4}-\d{2}-\d{2}$/.test(bucket)) return day.format(new Date(`${bucket}T00:00:00Z`));
  const week = weekBucketStart(bucket);
  if (week) return day.format(week);
  if (/^\d{4}-\d{2}$/.test(bucket)) return monthLabel(bucket, locale);
  const q = /^(\d{4})-Q([1-4])$/.exec(bucket);
  if (q) return `${locale.startsWith('en') ? 'Q' : 'T'}${q[2]} ${q[1]}`;
  return bucket;
}
