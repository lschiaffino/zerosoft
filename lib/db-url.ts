import path from 'path';

/** Archivo SQLite local que se usa cuando no hay una base remota configurada. */
export const LOCAL_DB_PATH = path.join(process.cwd(), 'data', 'zerosoftware.db');

/**
 * URL de la base: TURSO_DATABASE_URL, o el archivo SQLite local si no está.
 * Una variable vacía (`TURSO_DATABASE_URL=` en .env.example y
 * .env.offline.example) cuenta como no configurada: con `??` llegaba '' a
 * libsql y toda página que leía la base fallaba con URL_INVALID.
 */
export function databaseUrl(env: Record<string, string | undefined> = process.env): string {
  const url = env.TURSO_DATABASE_URL?.trim();
  return url ? url : `file:${LOCAL_DB_PATH}`;
}
