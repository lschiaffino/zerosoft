import { spaceIndexCsv, type IndexCsvRow } from '@/lib/send/space-index';

/** Baja el índice del espacio como CSV, armado en el navegador con lo que la persona ve. */
export function downloadIndexCsv(title: string, rows: IndexCsvRow[]): void {
  const folders: Record<string, string> = {};
  for (const r of rows) if (r.folder && r.index.includes('.')) folders[r.folder] = r.index.split('.')[0];
  const csv = spaceIndexCsv(rows, folders);
  const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${title.replace(/[^\p{L}\p{N} _-]+/gu, '').trim().slice(0, 80) || 'space'} index.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
