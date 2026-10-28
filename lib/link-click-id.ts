import { customAlphabet } from 'nanoid';

/**
 * Click id de los links con conversiones (camino caliente del redirect: sin
 * base de datos ni dependencias pesadas). Viaja al destino como ?zs_id=.
 */
export const CLICK_ID_PARAM = 'zs_id';
export const CLICK_ID_RE = /^[A-Za-z0-9]{16,32}$/;

const nanoClickId = customAlphabet('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', 20);

/** Click id nuevo (20 caracteres base62, ~119 bits). */
export function newClickId(): string {
  return nanoClickId();
}

/** Suma ?zs_id=<clickId> a una URL (http, https o un esquema de app). */
export function withClickId(url: string, clickId: string): string {
  try {
    const u = new URL(url);
    u.searchParams.set(CLICK_ID_PARAM, clickId);
    return u.toString();
  } catch {
    return url;
  }
}
