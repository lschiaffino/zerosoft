/**
 * Claves maestras para el cifrado de campos (lib/secret-box.ts, credenciales de Flow).
 * Server-only.
 *
 * ENCRYPTION_KEYS: lista "id:clave,id:clave" con la clave activa primero. Cada clave
 * es de 32 bytes en base64/base64url o hex (`openssl rand -base64 32`); cualquier otro
 * texto se acepta y se pasa por SHA-256. Los ids son cortos ([a-z0-9]{1,16}) y no se
 * reutilizan: cada valor cifrado guarda el id de la clave con la que se envolvió.
 *
 * Rotar: agregar la clave nueva adelante (la vieja queda detrás para leer), desplegar,
 * correr `npx tsx scripts/rotate-encryption-keys.ts --apply` y, cuando informa 0
 * pendientes, sacar la vieja. Ver docs/security/encryption.md.
 *
 * Sin ENCRYPTION_KEYS se usa la clave heredada (id "0"): SHA-256 de ENCRYPTION_KEY o,
 * si no está, de NEXTAUTH_SECRET. Sigue en el anillo para leer lo cifrado antes.
 */
import { createHash, hkdfSync } from 'crypto';

export interface MasterKey {
  id: string;
  key: Buffer;
}

export const LEGACY_KEY_ID = '0';
const ID_RE = /^[a-z0-9]{1,16}$/;

function decodeKey(raw: string): Buffer {
  const v = raw.trim();
  if (/^[0-9a-f]{64}$/i.test(v)) return Buffer.from(v, 'hex');
  if (/^[A-Za-z0-9+/_-]{43}=?$/.test(v)) {
    const b = Buffer.from(v.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    if (b.length === 32) return b;
  }
  return createHash('sha256').update(v).digest();
}

/** Clave heredada: la que usaba secret-box v1. null si no hay ningún secreto configurado. */
export function legacyMasterKey(): MasterKey | null {
  const secret = process.env.ENCRYPTION_KEY || process.env.NEXTAUTH_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') return null;
    return { id: LEGACY_KEY_ID, key: createHash('sha256').update('zerosoft-dev-encryption-key').digest() };
  }
  return { id: LEGACY_KEY_ID, key: createHash('sha256').update(secret).digest() };
}

let cached: { raw: string | undefined; legacy: string | undefined; ring: MasterKey[] } | null = null;

/** Anillo de claves: la activa primero. Tira si ENCRYPTION_KEYS está mal formada o vacía en producción. */
export function keyRing(): MasterKey[] {
  const raw = process.env.ENCRYPTION_KEYS;
  const legacyEnv = `${process.env.ENCRYPTION_KEY || process.env.NEXTAUTH_SECRET}|${process.env.ENCRYPTION_LEGACY_KEY ?? ''}`;
  if (cached && cached.raw === raw && cached.legacy === legacyEnv) return cached.ring;
  const ring: MasterKey[] = [];
  for (const part of (raw ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
    const at = part.indexOf(':');
    const id = at > 0 ? part.slice(0, at).trim().toLowerCase() : '';
    if (!ID_RE.test(id) || id === LEGACY_KEY_ID) throw new Error('ENCRYPTION_KEYS: each entry must be "<id>:<key>" with a short lowercase id other than "0"');
    if (ring.some((k) => k.id === id)) throw new Error(`ENCRYPTION_KEYS: duplicate key id "${id}"`);
    ring.push({ id, key: decodeKey(part.slice(at + 1)) });
  }
  // Después de rotar todo a ENCRYPTION_KEYS, ENCRYPTION_LEGACY_KEY=disabled saca la clave
  // derivada de NEXTAUTH_SECRET del anillo (sigue existiendo para las sesiones).
  const legacy = ring.length && process.env.ENCRYPTION_LEGACY_KEY === 'disabled' ? null : legacyMasterKey();
  if (legacy) ring.push(legacy);
  if (!ring.length) throw new Error('ENCRYPTION_KEYS, ENCRYPTION_KEY or NEXTAUTH_SECRET is required');
  cached = { raw, legacy: legacyEnv, ring };
  return ring;
}

export function activeKey(): MasterKey {
  return keyRing()[0];
}

export function findKey(id: string): MasterKey | undefined {
  return keyRing().find((k) => k.id === id);
}

/** Subclave por uso (separación de dominio): la misma maestra nunca cifra dos cosas distintas. */
export function subKey(master: MasterKey, purpose: string): Buffer {
  return Buffer.from(hkdfSync('sha256', master.key, 'zerosoft-key-ring', purpose, 32));
}
