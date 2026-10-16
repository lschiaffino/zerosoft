/**
 * CSV del alta masiva. Módulo puro (sin db ni crypto): lo usa la página de
 * alta masiva en el cliente para descargar los resultados que ya tiene, sin
 * volver a crear nada.
 */

export interface BulkResultItem {
  url: string;
  short_url: string;
  status: 'created' | 'error';
  error?: string;
}

export function bulkResultsToCsv(rows: BulkResultItem[]): string {
  const lines = ['original_url,short_url,status'];
  for (const row of rows) {
    lines.push([csvCell(row.url), csvCell(row.short_url), csvCell(row.error ?? row.status)].join(','));
  }
  return lines.join('\n');
}

function csvCell(value: string): string {
  const escaped = value.replace(/"/g, '""');
  if (/[",\n\r]/.test(escaped)) return `"${escaped}"`;
  return escaped;
}
