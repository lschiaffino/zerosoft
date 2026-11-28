/**
 * Descargar el resultado de una pregunta en CSV, Excel (.xlsx) o JSON. Puro:
 * lo usan el navegador (las filas que ya se muestran) y la ruta que vuelve a
 * correr la consulta con un tope más alto (lib/bi/run.ts, BI_EXPORT_MAX_ROWS).
 */
import { buildXlsx, XLSX_MIME } from '../xlsx-writer';
import type { BiResult } from './types';

/** Filas como mucho al descargar: la consulta vuelve a correr con este tope (en pantalla se muestran 2.000). */
export const BI_EXPORT_MAX_ROWS = 20_000;

export const EXPORT_FORMATS = ['csv', 'xlsx', 'json'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export function isExportFormat(v: unknown): v is ExportFormat {
  return typeof v === 'string' && (EXPORT_FORMATS as readonly string[]).includes(v);
}

type Rows = Pick<BiResult, 'columns' | 'rows'>;

/** CSV con encabezado; las celdas que empiezan con =, +, -, @ van con ' para que la planilla no las tome como fórmula. */
export function toCsv(result: Rows): string {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    const safe = /^[=+\-@\t\r]/.test(s) && typeof v !== 'number' ? `'${s}` : s;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return [result.columns.map((c) => esc(c.name)).join(','), ...result.rows.map((r) => r.map(esc).join(','))].join('\n');
}

/** JSON: una lista de objetos { columna: valor }, como la descarga de Metabase. */
export function toJson(result: Rows): string {
  const names = result.columns.map((c) => c.name);
  return JSON.stringify(
    result.rows.map((r) => {
      const o: Record<string, unknown> = {};
      names.forEach((n, i) => {
        o[n] = r[i] ?? null;
      });
      return o;
    }),
    null,
    2,
  );
}

export function toXlsx(result: Rows, name: string): Uint8Array {
  return buildXlsx({
    name,
    header: result.columns.map((c) => c.name),
    rows: result.rows.map((r) => r.map((v) => (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || v === null ? v : v === undefined ? null : JSON.stringify(v)))),
    dateColumns: result.columns.flatMap((c, i) => (c.type === 'date' ? [i] : [])),
  });
}

/** Nombre del archivo: el de la pregunta sin caracteres raros, o "results". */
export function exportFilename(name: string | undefined, format: ExportFormat): string {
  const base =
    (name ?? '')
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9 _-]+/g, ' ')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 80) || 'results';
  return `${base}.${format}`;
}

export interface ExportFile {
  body: Uint8Array | string;
  mime: string;
  filename: string;
}

export function exportResult(result: Rows, format: ExportFormat, name?: string): ExportFile {
  const filename = exportFilename(name, format);
  if (format === 'xlsx') return { body: toXlsx(result, name || 'Results'), mime: XLSX_MIME, filename };
  if (format === 'json') return { body: toJson(result), mime: 'application/json;charset=utf-8', filename };
  // BOM: Excel abre el CSV en UTF-8 (acentos) en vez de adivinar la codificación.
  return { body: `﻿${toCsv(result)}`, mime: 'text/csv;charset=utf-8', filename };
}
