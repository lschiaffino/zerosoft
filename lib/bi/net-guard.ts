import { lookup } from 'dns/promises';
import { isIP } from 'net';
import { isPrivateIp } from '../safe-fetch';

/**
 * Bases externas de Analytics: el servidor se conecta a donde diga la
 * persona, así que el host pasa por acá antes de cada conexión. Se resuelve
 * una vez, se rechazan direcciones internas y la conexión va a la IP
 * resuelta (el nombre queda para TLS), así un DNS que cambia entre el chequeo
 * y la conexión no lleva a la red interna.
 *
 * En self-host la base suele estar en la red propia: ANALYTICS_ALLOW_PRIVATE_DB=1
 * permite direcciones privadas (nunca link-local ni la metadata de la nube).
 */
export class UnsafeHostError extends Error {
  constructor(public code: 'invalid_host' | 'private_host' | 'unresolvable_host') {
    super(code);
  }
}

const HOSTNAME = /^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))*\.?$/i;

export function privateDbAllowed(): boolean {
  return process.env.ANALYTICS_ALLOW_PRIVATE_DB === '1';
}

/** IPv6 en sus 8 grupos (acepta "::" y una IPv4 al final). null si no es válida. */
export function ipv6Groups(ip: string): number[] | null {
  let s = ip.toLowerCase().split('%')[0];
  const v4 = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(s);
  if (v4) {
    const b = v4.slice(1).map(Number);
    if (b.some((n) => n > 255)) return null;
    s = s.slice(0, v4.index) + `${((b[0] << 8) | b[1]).toString(16)}:${((b[2] << 8) | b[3]).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const part = (x: string) => (x ? x.split(':') : []);
  const head = part(halves[0]);
  const tail = halves.length === 2 ? part(halves[1]) : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const all = [...head, ...Array(fill).fill('0'), ...tail];
  if (all.length !== 8 || all.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return all.map((g) => parseInt(g, 16));
}

const v4of = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;

/**
 * Clasifica una IP: 'ok', 'private' (red interna) o 'never' (link-local y
 * metadata de la nube: ni con direcciones privadas permitidas).
 */
export function classifyIp(ip: string): 'ok' | 'private' | 'never' {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 169 && b === 254) return 'never';
    if (ip === '100.100.100.200') return 'never';
    return isPrivateIp(ip) ? 'private' : 'ok';
  }
  const g = ipv6Groups(ip);
  if (!g) return 'never';
  // IPv4 adentro de una IPv6: mapeada (::ffff:a.b.c.d), compatible (::a.b.c.d) o NAT64 (64:ff9b::/96).
  const zero = (from: number, to: number) => g.slice(from, to).every((x) => x === 0);
  if (zero(0, 5) && g[5] === 0xffff) return classifyIp(v4of(g[6], g[7]));
  if (zero(0, 6)) return g[6] === 0 && g[7] <= 1 ? 'private' : classifyIp(v4of(g[6], g[7]));
  if (g[0] === 0x64 && g[1] === 0xff9b) return zero(2, 6) ? classifyIp(v4of(g[6], g[7])) : 'private';
  if ((g[0] & 0xffc0) === 0xfe80) return 'never';
  if (g[0] === 0xfd00 && g[1] === 0x0ec2) return 'never';
  if ((g[0] & 0xfe00) === 0xfc00 || (g[0] & 0xffc0) === 0xfec0 || (g[0] & 0xff00) === 0xff00 || g[0] === 0x2002 || g[0] === 0x2001 && g[1] === 0) return 'private';
  return 'ok';
}

/** ¿El texto es un host aceptable (nombre DNS o IP, sin sockets ni rutas)? */
export function validHostSyntax(host: string): boolean {
  const h = host.trim();
  if (!h || h.length > 253) return false;
  if (isIP(h)) return true;
  return HOSTNAME.test(h);
}

export function validPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

/**
 * IP a la que conectarse para `host`. Tira UnsafeHostError si el host no es
 * válido, no resuelve o alguna de sus direcciones es interna.
 */
export async function resolveDbHost(host: string, resolver: (h: string) => Promise<string[]> = defaultResolver): Promise<string> {
  const h = host.trim().replace(/\.$/, '');
  if (!validHostSyntax(h)) throw new UnsafeHostError('invalid_host');
  const allowPrivate = privateDbAllowed();
  let ips: string[];
  if (isIP(h)) ips = [h];
  else {
    if (!allowPrivate && /^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i.test(h)) throw new UnsafeHostError('private_host');
    try {
      ips = await resolver(h);
    } catch {
      throw new UnsafeHostError('unresolvable_host');
    }
  }
  if (!ips.length) throw new UnsafeHostError('unresolvable_host');
  for (const ip of ips) {
    if (!isIP(ip)) throw new UnsafeHostError('invalid_host');
    const c = classifyIp(ip);
    if (c === 'never' || (c === 'private' && !allowPrivate)) throw new UnsafeHostError('private_host');
  }
  return ips[0];
}

async function defaultResolver(h: string): Promise<string[]> {
  const res = await lookup(h, { all: true, verbatim: true });
  return res.map((r) => r.address);
}
