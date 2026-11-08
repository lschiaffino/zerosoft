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
 * permite direcciones privadas (nunca la de metadata de la nube).
 */
export class UnsafeHostError extends Error {
  constructor(public code: 'invalid_host' | 'private_host' | 'unresolvable_host') {
    super(code);
  }
}

const HOSTNAME = /^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))*\.?$/i;

/** Metadata de las nubes: nunca, ni con direcciones privadas permitidas. */
function isMetadataIp(ip: string): boolean {
  const v = ip.toLowerCase();
  return v === '169.254.169.254' || v === '169.254.170.2' || v === 'fd00:ec2::254' || v.endsWith(':169.254.169.254') || v === '100.100.100.200';
}

export function privateDbAllowed(): boolean {
  return process.env.ANALYTICS_ALLOW_PRIVATE_DB === '1';
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
    if (isMetadataIp(ip)) throw new UnsafeHostError('private_host');
    if (!allowPrivate && isPrivateIp(ip)) throw new UnsafeHostError('private_host');
  }
  return ips[0];
}

async function defaultResolver(h: string): Promise<string[]> {
  const res = await lookup(h, { all: true, verbatim: true });
  return res.map((r) => r.address);
}
