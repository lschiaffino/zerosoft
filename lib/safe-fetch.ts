import { lookup as lookupCb, type LookupAddress, type LookupOptions } from 'dns';
import { lookup } from 'dns/promises';
import http from 'http';
import https from 'https';
import { isIP } from 'net';
import { Readable } from 'stream';
import zlib from 'zlib';

/**
 * Salidas HTTP a URLs que configura el usuario (webhooks, workflows): solo
 * http(s) a hosts públicos, con timeout. Evita SSRF hacia la red interna
 * (metadata de la nube, localhost, rangos privados).
 */

/** IPv4 embebida en una IPv6 escrita en hex (`7f00:1` → 127.0.0.1). */
function hexToIpv4(hi: string, lo: string): string {
  const h = parseInt(hi, 16);
  const l = parseInt(lo, 16);
  return `${h >> 8}.${h & 255}.${l >> 8}.${l & 255}`;
}

export function isPrivateIp(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v === '::1' || v === '::') return true;
    if (v.startsWith('fc') || v.startsWith('fd') || /^fe[89ab]/.test(v) || v.startsWith('fec')) return true;
    // 6to4 (2002::/16) lleva una IPv4 adentro, que puede ser interna: se bloquea entero.
    if (/^2002:/.test(v)) return true;
    // IPv4-mapped / NAT64 / IPv4-compatible: dotted (::ffff:127.0.0.1) o, como
    // lo normaliza `new URL()`, en hex (::ffff:7f00:1). Antes la forma hex
    // pasaba el filtro y permitía SSRF a 127.0.0.1 / 10.x / 169.254.x.
    const dotted = v.match(/^(?:::ffff:|64:ff9b::|::)(\d+\.\d+\.\d+\.\d+)$/);
    if (dotted) return isPrivateIp(dotted[1]);
    const hex = v.match(/^(?:::ffff:|64:ff9b::|::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hex) return isPrivateIp(hexToIpv4(hex[1], hex[2]));
    return false;
  }
  const [a, b] = ip.split('.').map(Number);
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    // 198.18.0.0/15: redes de benchmark, que algunos proveedores usan como internas.
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

export class UnsafeUrlError extends Error {}

/**
 * `allowHttp`: acepta http:// también en producción (Robots navega sitios
 * públicos sin HTTPS). Los hosts privados se bloquean igual.
 */
export async function assertPublicUrl(raw: string, opts: { allowHttp?: boolean } = {}): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError('invalid_url');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new UnsafeUrlError('invalid_url');
  // Self-host en red privada o tests: se permiten hosts internos y http.
  if (process.env.ALLOW_PRIVATE_WEBHOOKS === 'true') return url;
  const devHttp = (opts.allowHttp || process.env.NODE_ENV !== 'production') && url.protocol === 'http:';
  if (url.protocol !== 'https:' && !devHttp) throw new UnsafeUrlError('https_required');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) {
    throw new UnsafeUrlError('private_host');
  }
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  if (addresses.length === 0) throw new UnsafeUrlError('unresolvable_host');
  if (addresses.some(isPrivateIp)) throw new UnsafeUrlError('private_host');
  return url;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
/**
 * Headers que se reenvían al seguir una redirección a OTRO origen. Todo lo
 * demás se saca: además de Authorization y Cookie, una credencial puede ir en
 * un header propio (X-Api-Key de una credencial api_key, headers secretos de
 * una herramienta HTTP de un agente) y no puede terminar en otro host.
 */
const CROSS_ORIGIN_SAFE_HEADERS = new Set(['accept', 'accept-language', 'content-type', 'content-length', 'user-agent']);

/**
 * fetch a una URL pública. Por defecto no sigue redirecciones (devuelve el
 * 3xx). Con `maxRedirects` las sigue a mano, validando cada Location con
 * assertPublicUrl (un salto a la red interna falla igual que la URL inicial):
 * 301/302/303 pasan a GET sin body (307/308 conservan método y body) y si
 * cambia el origen solo quedan los headers sin secretos
 * (CROSS_ORIGIN_SAFE_HEADERS). El timeout cubre todos los saltos.
 *
 * `pinDns` (solo GET/HEAD): cada salto se conecta con `publicLookup`, que
 * valida la misma dirección con la que abre el socket. Sin eso, un DNS que
 * cambia de respuesta entre el chequeo y el fetch (DNS rebinding) podría
 * llevar el pedido a la red interna. Lo usan las vistas previas de links.
 */
