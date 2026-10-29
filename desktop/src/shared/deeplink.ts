/**
 * Deep links zerosoft:// (puro, sin Electron). Todo lo que llega por el
 * esquema viene de afuera: se valida forma y largo de cada campo y lo que no
 * coincide se descarta.
 *
 *   zerosoft://auth/callback?code=…&state=…   vuelta del login en el navegador
 *   zerosoft://open?path=/app/talk             abrir una página de la app
 *   zerosoft://open/app/talk                   ídem
 *   zerosoft://notes                           empezar notas de reunión
 */
import { safeAppPath } from './nav';

export const PROTOCOL = 'zerosoft';

export type DeepLink =
  | { kind: 'auth'; code: string; state: string }
  | { kind: 'open'; path: string }
  | { kind: 'notes' };

const CODE_RE = /^[A-Za-z0-9_-]{32,128}$/;
const STATE_RE = /^[A-Za-z0-9_-]{16,128}$/;

export function parseDeepLink(raw: unknown): DeepLink | null {
  if (typeof raw !== 'string' || raw.length > 2048) return null;
  if (!raw.toLowerCase().startsWith(`${PROTOCOL}:`)) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== `${PROTOCOL}:` || url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase();
  const path = url.pathname.replace(/\/+$/, '');
  if (host === 'auth' && path === '/callback') {
    const code = url.searchParams.get('code') ?? '';
    const state = url.searchParams.get('state') ?? '';
    if (!CODE_RE.test(code) || !STATE_RE.test(state)) return null;
    return { kind: 'auth', code, state };
  }
  if (host === 'open') {
    const target = path ? `${path}${url.search}` : url.searchParams.get('path');
    const safe = safeAppPath(target);
    return safe ? { kind: 'open', path: safe } : null;
  }
  if (host === 'notes' && !path) return { kind: 'notes' };
  return null;
}

/** En Windows (y en Linux) el link llega como argumento al abrir la app o una segunda instancia. */
export function deepLinkFromArgv(argv: readonly string[]): string | null {
  for (const arg of argv) {
    if (typeof arg === 'string' && arg.toLowerCase().startsWith(`${PROTOCOL}://`)) return arg;
  }
  return null;
}
