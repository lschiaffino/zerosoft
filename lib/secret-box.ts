import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { activeKey, findKey, keyRing, LEGACY_KEY_ID, subKey, usingKeyRing, type MasterKey } from './key-ring';

/**
 * Cifrado de campos sensibles en la base (tokens OAuth, claves de API de terceros,
 * secretos de webhooks, configuración de cuentas conectadas, credenciales, secretos TOTP).
 *
 * Formatos:
 * - "enc:v2:<kid>:<dek envuelta>.<iv>.<tag>.<datos>" (base64url): cifrado en sobre. Cada
 *   valor tiene su propia clave de datos (DEK) aleatoria de 256 bits que cifra el texto con
 *   AES-256-GCM; la DEK va envuelta (AES-256-GCM) con una subclave de la clave maestra <kid>
 *   de lib/key-ring.ts. Se escribe cuando ENCRYPTION_KEYS está configurada.
 * - "enc:v1:<iv>.<tag>.<datos>": AES-256-GCM directo con la clave heredada "0". Se sigue
 *   escribiendo mientras no haya ENCRYPTION_KEYS (así este cambio se puede desplegar y
 *   revertir sin tocar datos) y se sigue leyendo siempre que la clave "0" esté en el anillo.
 * Los valores sin prefijo son texto plano heredado y se leen tal cual.
 */

const V1 = 'enc:v1:';
const V2 = 'enc:v2:';
const PURPOSE = 'secret-box:wrap';
const IV_LEN = 12;
const TAG_LEN = 16;
const DEK_LEN = 32;

/** Un valor cifrado (cualquier versión) dentro de un texto más largo (p. ej. un JSON). */
export const SEALED_TOKEN_RE = /enc:v(?:1:|2:[a-z0-9]{1,16}:[A-Za-z0-9_-]+\.)[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g;

function gcm(key: Buffer, plain: Buffer): { iv: Buffer; tag: Buffer; data: Buffer } {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_LEN });
  const data = Buffer.concat([cipher.update(plain), cipher.final()]);
  return { iv, tag: cipher.getAuthTag(), data };
}

/** Tira si el IV o el tag no tienen el largo exacto (GCM aceptaría tags truncados). */
function ungcm(key: Buffer, iv: Buffer, tag: Buffer, data: Buffer): Buffer {
  if (iv.length !== IV_LEN || tag.length !== TAG_LEN) throw new Error('bad_envelope');
  const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_LEN });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

const b64 = (b: Buffer) => b.toString('base64url');
const unb64 = (s: string | undefined) => Buffer.from(s ?? '', 'base64url');

function sealV2(master: MasterKey, plain: string): string {
  const dek = randomBytes(DEK_LEN);
  const wrapped = gcm(subKey(master, PURPOSE), dek);
  const body = gcm(dek, Buffer.from(plain, 'utf8'));
  dek.fill(0);
  const wrappedDek = Buffer.concat([wrapped.iv, wrapped.tag, wrapped.data]);
  return `${V2}${master.id}:${b64(wrappedDek)}.${b64(body.iv)}.${b64(body.tag)}.${b64(body.data)}`;
}

function sealV1(legacy: MasterKey, plain: string): string {
  const body = gcm(legacy.key, Buffer.from(plain, 'utf8'));
  return `${V1}${b64(body.iv)}.${b64(body.tag)}.${b64(body.data)}`;
}

export function seal(plain: string): string {
  if (!plain) return plain;
  const master = activeKey();
  return usingKeyRing() ? sealV2(master, plain) : sealV1(master, plain);
}

/** Devuelve el texto plano, o '' si no se puede descifrar (clave que ya no está o dato corrupto). */
export function open(value: string | null | undefined): string {
  if (!value) return '';
  if (!value.startsWith(V1) && !value.startsWith(V2)) return value;
  // Una ENCRYPTION_KEYS mal formada tira acá, fuera del try: es un error de configuración,
  // no un dato ilegible, y no tiene que pasar en silencio.
  keyRing();
  try {
    if (value.startsWith(V2)) {
      const rest = value.slice(V2.length);
      const colon = rest.indexOf(':');
      const master = findKey(rest.slice(0, colon));
      if (!master) return '';
      const [wrapped, iv, tag, data] = rest.slice(colon + 1).split('.');
      const w = unb64(wrapped);
      if (w.length !== IV_LEN + TAG_LEN + DEK_LEN) return '';
      const dek = ungcm(subKey(master, PURPOSE), w.subarray(0, IV_LEN), w.subarray(IV_LEN, IV_LEN + TAG_LEN), w.subarray(IV_LEN + TAG_LEN));
      const plain = ungcm(dek, unb64(iv), unb64(tag), unb64(data));
      dek.fill(0);
      return plain.toString('utf8');
    }
    const legacy = findKey(LEGACY_KEY_ID);
    if (!legacy) return '';
    const [iv, tag, data] = value.slice(V1.length).split('.');
    return ungcm(legacy.key, unb64(iv), unb64(tag), unb64(data)).toString('utf8');
  } catch {
    return '';
  }
}

export function isSealed(value: string | null | undefined): boolean {
  return !!value && (value.startsWith(V1) || value.startsWith(V2));
}

/** Id de la clave maestra de un valor cifrado ('0' para v1), o null si no está cifrado. */
export function sealedKeyId(value: string): string | null {
  if (value.startsWith(V1)) return LEGACY_KEY_ID;
  if (!value.startsWith(V2)) return null;
  const rest = value.slice(V2.length);
  return rest.slice(0, rest.indexOf(':'));
}

/** ¿Hay que volver a cifrarlo? (otra clave que la activa, o v1 cuando ya hay ENCRYPTION_KEYS). */
export function needsRotation(value: string): boolean {
  const kid = sealedKeyId(value);
  if (kid === null) return false;
  if (value.startsWith(V1)) return usingKeyRing();
  return kid !== activeKey().id;
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
