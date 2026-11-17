/**
 * Social: programación masiva desde un CSV (como el Bulk Composer de
 * Hootsuite). Puro, sin DB: lo usa la pantalla de importar para la vista
 * previa y la ruta para volver a validar.
 *
 * Columnas, con o sin encabezado (en, es o pt; da igual el orden si hay
 * encabezado): fecha, hora (opcional si la fecha ya la trae), texto y link
 * (opcional). Sin encabezado: fecha, texto, link; o fecha, hora, texto, link
 * si la segunda columna es una hora. Separador coma o punto y coma.
 */
import { parseCsv } from './csv-parse';
import { zonedTime } from './groups-recurrence';
import { validateForNetwork, type SocialNetwork, type ValidationIssue } from './social-networks';

/** Igual que el Bulk Composer de Hootsuite: hasta 350 publicaciones por archivo. */
export const BULK_MAX_ROWS = 350;
/** Filas por pedido al servidor (la pantalla manda el archivo en tandas y muestra el avance). */
export const BULK_CHUNK = 25;

export type BulkRowError = 'date_invalid' | 'date_in_past' | 'text_empty' | 'link_invalid';

export interface BulkRow {
  /** Línea del archivo (1 = la primera), para decir dónde está el problema. */
  line: number;
  scheduledAt: string | null;
  text: string;
  linkUrl: string | null;
  errors: BulkRowError[];
}

export interface BulkParse {
  rows: BulkRow[];
  /** Filas que quedaron afuera por pasar el máximo. */
  skipped: number;
  /** El archivo no tiene ninguna columna de texto reconocible. */
  noText: boolean;
}

type Col = 'date' | 'time' | 'text' | 'link';

const HEADERS: Record<Col, string[]> = {
  date: ['date', 'fecha', 'data', 'day', 'dia', 'día', 'datetime', 'date time', 'scheduled', 'publish date'],
  time: ['time', 'hora', 'horario', 'horário', 'hour'],
  text: ['text', 'texto', 'message', 'mensaje', 'mensagem', 'post', 'content', 'contenido', 'conteúdo', 'conteudo', 'caption', 'copy'],
  link: ['link', 'url', 'enlace'],
};

const norm = (s: string) => s.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');

function headerMap(row: string[]): Partial<Record<Col, number>> | null {
  const map: Partial<Record<Col, number>> = {};
  row.forEach((cell, i) => {
    const h = norm(cell);
    for (const col of Object.keys(HEADERS) as Col[]) {
      if (map[col] === undefined && HEADERS[col].includes(h)) map[col] = i;
    }
  });
  return map.text !== undefined && map.date !== undefined ? map : null;
}

const TIME_RE = /^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*([ap])\.?\s*m?\.?$|^(\d{1,2}):(\d{2})(?::\d{2})?$/i;

/** "9:30", "09:30:00", "9:30 PM", "9pm" → minutos del día; null si no es una hora. */
export function parseTime(raw: string): number | null {
  const s = raw.trim();
  const m = TIME_RE.exec(s);
  if (!m) return null;
  let h: number;
  let min: number;
  if (m[4] !== undefined) {
    h = Number(m[4]);
    min = Number(m[5]);
  } else {
    h = Number(m[1]);
    min = Number(m[2] ?? 0);
    if (h < 1 || h > 12) return null;
    const pm = m[3].toLowerCase() === 'p';
    h = (h % 12) + (pm ? 12 : 0);
  }
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/**
 * Fecha (y hora, si viene pegada) → [año, mes, día, minutos | null].
 * Acepta 2026-11-20, 2026-11-20T09:30, 2026-11-20 09:30 y, con barras,
 * día/mes/año o mes/día/año según `dayFirst`.
 */
export function parseDate(raw: string, dayFirst: boolean): [number, number, number, number | null] | null {
  const s = raw.trim();
  let y: number;
  let mo: number;
  let d: number;
  let rest: string;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s]+(.*))?$/.exec(s);
  const slash = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})(?:[\s,]+(.*))?$/.exec(s);
  if (iso) {
    [y, mo, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
    rest = iso[4] ?? '';
  } else if (slash) {
    const [a, b] = [Number(slash[1]), Number(slash[2])];
    [d, mo] = dayFirst ? [a, b] : [b, a];
    y = Number(slash[3]);
    rest = slash[4] ?? '';
  } else return null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCMonth() !== mo - 1) return null;
  const clean = rest.replace(/(?:Z|[+-]\d{2}:?\d{2})$/, '').trim();
  if (!clean) return [y, mo, d, null];
  const minutes = parseTime(clean);
  return minutes === null ? null : [y, mo, d, minutes];
}

