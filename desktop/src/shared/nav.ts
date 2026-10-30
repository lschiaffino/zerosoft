/**
 * Navegación del escritorio: qué URL se abre adentro de la ventana, qué va
 * al navegador y qué se bloquea. Puro (sin Electron) para testearlo.
 *
 * Regla: adentro solo el origen exacto del servidor configurado (zerosoft.ai
 * o el de un self-host). El login de Google nunca va en la ventana (Google lo
 * bloquea en webviews y no corresponde): se reemplaza por el login en el
 * navegador del sistema. Lo demás http(s), mailto y tel va afuera; cualquier
 * otro esquema (file:, javascript:, data:, zerosoft:) se bloquea.
 */

export const DEFAULT_SERVER = 'https://zerosoft.ai';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Origen del servidor a partir de lo que escribe la persona ("zerosoft.ai",
 * "https://crm.empresa.com/app"). Solo https; http solo para localhost.
 * Devuelve null si no es válido.
 */
export function normalizeServer(input: string | null | undefined): string | null {
  let raw = String(input ?? '').trim();
  if (!raw || raw.length > 300) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = `https://${raw}`;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  if (url.protocol === 'https:') return url.origin;
  if (url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname)) return url.origin;
  return null;
}

export type NavKind = 'app' | 'google-login' | 'external' | 'blocked';

function parse(raw: string): URL | null {
  if (typeof raw !== 'string' || !raw || raw.length > 8192) return null;
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

/** La URL es del servidor configurado (mismo origen exacto). */
export function isAppUrl(raw: string, server: string): boolean {
  const url = parse(raw);
  return !!url && (url.protocol === 'https:' || url.protocol === 'http:') && url.origin === server;
}

export function classifyNavigation(raw: string, server: string): NavKind {
  const url = parse(raw);
  if (!url) return 'blocked';
  if (url.protocol === 'https:' || url.protocol === 'http:') {
    if (url.origin === server) return 'app';
    if (url.hostname === 'accounts.google.com') return 'google-login';
    return 'external';
  }
  if (url.protocol === 'mailto:' || url.protocol === 'tel:') return 'external';
  return 'blocked';
}

/**
 * Path interno de la app (deep links y avisos): "/app/…" o "/<locale>/app/…",
 * sin host, sin "//", sin barras invertidas ni caracteres de control.
 */
export function safeAppPath(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string' || !raw || raw.length > 2000) return null;
  if (!raw.startsWith('/') || raw.startsWith('//')) return null;
  if (/[\u0000-\u001f\u007f\\]/.test(raw)) return null;
  let url: URL;
  try {
    url = new URL(raw, 'http://internal.invalid');
  } catch {
    return null;
  }
  if (url.origin !== 'http://internal.invalid') return null;
  if (!/^\/((en|es|pt)\/)?app(\/|$)/.test(url.pathname)) return null;
  // Grabar una reunión sola lo pide solo main con un nonce de un solo uso (shared/nonce.ts):
  // ningún link, deep link ni aviso del servidor puede traer `autostart` puesto.
  url.searchParams.delete('autostart');
  return `${url.pathname}${url.search}${url.hash}`;
}
