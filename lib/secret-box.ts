import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { activeKey, findKey, LEGACY_KEY_ID, subKey, type MasterKey } from './key-ring';

/**
 * Cifrado de campos sensibles en la base (tokens OAuth, claves de API de terceros,
 * secretos de webhooks, sesiones de WhatsApp, credenciales, secretos TOTP).
 *
 * Cifrado en sobre (envelope): cada valor tiene su propia clave de datos (DEK) aleatoria
 * de 256 bits que cifra el texto con AES-256-GCM; la DEK se guarda envuelta (AES-256-GCM)
 * con una subclave de la clave maestra activa de lib/key-ring.ts.
 *
 * Formatos:
 * - "enc:v2:<kid>:<dek envuelta>.<iv>.<tag>.<datos>" (actual, base64url).
 * - "enc:v1:<iv>.<tag>.<datos>" (heredado: AES-256-GCM directo con la clave "0"). Se
 *   sigue leyendo; scripts/rotate-encryption-keys.ts lo pasa a v2.
 * Los valores sin prefijo son texto plano heredado y se leen tal cual.
 */

const V1 = 'enc:v1:';
const V2 = 'enc:v2:';
const PURPOSE = 'secret-box:wrap';

/** Un valor cifrado (cualquier versión) dentro de un texto más largo (p. ej. un JSON). */
export const SEALED_TOKEN_RE = /enc:v(?:1:|2:[a-z0-9]{1,16}:[A-Za-z0-9_-]+\.)[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g;

function gcm(key: Buffer, plain: Buffer): { iv: Buffer; tag: Buffer; data: Buffer } {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plain), cipher.final()]);
  return { iv, tag: cipher.getAuthTag(), data };
}

function ungcm(key: Buffer, iv: Buffer, tag: Buffer, data: Buffer): Buffer {
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

const b64 = (b: Buffer) => b.toString('base64url');

function sealWith(master: MasterKey, plain: string): string {
  const dek = randomBytes(32);
  const wrapped = gcm(subKey(master, PURPOSE), dek);
  const body = gcm(dek, Buffer.from(plain, 'utf8'));
  dek.fill(0);
  const wrappedDek = Buffer.concat([wrapped.iv, wrapped.tag, wrapped.data]);
  return `${V2}${master.id}:${b64(wrappedDek)}.${b64(body.iv)}.${b64(body.tag)}.${b64(body.data)}`;
}

export function seal(plain: string): string {
  if (!plain) return plain;
  return sealWith(activeKey(), plain);
}

/** Devuelve el texto plano, o '' si no se puede descifrar (clave que ya no está o dato corrupto). */
export function open(value: string | null | undefined): string {
  if (!value) return '';
  try {
    if (value.startsWith(V2)) {
      const rest = value.slice(V2.length);
      const colon = rest.indexOf(':');
      const master = findKey(rest.slice(0, colon));
      if (!master) return '';
      const [wrapped, iv, tag, data] = rest.slice(colon + 1).split('.');
      const w = Buffer.from(wrapped, 'base64url');
      const dek = ungcm(subKey(master, PURPOSE), w.subarray(0, 12), w.subarray(12, 28), w.subarray(28));
      const plain = ungcm(dek, Buffer.from(iv, 'base64url'), Buffer.from(tag, 'base64url'), Buffer.from(data, 'base64url'));
      dek.fill(0);
      return plain.toString('utf8');
    }
    if (value.startsWith(V1)) {
      const legacy = findKey(LEGACY_KEY_ID);
      if (!legacy) return '';
      const [iv, tag, data] = value.slice(V1.length).split('.');
      return ungcm(legacy.key, Buffer.from(iv, 'base64url'), Buffer.from(tag, 'base64url'), Buffer.from(data, 'base64url')).toString('utf8');
    }
  } catch {
    return '';
  }
  return value;
}

export function isSealed(value: string | null | undefined): boolean {
  return !!value && (value.startsWith(V1) || value.startsWith(V2));
}

/** Id de la clave maestra de un valor cifrado ('0' para v1), o null si no está cifrado. */
export function sealedKeyId(value: string): string | null {
  if (value.startsWith(V1)) return '0';
  if (!value.startsWith(V2)) return null;
  const rest = value.slice(V2.length);
  return rest.slice(0, rest.indexOf(':'));
}

/** ¿Hay que volver a cifrarlo con la clave activa? (v1, o v2 con otra clave). */
export function needsRotation(value: string): boolean {
  const kid = sealedKeyId(value);
  return kid !== null && (value.startsWith(V1) || kid !== activeKey().id);
}

/**
 * Vuelve a cifrar con la clave activa. null si no se pudo abrir (falta la clave vieja o el
 * dato está corrupto): el valor se deja como está y se informa.
 */
export function reseal(value: string): string | null {
  const plain = open(value);
  if (!plain) return null;
  return seal(plain);
}
