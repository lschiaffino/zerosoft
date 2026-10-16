// Paths del board público, sin dependencias de servidor (los usan componentes cliente).
// En feedback.zerosoft.ai el middleware agrega el prefijo: los links van sin él.

import { itemRef } from './roadmap-constants';

export const BOARD_PREFIX = '/feedback-board';

/** /<locale>/feedback-board<path> en el sitio; /<locale><path> en el subdominio. */
export function boardPath(locale: string, onSurface: boolean, path = ''): string {
  return onSurface ? `/${locale}${path}` : `/${locale}${BOARD_PREFIX}${path}`;
}

export function boardItemPath(locale: string, onSurface: boolean, id: string, title: string): string {
  return boardPath(locale, onSurface, `/i/${itemRef(id, title)}`);
}

/** Path del board para un item, sin locale ni host (para guardarlo en notificaciones in-app). */
export function boardItemAppHref(id: string, title: string): string {
  return `${BOARD_PREFIX}/i/${itemRef(id, title)}`;
}
