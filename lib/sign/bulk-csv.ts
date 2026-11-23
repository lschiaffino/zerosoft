/**
 * Sign: columnas del CSV del envío masivo. Lo usan el servidor (bulkSend) y
 * el editor de plantillas (para mostrar qué roles llegan del CSV), así que no
 * importa nada del servidor.
 *
 * - `name` y `email` completan el primer rol que firma (como antes).
 * - `<rol> name` y `<rol> email` completan ese rol (por ejemplo
 *   "Manager name", "manager_email"); un rol con sus columnas no usa el valor
 *   fijo.
 * - `title` y `message`, opcionales, cambian el título y el mensaje de cada
 *   sobre.
 */

export interface BulkRole {
  key: string;
  name: string;
  role: string;
}

export interface BulkColumns {
  /** roleKey → índices de las columnas de nombre y email. */
  roles: Record<string, { name: number; email: number }>;
  title: number;
  message: number;
  /** Roles con una sola de las dos columnas (nombre sin email o al revés). */
  incomplete: string[];
}

/** "Manager_Email" → "manager email": minúsculas, separadores como espacio. */
export function normalizeHeader(h: string): string {
  return h
    .replace(/^﻿/, '')
    .trim()
    .toLowerCase()
    .replace(/[\s_.\-]+/g, ' ')
    .trim();
}

/** A qué rol va cada columna del encabezado. */
export function bulkColumns(roles: BulkRole[], header: string[]): BulkColumns {
  const cols = header.map(normalizeHeader);
  const find = (name: string) => cols.indexOf(name);
  const out: BulkColumns = { roles: {}, title: find('title'), message: find('message'), incomplete: [] };
  for (const r of roles) {
    const base = normalizeHeader(r.name);
    if (!base) continue;
    const name = find(`${base} name`);
    const email = find(`${base} email`);
    if (name >= 0 && email >= 0) out.roles[r.key] = { name, email };
    else if (name >= 0 || email >= 0) out.incomplete.push(r.name);
  }
  const first = roles.find((r) => r.role === 'signer');
  const plainName = find('name');
  const plainEmail = find('email');
  if (first && !out.roles[first.key] && plainName >= 0 && plainEmail >= 0) out.roles[first.key] = { name: plainName, email: plainEmail };
  return out;
}

function csvCell(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Encabezado con dos columnas por rol, para empezar una lista con todos los roles. */
export function bulkHeaderFor(roles: BulkRole[]): string {
  return roles.flatMap((r) => [csvCell(`${r.name} name`), csvCell(`${r.name} email`)]).join(',');
}

/** Una fila de celdas como línea CSV (para mandar el archivo en tandas sin cortar celdas con saltos de línea). */
export function csvLine(cells: string[]): string {
  return cells.map(csvCell).join(',');
}
