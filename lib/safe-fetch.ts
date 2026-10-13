import { lookup } from 'dns/promises';
import { isIP } from 'net';

/**
 * Salidas HTTP a URLs que configura el usuario (webhooks, workflows): solo
 * http(s) a hosts públicos, con timeout. Evita SSRF hacia la red interna
 * (metadata de la nube, localhost, rangos privados).
 */

function isPrivateIp(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v === '::1' || v === '::') return true;
    if (v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80')) return true;
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? isPrivateIp(mapped[1]) : false;
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

export async function safeFetch(raw: string, init: RequestInit = {}, timeoutMs = 8000): Promise<Response> {
  const url = await assertPublicUrl(raw);
  return fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
}