function delimiter(text: string): ',' | ';' {
  const first = text.replace(/^﻿/, '').split(/\r?\n/, 1)[0] ?? '';
  const outside = first.replace(/"[^"]*"/g, '');
  return (outside.match(/;/g)?.length ?? 0) > (outside.match(/,/g)?.length ?? 0) ? ';' : ',';
}

function validLink(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

/** El texto que sale: el link va al final si el texto no lo trae ya. */
export function bulkPostText(row: Pick<BulkRow, 'text' | 'linkUrl'>): string {
  if (!row.linkUrl || row.text.includes(row.linkUrl)) return row.text;
  return row.text ? `${row.text}\n\n${row.linkUrl}` : row.linkUrl;
}

/**
 * Lee el CSV y arma las filas con sus errores. Las horas se leen en `tz`;
 * una fecha sin hora es un error (no se adivina).
 */
export function parseBulkCsv(text: string, opts: { tz: string; dayFirst: boolean; now?: Date }): BulkParse {
  const sep = delimiter(text);
  const all = parseCsv(text, sep);
  if (!all.length) return { rows: [], skipped: 0, noText: true };
  let map = headerMap(all[0]);
  let start = 1;
  let firstLine = 2;
  if (!map) {
    start = 0;
    firstLine = 1;
    const second = all[0][1] ?? '';
    map = parseTime(second) !== null && all[0].length >= 3 ? { date: 0, time: 1, text: 2, link: 3 } : { date: 0, text: 1, link: 2 };
  }
  const now = (opts.now ?? new Date()).getTime();
  const body = all.slice(start);
  const rows = body.slice(0, BULK_MAX_ROWS).map((cells, i): BulkRow => {
    const get = (c: Col) => (map[c] !== undefined ? (cells[map[c]!] ?? '').trim() : '');
    const errors: BulkRowError[] = [];
    let scheduledAt: string | null = null;
    const date = parseDate(get('date'), opts.dayFirst);
    const timeRaw = get('time');
    const minutes = date ? (date[3] ?? (timeRaw ? parseTime(timeRaw) : null)) : null;
    if (!date || minutes === null) errors.push('date_invalid');
    else {
      const at = zonedTime(date[0], date[1], date[2], minutes, opts.tz);
      scheduledAt = at.toISOString();
      if (at.getTime() < now) errors.push('date_in_past');
    }
    const body = get('text').replace(/\r\n?/g, '\n');
    const link = get('link');
    if (link && !validLink(link)) errors.push('link_invalid');
    if (!body && !link) errors.push('text_empty');
    return { line: firstLine + i, scheduledAt, text: body, linkUrl: link && validLink(link) ? link : null, errors };
  });
  return { rows, skipped: Math.max(0, body.length - BULK_MAX_ROWS), noText: false };
}

/** Problemas de una fila en cada cuenta elegida (largo, foto obligatoria, etc.). */
export function bulkRowIssues(row: BulkRow, accounts: Array<{ id: string; network: SocialNetwork }>): Array<{ accountId: string; network: SocialNetwork; issues: ValidationIssue[] }> {
  const text = bulkPostText(row);
  return accounts.map((a) => ({ accountId: a.id, network: a.network, issues: validateForNetwork(a.network, text, []) })).filter((x) => x.issues.length);
}

/** CSV de ejemplo para bajar (fechas desde mañana, en el formato elegido). */
export function bulkExampleCsv(dayFirst: boolean, from = new Date()): string {
  const day = (n: number) => {
    const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + n));
    const [y, m, dd] = [d.getUTCFullYear(), String(d.getUTCMonth() + 1).padStart(2, '0'), String(d.getUTCDate()).padStart(2, '0')];
    return dayFirst ? `${dd}/${m}/${y}` : `${m}/${dd}/${y}`;
  };
  return ['date,time,text,link', `${day(1)},09:30,"First post of the week",https://example.com`, `${day(2)},18:00,"A second post, with a comma",`, ''].join('\r\n');
}
