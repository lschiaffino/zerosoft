/**
 * Lo que la pantalla de Inbox consulta cada pocos segundos (el chat abierto,
 * la lista, la barra) responde 304 sin leer la base si nada cambió. Cada
 * cambio de Inbox sube un número de versión, lo mantienen triggers de la base
 * (migración 390_inbox_revisions):
 * - inbox_threads.rev: el chat (sus mensajes, envíos programados, carpetas y
 *   el chat mismo);
 * - inbox_rev.rev: todo lo de la persona (chats, cuentas, carpetas, snippets).
 * Leer la versión es una fila por clave primaria. Lo que depende del reloj
 * (pospuestos que vuelven, nombres de contactos) se arma de nuevo igual una
 * vez por minuto. Server-only.
 */
import { NextResponse } from 'next/server';
import { getDb } from '../db';
import { etagMatches } from '../etag';

const NO_STORE = {
  'cache-control': 'private, no-store',
  'x-robots-tag': 'noindex, nofollow',
  'referrer-policy': 'no-referrer',
};

/** Ventana después de la cual se arma de nuevo aunque no haya cambios. */
export const REBUILD_MS = 60_000;

export function minuteBucket(now = Date.now()): number {
  return Math.floor(now / REBUILD_MS);
}

export function versionTag(kind: string, rev: number, extra = '', now = Date.now()): string {
  const safe = extra.replace(/[^\w.:=&,-]/g, '_').slice(0, 300);
  return `W/"${kind}-${rev}-${minuteBucket(now)}${safe ? `-${safe}` : ''}"`;
}

export async function ownerRev(owner: string): Promise<number> {
  const r = (await getDb().prepare('SELECT rev FROM inbox_rev WHERE owner_id = ?').get(owner)) as { rev: number } | undefined;
  return Number(r?.rev ?? 0);
}

/** null: el chat no existe o no es de la persona (que lo resuelva el camino normal, con su 404). */
export async function threadRev(owner: string, id: string): Promise<number | null> {
  const r = (await getDb().prepare('SELECT rev FROM inbox_threads WHERE id = ? AND owner_id = ?').get(id, owner)) as { rev: number } | undefined;
  return r ? Number(r.rev ?? 0) : null;
}

/** 304 si quien pide ya tiene esta versión; si no, arma la respuesta y la manda con esa versión. */
export async function versioned<T>(req: Request, tag: string, build: () => Promise<T>): Promise<NextResponse> {
  if (etagMatches(req, tag))
    return new NextResponse(null, {
      status: 304,
      headers: { ...NO_STORE, etag: tag },
    });
  const body = await build();
  return NextResponse.json(body, {
    status: 200,
    headers: { ...NO_STORE, etag: tag },
  });
}
