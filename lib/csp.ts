import { THEME_INIT_SCRIPT } from './color-theme';
import { SESSION_HINT_SCRIPT } from './session-hint';
import { localeCookieScript } from './locale-cookie';
import { TZ_COOKIE_SCRIPT } from './tz-client';

/**
 * Content-Security-Policy de las páginas de la app (/app/**).
 *
 * Los scripts solo corren con el nonce de la request (Next lo pone en los
 * suyos al leerlo del header que arma el middleware) o con el hash de los
 * scripts en línea fijos del layout raíz (que no puede leer la request sin
 * dejar de ser estático para el sitio). 'strict-dynamic': lo que carga un
 * script confiable (chunks, Turnstile, el reproductor) también vale.
 * `https:` y 'unsafe-inline' solo los usan navegadores sin CSP3 (los que
 * entienden nonces los ignoran).
 *
 * Por ahora va como Report-Only: avisa sin bloquear (ver /api/csp-report).
 * Sin edge ni Node: lo usan el middleware y los tests.
 */

export const CSP_NONCE_HEADER = 'x-zs-nonce';
export const CSP_REPORT_PATH = '/api/csp-report';
export const CSP_REPORT_GROUP = 'csp';

const LOCALES = ['en', 'es', 'pt'] as const;

/** Scripts en línea del layout raíz ([locale]/layout.tsx), tal cual salen en el HTML. */
export function rootInlineScripts(): string[] {
  return [...LOCALES.map((l) => THEME_INIT_SCRIPT + SESSION_HINT_SCRIPT + localeCookieScript(l)), TZ_COOKIE_SCRIPT];
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export async function sha256Source(script: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(script));
  return `'sha256-${toBase64(new Uint8Array(digest))}'`;
}

let hashes: Promise<string[]> | null = null;
/** Hashes de los scripts del layout raíz (se calculan una vez por instancia). */
export function rootScriptHashes(): Promise<string[]> {
  hashes ??= Promise.all(rootInlineScripts().map(sha256Source));
  return hashes;
}

/** Nonce nuevo por request: 128 bits en base64. */
export function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return toBase64(bytes);
}

export function appCsp(nonce: string, scriptHashes: string[], opts: { dev?: boolean } = {}): string {
  const script = [`'nonce-${nonce}'`, "'strict-dynamic'", ...scriptHashes, 'https:', "'unsafe-inline'"];
  // next dev (React Refresh) evalúa código; el build de producción no.
  if (opts.dev) script.push("'unsafe-eval'");
  return [
    `script-src ${script.join(' ')}`,
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'self'",
    `report-uri ${CSP_REPORT_PATH}`,
    `report-to ${CSP_REPORT_GROUP}`,
  ].join('; ');
}
