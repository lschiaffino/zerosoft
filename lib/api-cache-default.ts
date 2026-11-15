import type { OutgoingHttpHeaders, ServerResponse } from 'http';
import { PRIVATE_NO_STORE } from './no-store';

/**
 * Cache-Control por defecto en /api/*: `private, no-store`, salvo que la ruta
 * fije la suya (OG images, feeds, embeds, sitemaps, archivos públicos, medios
 * privados con max-age, streams).
 *
 * Por qué acá y no en next.config `headers()` ni en el middleware: los dos
 * ponen la cabecera antes de que corra la ruta, y Next solo copia las
 * cabeceras de la respuesta de la ruta que no estén ya puestas
 * (next/dist/server/send-response.js). Una cabecera de ahí pisaría a todas las
 * rutas que eligen su caché a propósito. Esto en cambio mira la respuesta ya
 * armada, justo antes de mandar las cabeceras, y solo completa lo que falta.
 */
export const API_DEFAULT_CACHE_CONTROL = PRIVATE_NO_STORE;

const PATCHED = Symbol.for('zerosoft.apiCacheDefault');

/** ¿Es una ruta de la API? (`/api` o `/api/...`, con o sin query). */
export function isApiPath(url: string | undefined | null): boolean {
  if (!url) return false;
  const path = url.split('?', 1)[0];
  return path === '/api' || path.startsWith('/api/');
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

type Res = Pick<ServerResponse, 'hasHeader' | 'setHeader'> & { req?: { url?: string } };

/** Completa Cache-Control si la respuesta es de /api/* y no trae una propia. */
export function applyApiCacheDefault(res: Res, writeHeadArgs: unknown[] = []): void {
  if (!isApiPath(res.req?.url)) return;
  if (res.hasHeader('cache-control')) return;
  // writeHead(status, headers) o writeHead(status, statusMessage, headers).
  if (writeHeadArgs.some(headersHaveCacheControl)) return;
  res.setHeader('Cache-Control', API_DEFAULT_CACHE_CONTROL);
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
      if (!this.headersSent) applyApiCacheDefault(this, args.slice(1));
    } catch {
      // Nunca romper una respuesta por la cabecera por defecto.
    }
    return (original as (...a: unknown[]) => ServerResponse).apply(this, args);
  } as ServerResponse['writeHead'];
  p[PATCHED] = true;
}
