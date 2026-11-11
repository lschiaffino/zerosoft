'use client';

import { isInboxView, type InboxView } from '@/lib/inbox/types';

/**
 * Rutas de la bandeja de Inbox: /app/inbox (bandeja), /app/inbox/v/<vista> y
 * /app/inbox/f/<carpeta>. Todas las sirve la misma página y la misma
 * pantalla (InboxApp), que lee la vista o carpeta de la URL: pasar de una a
 * otra solo cambia la lista (ver components/app/shallowNav.ts).
 */
export interface InboxRoute {
  view: InboxView;
  folderId: string | null;
}

const ROUTE = /(^|\/)app\/inbox(?:\/(v|f)\/([^/?#]+))?\/?$/;

/** La vista o carpeta de una ruta (con o sin prefijo de idioma); null si no es una lista de la bandeja (p. ej. Ajustes). */
export function parseInboxPath(pathname: string): InboxRoute | null {
  const m = ROUTE.exec(pathname);
  if (!m) return null;
  if (!m[2]) return { view: 'inbox', folderId: null };
  let id = m[3];
  try {
    id = decodeURIComponent(id);
  } catch {
    return null;
  }
  if (m[2] === 'v') return isInboxView(id) ? { view: id, folderId: null } : null;
  return { view: 'inbox', folderId: id };
}

export function inboxPath(route: InboxRoute): string {
  if (route.folderId) return `/app/inbox/f/${encodeURIComponent(route.folderId)}`;
  return route.view === 'inbox' ? '/app/inbox' : `/app/inbox/v/${route.view}`;
}

/**
 * URL completa (con el prefijo de idioma de la página actual) de una lista de
 * la bandeja, llevando el chat abierto (?t=) para que siga abierto y el link
 * siga siendo compartible.
 */
export function inboxUrl(route: InboxRoute, openId: string | null, current: string = window.location.pathname): string {
  const at = current.indexOf('/app/inbox');
  const prefix = at > 0 ? current.slice(0, at) : '';
  return `${prefix}${inboxPath(route)}${openId ? `?t=${encodeURIComponent(openId)}` : ''}`;
}
