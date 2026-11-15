import type { OutgoingHttpHeaders, ServerResponse } from 'http';
import { PRIVATE_NO_STORE } from './no-store';

/**
 * Cache-Control por defecto en /api/*: las lecturas que salen bien (GET o HEAD
 * con 2xx o 3xx) y no fijan la suya salen `private, no-store`. Los errores
 * salen `private` (fuera de cachés compartidas, sin no-store, ver abajo).
 *
 * Por qué acá y no en next.config `headers()` ni en el middleware: los dos
 * ponen la cabecera antes de que corra la ruta, y Next solo copia las
 * cabeceras de la respuesta de la ruta que no estén ya puestas
 * (next/dist/server/send-response.js). Una cabecera de ahí pisaría a todas las
 * rutas que eligen su caché a propósito. Esto en cambio mira la respuesta ya
 * armada, justo antes de mandar las cabeceras, y solo completa lo que falta.
 *
 * Lo que no se toca:
 * - La ruta que fija su Cache-Control (OG, embeds, medios privados con
 *   max-age, streams SSE): gana siempre.
 * - Las rutas públicas de API_CACHE_PUBLIC, aunque no fijen nada (por ejemplo
 *   un 404 del feed de la app de escritorio): su caché la decide la ruta.
 * - POST, PATCH, PUT y DELETE: ningún caché guarda esas respuestas sin que la
 *   ruta lo pida, y muchas se mandan sin leer la respuesta (sendBeacon, avisos).
 *
 * Por qué los errores no llevan no-store: Chromium no da por terminado un
 * pedido `no-store` cuyo cuerpo nadie lee (el código que hace `r.ok ? r.json()
 * : null` deja el 404 sin leer): la conexión queda abierta y la página nunca
 * llega a estar quieta. Un error no trae datos de la persona; con `private`
 * ningún caché compartido lo guarda igual.
 */
export const API_DEFAULT_CACHE_CONTROL = PRIVATE_NO_STORE;
export const API_ERROR_CACHE_CONTROL = 'private';

/**
 * Rutas públicas a propósito: el default no las toca nunca (ni cuando
 * responden un error). Cada una fija su caché en la ruta.
 * tests/unit/api-cache-default.test.ts recorre la lista.
 */
export const API_CACHE_PUBLIC: readonly string[] = [
  // Imágenes OG de las páginas públicas y los íconos de la PWA.
  '/api/og/',
  '/api/pwa-icon/',
  // Archivos públicos subidos (immutable).
  '/api/uploads/',
  // Feeds de actualización de la app de escritorio y el instalador de Fleet.
  '/api/desktop/update/',
  '/api/fleet/install',
  // Estado del servicio (status page).
  '/api/status/',
  // Novedades públicas y la especificación de la API.
  '/api/board/changelog',
  '/api/changelog-entries',
  '/api/v1/openapi.json',
  // Scripts que se embeben en otros sitios.
  '/api/chat/widget.js',
  '/api/calendar/embed.js',
  '/api/forms/embed.js',
  '/api/crm/forms/embed.js',
  // Sitios publicados de Docs por dominio propio.
  '/api/docs/site/host',
  // Fotos de contacto que se sirven por el dominio propio (con su max-age privado).
  '/api/inbox/avatar/',
];

const PATCHED = Symbol.for('zerosoft.apiCacheDefault');

function pathOf(url: string | undefined | null): string {
  return url ? url.split('?', 1)[0] : '';
}

/** ¿Es una ruta de la API? (`/api` o `/api/...`, con o sin query). */
export function isApiPath(url: string | undefined | null): boolean {
  const path = pathOf(url);
  return path === '/api' || path.startsWith('/api/');
}

/** ¿Es una de las rutas públicas de API_CACHE_PUBLIC? */
export function isPublicApiPath(url: string | undefined | null): boolean {
  const path = pathOf(url);
  return API_CACHE_PUBLIC.some((p) => (p.endsWith('/') ? path.startsWith(p) : path === p || path.startsWith(`${p}/`)));
}

/** ¿Las cabeceras que se pasan a writeHead ya traen Cache-Control? */
function headersHaveCacheControl(headers: unknown): boolean {
  if (!headers || typeof headers !== 'object') return false;
  if (Array.isArray(headers)) {
    // Forma cruda: [nombre, valor, nombre, valor...] o [[nombre, valor], ...].
    if (headers.length && Array.isArray(headers[0])) return headers.some((h) => String((h as unknown[])[0]).toLowerCase() === 'cache-control');
    for (let i = 0; i < headers.length; i += 2) if (String(headers[i]).toLowerCase() === 'cache-control') return true;
    return false;
  }
  return Object.keys(headers as OutgoingHttpHeaders).some((k) => k.toLowerCase() === 'cache-control');
}

/** Qué Cache-Control le toca a una respuesta de la API sin cabecera propia (null: ninguna). */
export function apiDefaultCacheControl(method: string | undefined, path: string | undefined | null, status: number): string | null {
  if (!isApiPath(path) || isPublicApiPath(path)) return null;
  const m = (method ?? 'GET').toUpperCase();
  if (m !== 'GET' && m !== 'HEAD') return null;
  return status >= 400 ? API_ERROR_CACHE_CONTROL : API_DEFAULT_CACHE_CONTROL;
}

type Res = Pick<ServerResponse, 'hasHeader' | 'setHeader'> & { statusCode?: number; req?: { url?: string; method?: string } };

/** Completa Cache-Control si la respuesta es de /api/* y no trae una propia. */
export function applyApiCacheDefault(res: Res, writeHeadArgs: unknown[] = []): void {
  if (!isApiPath(res.req?.url)) return;
  if (res.hasHeader('cache-control')) return;
  // writeHead(status, headers) o writeHead(status, statusMessage, headers).
  if (writeHeadArgs.slice(1).some(headersHaveCacheControl)) return;
  const status = typeof writeHeadArgs[0] === 'number' ? writeHeadArgs[0] : (res.statusCode ?? 200);
  const value = apiDefaultCacheControl(res.req?.method, res.req?.url, status);
  if (value) res.setHeader('Cache-Control', value);
}

/**
 * Engancha writeHead de ServerResponse (una vez por proceso). Node llama a
 * writeHead también cuando la cabecera sale implícita (primer write o end),
 * así que cubre toda respuesta del servidor de Node, en `next start` y en las
 * funciones de Vercel. Las rutas de edge no pasan por acá (hoy no hay).
 */
export function installApiCacheDefault(proto: ServerResponse): void {
  const p = proto as ServerResponse & { [PATCHED]?: true };
  if (p[PATCHED]) return;
  const original = p.writeHead;
  p.writeHead = function writeHead(this: ServerResponse, ...args: unknown[]) {
    try {
      if (!this.headersSent) applyApiCacheDefault(this, args);
    } catch {
      // Nunca romper una respuesta por la cabecera por defecto.
    }
    return (original as (...a: unknown[]) => ServerResponse).apply(this, args);
  } as ServerResponse['writeHead'];
  p[PATCHED] = true;
}
