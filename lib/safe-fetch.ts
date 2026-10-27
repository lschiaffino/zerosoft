import { lookup } from 'dns/promises';
import { isIP } from 'net';

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
/** Headers con credenciales: no se reenvían a otro origen al seguir una redirección. */
const CREDENTIAL_HEADERS = ['authorization', 'proxy-authorization', 'cookie'];

/**
 * fetch a una URL pública. Por defecto no sigue redirecciones (devuelve el
 * 3xx). Con `maxRedirects` las sigue a mano, validando cada Location con
 * assertPublicUrl (un salto a la red interna falla igual que la URL inicial):
 * 301/302/303 pasan a GET sin body (307/308 conservan método y body) y las
 * credenciales se sacan si cambia el origen. El timeout cubre todos los saltos.
 */
export async function safeFetch(
  raw: string,
  init: RequestInit = {},
  timeoutMs = 8000,
  opts: { maxRedirects?: number } = {},
): Promise<Response> {
  const signal = AbortSignal.timeout(timeoutMs);
  let url = await assertPublicUrl(raw);
  let req: RequestInit = init;
  const maxRedirects = Math.max(0, Math.floor(opts.maxRedirects ?? 0));
  for (let hop = 0; ; hop++) {
    const res = await fetch(url, { ...req, redirect: 'manual', signal });
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
    if (next.origin !== url.origin) for (const h of CREDENTIAL_HEADERS) headers.delete(h);
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
