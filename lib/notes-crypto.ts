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
}

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

/** Deriva la clave AES-GCM de la contraseña y la sal. */
export async function deriveNoteKey(password: string, salt: string, iter = NOTE_LOCK_ITERATIONS): Promise<NoteKey> {
  const base = await subtle().importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  const key = await subtle().deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: fromBase64(salt) as BufferSource, iterations: iter },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
  return { key, salt, iter };
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
  const env: NoteLockEnvelope = { v: 1, iter: k.iter, salt: k.salt, iv: toBase64(iv), ct: toBase64(ct) };
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
  const key = await deriveNoteKey(password, env.salt, env.iter);
  return { payload: await openNoteWithKey(key, env), key };
}
