/**
 * CSV → filas. Puro (sin DB): lo usan los importadores en el servidor y en el
 * navegador (encabezados del CSV antes de mapear columnas).
 */

/**
 * Parser CSV mínimo (comillas, separadores y saltos de línea dentro de
 * comillas). `delimiter` es ',' salvo que se pida ';' (Excel en es y pt).
 */
export function parseCsv(text: string, delimiter: ',' | ';' = ','): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}