export async function safeFetch(
  raw: string,
  init: RequestInit = {},
  timeoutMs = 8000,
  opts: { maxRedirects?: number; pinDns?: boolean } = {},
): Promise<Response> {
  const signal = AbortSignal.timeout(timeoutMs);
  let url = await assertPublicUrl(raw);
  let req: RequestInit = init;
  const maxRedirects = Math.max(0, Math.floor(opts.maxRedirects ?? 0));
  for (let hop = 0; ; hop++) {
    const res = opts.pinDns ? await pinnedGet(url, req, signal) : await fetch(url, { ...req, redirect: 'manual', signal });
    const location = res.headers.get('location');
    if (hop >= maxRedirects || !REDIRECT_STATUSES.has(res.status) || !location) return res;
    await res.body?.cancel().catch(() => {});
    let next: URL;
    try {
      next = new URL(location, url);
    } catch {
      throw new UnsafeUrlError('invalid_redirect');
    }
    next = await assertPublicUrl(next.toString());
    const headers = new Headers(req.headers);
    if (next.origin !== url.origin) {
      for (const h of [...headers.keys()]) if (!CROSS_ORIGIN_SAFE_HEADERS.has(h.toLowerCase())) headers.delete(h);
    }
    const method = (req.method ?? 'GET').toUpperCase();
    if (res.status === 303 || ((res.status === 301 || res.status === 302) && method !== 'GET' && method !== 'HEAD')) {
      headers.delete('content-type');
      headers.delete('content-length');
      req = { ...req, method: method === 'HEAD' ? 'HEAD' : 'GET', body: undefined, headers };
    } else {
      req = { ...req, headers };
    }
    url = next;
  }
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/**
 * El `lookup` de la conexión: resuelve el host y rechaza si alguna dirección
 * es interna. Corre en el mismo momento en que se conecta, con la misma
 * respuesta de DNS que usa el socket: un DNS que contesta una IP pública al
 * chequear y una interna al conectar (DNS rebinding) no pasa.
 */
export function publicLookup(hostname: string, options: LookupOptions, cb: LookupCallback): void {
  lookupCb(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return cb(err, '');
    const list = (Array.isArray(addresses) ? addresses : []) as LookupAddress[];
    if (process.env.ALLOW_PRIVATE_WEBHOOKS !== 'true' && (list.length === 0 || list.some((a) => isPrivateIp(a.address)))) {
      return cb(Object.assign(new Error('private_host'), { code: 'EPRIVATEHOST' }), '');
    }
    if (options.all) return cb(null, list);
    cb(null, list[0].address, list[0].family);
  });
}

/** Lo más que se acepta de cabeceras de una respuesta (un servidor no puede mandar cabeceras sin fin). */
const MAX_HEADER_BYTES = 32 * 1024;

/**
 * GET (o HEAD) con http/https de Node y `publicLookup`: la dirección con la
 * que se conecta es la que se validó. Devuelve un Response como fetch (el
 * cuerpo descomprimido, sin seguir redirecciones). Sin cuerpo en el pedido:
 * solo para leer páginas e imágenes.
 */
function pinnedGet(url: URL, init: RequestInit, signal: AbortSignal): Promise<Response> {
  const method = (init.method ?? 'GET').toUpperCase();
  if ((method !== 'GET' && method !== 'HEAD') || init.body != null) return Promise.reject(new UnsafeUrlError('pinned_get_only'));
  const headers: Record<string, string> = {};
  new Headers(init.headers).forEach((v, k) => {
    headers[k] = v;
  });
  headers['accept-encoding'] ??= 'gzip, deflate, br';
  const mod = url.protocol === 'https:' ? https : http;
  return new Promise<Response>((resolve, reject) => {
    const req = mod.request(url, { method, headers, lookup: publicLookup, signal, maxHeaderSize: MAX_HEADER_BYTES, agent: false }, (res) => {
      const status = res.statusCode ?? 502;
      const enc = String(res.headers['content-encoding'] ?? '').trim().toLowerCase();
      let body: Readable = res;
      if (enc === 'gzip' || enc === 'x-gzip') body = res.pipe(zlib.createGunzip());
      else if (enc === 'deflate') body = res.pipe(zlib.createInflate());
      else if (enc === 'br') body = res.pipe(zlib.createBrotliDecompress());
      if (body !== res) res.on('error', (e) => body.destroy(e));
      const out = new Headers();
      for (const [k, v] of Object.entries(res.headers)) {
        if (v === undefined) continue;
        // Descomprimido acá: el largo y la codificación de la respuesta original ya no valen.
        if (body !== res && (k === 'content-encoding' || k === 'content-length')) continue;
        for (const x of Array.isArray(v) ? v : [v]) out.append(k, x);
      }
      const empty = method === 'HEAD' || status === 204 || status === 205 || status === 304 || status < 200;
      if (empty) res.resume();
      try {
        resolve(
          new Response(empty ? null : (Readable.toWeb(body) as unknown as ReadableStream<Uint8Array>), {
            status: status < 200 || status > 599 ? 502 : status,
            statusText: res.statusMessage ?? '',
            headers: out,
          }),
        );
      } catch (err) {
        res.destroy();
        reject(err);
      }
    });
    req.on('error', reject);
    req.end();
  });
}

/**
 * Lee el cuerpo como texto en streaming y corta en `maxBytes` (sin confiar en
 * content-length): un servidor no puede mandar un cuerpo infinito.
 */
export async function readTextCapped(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      const room = maxBytes - total;
      chunks.push(value.byteLength > room ? value.subarray(0, room) : value);
      total += Math.min(value.byteLength, room);
      if (total >= maxBytes) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(Buffer.concat(chunks));
}
