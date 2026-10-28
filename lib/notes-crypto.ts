/**
 * Notes — notas bloqueadas con contraseña. Todo pasa en el navegador con
 * WebCrypto: la contraseña nunca sale del dispositivo y el servidor solo
 * guarda el sobre cifrado (NoteLockEnvelope).
 *
 * - Clave: PBKDF2-SHA256 (NOTE_LOCK_ITERATIONS) sobre la contraseña con una
 *   sal aleatoria de 16 bytes → AES-GCM de 256 bits, no exportable.
 * - Cada guardado cifra { title, content } con un IV nuevo de 12 bytes.
 * - Una contraseña equivocada falla en la verificación de AES-GCM
 *   (WrongPasswordError): no hay forma de recuperarla.
 * - Sobre v2: PBKDF2 da 32 bytes (una sola pasada, el costo de siempre) y
 *   HKDF-SHA256 saca de ahí dos valores independientes: la clave AES
 *   ("zs-notes/aes") y la "prueba" de que se sabe la contraseña
 *   ("zs-notes/proof"). El sobre guarda solo el SHA-256 de la prueba (vh);
 *   para reemplazar el sobre o sacar el bloqueo el servidor pide la prueba y
 *   compara. La prueba no sirve para descifrar.
 * - Sobre v1 (de antes): PBKDF2 de 64 bytes partido en clave y prueba. Se
 *   sigue abriendo; los guardados nuevos de esa nota siguen en v1 (misma
 *   clave, mismo verificador) hasta que se le saque y vuelva a poner el bloqueo.
 *
 * Client-safe (también corre en Node para los tests: globalThis.crypto).
 */
import type { DocsBlock } from './docs-types';
import type { NoteLockEnvelope } from './notes-types';

export const NOTE_LOCK_ITERATIONS = 310_000;
export const NOTE_LOCK_MIN_PASSWORD = 4;

export interface LockedPayload {
  title: string;
  content: DocsBlock[];
}

/** Clave abierta de una nota (vive solo en memoria mientras la nota está desbloqueada). */
export interface NoteKey {
  key: CryptoKey;
  salt: string;
  iter: number;
  /** Prueba de la contraseña (base64 de 32 bytes): la pide el servidor para cambiar el sobre. */
  proof: string;
  /** SHA-256 de la prueba (base64): va en el sobre. */
  vh: string;
  /** Versión del sobre que se arma con esta clave. */
  v: 1 | 2;
}

export const NOTE_LOCK_VERSION = 2 as const;

export class WrongPasswordError extends Error {
  constructor() {
    super('wrong_password');
    this.name = 'WrongPasswordError';
  }
}

function subtle(): SubtleCrypto {
  const c = globalThis.crypto;
  if (!c?.subtle) throw new Error('webcrypto_unavailable');
  return c.subtle;
}

/** ¿El navegador puede cifrar? (WebCrypto solo existe en contextos seguros). */
export function noteLockSupported(): boolean {
  return Boolean(globalThis.crypto?.subtle);
}

export function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out;
}

/** SHA-256 en base64 (el verificador de la prueba). */
export async function sha256b64(bytes: Uint8Array): Promise<string> {
  return toBase64(new Uint8Array(await subtle().digest('SHA-256', bytes as BufferSource)));
}

/** Deriva la clave AES-GCM y la prueba de la contraseña con la sal (según la versión del sobre). */
export async function deriveNoteKey(password: string, salt: string, iter = NOTE_LOCK_ITERATIONS, v: 1 | 2 = NOTE_LOCK_VERSION): Promise<NoteKey> {
  const base = await subtle().importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const pbkdf2 = { name: 'PBKDF2', hash: 'SHA-256', salt: fromBase64(salt) as BufferSource, iterations: iter };
  let keyBytes: Uint8Array;
  let proofBytes: Uint8Array;
  if (v === 1) {
    const bits = new Uint8Array(await subtle().deriveBits(pbkdf2, base, 512));
    keyBytes = bits.slice(0, 32);
    proofBytes = bits.slice(32);
  } else {
    const master = new Uint8Array(await subtle().deriveBits(pbkdf2, base, 256));
    const hk = await subtle().importKey('raw', master as BufferSource, 'HKDF', false, ['deriveBits']);
    const expand = async (info: string) =>
      new Uint8Array(
        await subtle().deriveBits(
          { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0) as BufferSource, info: new TextEncoder().encode(info) as BufferSource },
          hk,
          256,
        ),
      );
    keyBytes = await expand('zs-notes/aes');
    proofBytes = await expand('zs-notes/proof');
  }
  const key = await subtle().importKey('raw', keyBytes as BufferSource, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  return { key, salt, iter, v, proof: toBase64(proofBytes), vh: await sha256b64(proofBytes) };
}

/** Clave nueva (sal aleatoria) para bloquear una nota. */
export async function newNoteKey(password: string, iter = NOTE_LOCK_ITERATIONS): Promise<NoteKey> {
  return deriveNoteKey(password, toBase64(randomBytes(16)), iter);
}

/** Cifra título y contenido con la clave (IV nuevo cada vez). */
export async function sealNote(k: NoteKey, payload: LockedPayload, hint?: string): Promise<NoteLockEnvelope> {
  const iv = randomBytes(12);
  const data = new TextEncoder().encode(JSON.stringify(payload));
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, k.key, data));
  const env: NoteLockEnvelope = { v: k.v, iter: k.iter, salt: k.salt, iv: toBase64(iv), ct: toBase64(ct), vh: k.vh };
  if (hint?.trim()) env.hint = hint.trim().slice(0, 120);
  return env;
}

/** Abre el sobre con una clave ya derivada. */
export async function openNoteWithKey(k: NoteKey, env: NoteLockEnvelope): Promise<LockedPayload> {
  let plain: ArrayBuffer;
  try {
    plain = await subtle().decrypt({ name: 'AES-GCM', iv: fromBase64(env.iv) as BufferSource }, k.key, fromBase64(env.ct) as BufferSource);
  } catch {
    throw new WrongPasswordError();
  }
  const parsed = JSON.parse(new TextDecoder().decode(plain)) as Partial<LockedPayload>;
  return { title: String(parsed.title ?? ''), content: Array.isArray(parsed.content) ? parsed.content : [] };
}

/**
 * Lo único que viaja en claro de una nota bloqueada: los bloques de archivos
 * (id, tipo, URL, nombre, tamaño, MIME) para que el servidor los pueda
 * servir. Todo el texto queda solo adentro del sobre.
 */
export function fileBlocksOnly(blocks: DocsBlock[]): DocsBlock[] {
  return blocks
    .filter((b) => ['image', 'file', 'video', 'audio', 'pdf'].includes(b.type))
    .map((b) => ({ id: b.id, type: b.type, content: '', url: b.url, name: b.name, size: b.size, mime: b.mime }));
}

/** Abre el sobre con la contraseña: devuelve el contenido y la clave para volver a cifrar. */
export async function openNote(password: string, env: NoteLockEnvelope): Promise<{ payload: LockedPayload; key: NoteKey }> {
  const key = await deriveNoteKey(password, env.salt, env.iter, env.v === 1 ? 1 : 2);
  return { payload: await openNoteWithKey(key, env), key };
}
