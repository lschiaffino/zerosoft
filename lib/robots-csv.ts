/**
 * Robots — tablas de una corrida a CSV (botón "Descargar CSV" del detalle).
 * Sin dependencias de servidor: lo usa el navegador.
 *
 * Inyección de fórmulas: una celda que empieza con = + - @ (o tab / retorno)
 * la ejecutaría Excel o Sheets al abrir el archivo. Se le antepone una
 * comilla simple, que la deja como texto.
 */

/** Columnas y filas de un valor extraído; null si no es una lista. */
export function tableFromValue(v: unknown): { head: string[]; rows: unknown[][] } | null {
  if (!Array.isArray(v) || v.length === 0) return null;
  if (v.every((r) => Array.isArray(r))) {
    const width = Math.max(...v.map((r) => (r as unknown[]).length));
    return {
      head: Array.from({ length: width }, (_, i) => String(i + 1)),
      rows: (v as unknown[][]).map((r) => Array.from({ length: width }, (_, i) => r[i])),
    };
  }
  if (v.every((r) => r && typeof r === 'object')) {
    const head = [...new Set(v.flatMap((r) => Object.keys(r as object)))];
    return { head, rows: v.map((r) => head.map((h) => (r as Record<string, unknown>)[h])) };
  }
  return { head: ['value'], rows: v.map((r) => [r]) };
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return '';
  }
}

/** Una celda CSV: neutraliza fórmulas y escapa comillas, comas y saltos de línea. */
export function csvCell(v: unknown): string {
  let s = cellText(v);
  // Un número de verdad (-5) no es una fórmula; un texto "-5+A1", sí.
  if (typeof v !== 'number' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(head: readonly string[], rows: readonly (readonly unknown[])[]): string {
  return [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/** CSV de una variable extraída (null si no es una tabla). */
export function valueToCsv(v: unknown): string | null {
  const t = tableFromValue(v);
  return t ? toCsv(t.head, t.rows) : null;
}

/** Nombre del archivo: robot-variable-fecha.csv, solo caracteres seguros. */
export function csvFilename(robotName: string, varName: string, createdAt: string): string {
  const slug = (s: string) =>
    s
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase()
      .slice(0, 40);
  const day = createdAt.slice(0, 10).replace(/[^0-9-]/g, '');
  return `${[slug(robotName) || 'robot', slug(varName) || 'data', day].filter(Boolean).join('-')}.csv`;
}
