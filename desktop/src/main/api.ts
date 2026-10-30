/**
 * Pedidos del proceso main al servidor con la sesión de la ventana (la misma
 * cookie que usa la app web): dictado, eventos de Voice y el contador de
 * avisos. El token nunca se lee acá: lo pone el cookie store.
 */
import { appSession, server } from './state';

export async function apiFetch(pathname: string, init: RequestInit = {}): Promise<Response> {
  const url = new URL(pathname, server()).toString();
  return appSession().fetch(url, { ...init, credentials: 'include' });
}

export async function apiJson<T>(pathname: string, init: RequestInit = {}): Promise<{ status: number; data: T | null }> {
  try {
    const res = await apiFetch(pathname, init);
    const data = (await res.json().catch(() => null)) as T | null;
    return { status: res.status, data };
  } catch {
    return { status: 0, data: null };
  }
}
