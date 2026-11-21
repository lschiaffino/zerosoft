/**
 * Send: índice numerado de un espacio (el "indexing" de las salas de datos de
 * DocSend). Puro, sin base: lo usan el servidor, la página del espacio y el visor.
 *
 * Los números siguen el orden en que el visor muestra el espacio: las carpetas en el
 * orden de su primera aparición, y dentro de cada una sus documentos en orden. Un
 * documento suelto es "3"; una carpeta "2" y sus documentos "2.1", "2.2". Se calculan sobre todos los documentos del espacio, así
 * cada persona ve los mismos números aunque solo vea algunos.
 */
import { csvLine } from '../form-engine';

export interface IndexInput {
  documentId: string;
  folder: string;
}

export interface SpaceIndex {
  /** Número de cada documento ("1", "2.3"). */
  documents: Record<string, string>;
  /** Número de cada carpeta con nombre ("2"). */
  folders: Record<string, string>;
}

export function spaceIndex(items: IndexInput[]): SpaceIndex {
  // Mismos grupos que el visor: una carpeta por nombre, en el orden de su primera aparición;
  // los documentos sueltos van juntos donde aparece el primero, cada uno con su número.
  const groups = new Map<string, string[]>();
  for (const it of items) {
    const list = groups.get(it.folder);
    if (list) list.push(it.documentId);
    else groups.set(it.folder, [it.documentId]);
  }
  const out: SpaceIndex = { documents: {}, folders: {} };
  let n = 0;
  for (const [folder, ids] of groups) {
    if (!folder) {
      for (const id of ids) out.documents[id] = String(++n);
      continue;
    }
    out.folders[folder] = String(++n);
    ids.forEach((id, i) => {
      out.documents[id] = `${n}.${i + 1}`;
    });
  }
  return out;
}

/** Ordena "1", "1.2", "10" como números y no como texto. */
export function compareIndex(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

export interface IndexCsvRow {
  index: string;
  folder: string;
  title: string;
  kind: string;
  pages: number | string;
}

/** CSV del índice: una fila por carpeta y una por documento, en orden. */
export function spaceIndexCsv(rows: IndexCsvRow[], folders: Record<string, string>): string {
  const lines = [csvLine(['index', 'folder', 'name', 'type', 'pages'])];
  const all: IndexCsvRow[] = [
    ...Object.entries(folders)
      .filter(([f]) => rows.some((r) => r.folder === f))
      .map(([f, index]) => ({ index, folder: '', title: f, kind: 'folder', pages: '' })),
    ...rows,
  ].sort((x, y) => compareIndex(x.index, y.index));
  for (const r of all) lines.push(csvLine([r.index, r.folder, r.title, r.kind, r.pages]));
  return `${lines.join('\r\n')}\r\n`;
}
