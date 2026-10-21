/**
 * CSV del alta masiva. Módulo puro (sin db ni crypto): lo usa la página de
 * alta masiva en el cliente para descargar los resultados que ya tiene, sin
 * volver a crear nada.
 */
import { isValidSlug } from './reserved';
import { isValidUrl, normalizeUrl } from './utils';

export interface BulkResultItem {
  url: string;
  short_url: string;
  status: 'created' | 'error';
  error?: string;
  /** Slug y título pedidos en la fila (si vinieron). */
  slug?: string;
  title?: string;
}

/** Una fila del alta masiva: URL y, opcionales, slug y título propios. */
export interface BulkRow {
  url: string;
  slug?: string;
  title?: string;
}

const SLUG_CELL = /^[A-Za-z0-9_-]{0,32}$/;

/**
 * Filas del alta masiva, una por línea: `url`, o `url, slug, título` (con
 * comas o tabs, como sale de una planilla). Con tabs las columnas son
 * exactas. Con comas, la segunda columna tiene que parecer un slug (letras,
 * números, - y _) y, si la URL tiene query, la coma tiene que venir con un
 * espacio: si no, la coma es parte de la URL y la línea entera es la URL. El título es el resto de la línea (puede tener comas). Las líneas
 * vacías se ignoran.
 */
export function parseBulkLines(text: string): BulkRow[] {
  const rows: BulkRow[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    let url = line;
    let slug = '';
    let title = '';
    if (line.includes('\t')) {
      const [a = '', b = '', ...rest] = line.split('\t');
      url = a.trim();
      slug = b.trim();
      title = rest.join(' ').trim();
    } else {
      const m = /^(\S+?),(\s*)([^,]*?)\s*(?:,(.*))?$/.exec(line);
      // Una URL con query puede tener comas propias (?ids=1,2,3): ahí la
      // coma separa columnas solo si viene con espacio (", slug").
      if (m && SLUG_CELL.test(m[3]) && (m[2] !== '' || !m[1].includes('?'))) {
        url = m[1];
        slug = m[3];
        title = (m[4] ?? '').trim();
      }
    }
    const row: BulkRow = { url };
    if (slug) row.slug = slug;
    if (title) row.title = title.slice(0, 200);
    rows.push(row);
  }
  return rows;
}

/** Revisión previa de una fila (en el cliente, antes de crear). */
export interface BulkRowCheck extends BulkRow {
  /** null si se ve bien; si no, el código de error (mismos que el server). */
  problem: 'invalid_url' | 'invalid_slug' | 'duplicate_slug' | null;
}

/**
 * Revisa cada fila con las mismas reglas que el alta (URL válida, slug con
 * formato y no reservado) y marca slugs repetidos dentro del lote. Que el slug
 * esté libre lo confirma el server al crear.
 */
export function checkBulkRows(rows: BulkRow[], opts: { customDomain?: boolean } = {}): BulkRowCheck[] {
  const seen = new Set<string>();
  return rows.map((row) => {
    let problem: BulkRowCheck['problem'] = null;
    const normalized = normalizeUrl(row.url);
    if (normalized.length > 2000 || !isValidUrl(normalized)) problem = 'invalid_url';
    else if (row.slug && !isValidSlug(row.slug, !!opts.customDomain)) problem = 'invalid_slug';
    else if (row.slug) {
      if (seen.has(row.slug)) problem = 'duplicate_slug';
      seen.add(row.slug);
    }
    return { ...row, problem };
  });
}

export function bulkResultsToCsv(rows: BulkResultItem[]): string {
  const lines = ['original_url,short_url,status,title'];
  for (const row of rows) {
    lines.push(
      [csvCell(row.url), csvCell(row.short_url), csvCell(row.error ?? row.status), csvCell(row.title ?? '')].join(','),
    );
  }
  return lines.join('\n');
}

/** Mismo criterio que csvSafe de lib/track (acá sin imports de servidor): = + - @ no abren fórmulas. */
function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  const escaped = safe.replace(/"/g, '""');
  if (/[",\n\r]/.test(escaped)) return `"${escaped}"`;
  return escaped;
}
