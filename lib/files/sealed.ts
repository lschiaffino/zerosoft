/**
 * Cifrado por bloques de los archivos de la suite (lib/files/store.ts).
 * Server-only.
 *
 * Formato "ZSF1": una cabecera de 32 bytes y después bloques de hasta
 * CHUNK bytes de texto, cada uno cifrado con AES-256-GCM y su tag:
 *
 *   cabecera = "ZSF1" (4) | id de la clave (8) | tamaño de bloque u32 BE (4) | sal (16)
 *   bloque i = cifrado (hasta CHUNK) | tag (16)
 *
 * La clave de cada archivo sale de la clave maestra con HKDF y la sal (al
 * azar por archivo), así el nonce puede ser el número de bloque sin repetirse
 * nunca entre archivos. Cada bloque autentica la cabecera entera y si es el
 * último (AAD): no se pueden reordenar, cambiar de archivo ni cortar al final.
 *
 * Por qué por bloques: un rango (el reproductor que adelanta un video, un PDF
 * que se lee de a partes) se resuelve pidiendo al storage solo los bloques
 * que tocan ese rango, sin bajar ni descifrar el archivo entero. El tamaño del
 * texto se calcula del tamaño cifrado: no hace falta guardarlo antes de
 * cifrar (el cifrado va en stream, sin saber cuánto mide el archivo).
 *
 * Claves: FILES_KEY (recomendada: no cambia si se rota NEXTAUTH_SECRET) o una
 * derivada con HKDF de ENCRYPTION_KEY / NEXTAUTH_SECRET. FILES_KEY_OLD
 * (separadas por coma) sigue leyendo lo cifrado antes de una rotación.
 */
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'crypto';

export const MAGIC = Buffer.from('ZSF1');
export const HEADER = 32;
export const TAG = 16;
/** 64 KiB: el sobrecosto es 16 bytes por bloque (0,02 %) y un rango chico pide poco de más. */
export const CHUNK = 64 * 1024;

function masterKeys(): Buffer[] {
  const out: Buffer[] = [];
  const own = process.env.FILES_KEY?.trim();
  if (own) out.push(createHash('sha256').update(own).digest());
  const base = process.env.ENCRYPTION_KEY || process.env.NEXTAUTH_SECRET || 'zerosoft-dev-encryption-key';
  out.push(Buffer.from(hkdfSync('sha256', base, 'zerosoft', 'user-files', 32)));
  for (const old of (process.env.FILES_KEY_OLD ?? '').split(',').map((x) => x.trim()).filter(Boolean)) {
    out.push(createHash('sha256').update(old).digest(), Buffer.from(hkdfSync('sha256', old, 'zerosoft', 'user-files', 32)));
  }
  return out;
}

const keyId = (k: Buffer) => createHash('sha256').update(k).digest().subarray(0, 8);
const fileKey = (master: Buffer, salt: Buffer) => Buffer.from(hkdfSync('sha256', master, salt, 'zsf1-file', 32));

function nonce(i: number): Buffer {
  const n = Buffer.alloc(12);
  n.writeUInt32BE(i, 8);
  return n;
}

function aad(header: Buffer, last: boolean): Buffer {
  return Buffer.concat([header, Buffer.from([last ? 1 : 0])]);
}

/** Tamaño cifrado de un texto de `plain` bytes (siempre hay al menos un bloque, aunque sea vacío). */
export function sealedSize(plain: number, chunk = CHUNK): number {
  const chunks = Math.max(1, Math.ceil(plain / chunk));
  return HEADER + plain + chunks * TAG;
}

/** Tamaño del texto a partir del cifrado; null si no puede ser un ZSF1 válido. */
export function plainSize(sealed: number, chunk = CHUNK): number | null {
  const body = sealed - HEADER;
  if (body < TAG) return null;
  const full = Math.floor(body / (chunk + TAG));
  const rem = body % (chunk + TAG);
  if (rem !== 0 && rem < TAG) return null;
  return full * chunk + (rem ? rem - TAG : 0);
}

export class SealedError extends Error {
  constructor(code: 'bad_format' | 'unknown_key' | 'auth_failed') {
    super(code);
  }
}

interface Opened {
  header: Buffer;
  key: Buffer;
  chunk: number;
}

/** Valida la cabecera y busca la clave. */
export function openHeader(header: Buffer): Opened {
  if (header.length < HEADER || !header.subarray(0, 4).equals(MAGIC)) throw new SealedError('bad_format');
  const h = header.subarray(0, HEADER);
  const chunk = h.readUInt32BE(12);
  if (chunk < 1024 || chunk > 16 * 1024 * 1024) throw new SealedError('bad_format');
  const id = h.subarray(4, 12);
  const master = masterKeys().find((k) => keyId(k).equals(id));
  if (!master) throw new SealedError('unknown_key');
  return { header: Buffer.from(h), key: fileKey(master, h.subarray(16, 32)), chunk };
}

function sealChunk(o: Opened, i: number, plain: Buffer, last: boolean): Buffer {
  const c = createCipheriv('aes-256-gcm', o.key, nonce(i));
  c.setAAD(aad(o.header, last));
  return Buffer.concat([c.update(plain), c.final(), c.getAuthTag()]);
}

function openChunk(o: Opened, i: number, sealed: Buffer, last: boolean): Buffer {
  if (sealed.length < TAG) throw new SealedError('bad_format');
  const d = createDecipheriv('aes-256-gcm', o.key, nonce(i));
  d.setAAD(aad(o.header, last));
  d.setAuthTag(sealed.subarray(sealed.length - TAG));
  try {
    return Buffer.concat([d.update(sealed.subarray(0, sealed.length - TAG)), d.final()]);
  } catch {
    throw new SealedError('auth_failed');
  }
}

function newHeader(chunk: number): Opened {
  const master = masterKeys()[0];
  const header = Buffer.alloc(HEADER);
  MAGIC.copy(header, 0);
  keyId(master).copy(header, 4);
  header.writeUInt32BE(chunk, 12);
  randomBytes(16).copy(header, 16);
  return { header, key: fileKey(master, header.subarray(16, 32)), chunk };
}

/** Cifra un buffer entero (archivos chicos). */
export function sealBuffer(plain: Buffer, chunk = CHUNK): Buffer {
  const o = newHeader(chunk);
  const parts: Buffer[] = [o.header];
  const n = Math.max(1, Math.ceil(plain.length / chunk));
  for (let i = 0; i < n; i++) parts.push(sealChunk(o, i, plain.subarray(i * chunk, (i + 1) * chunk), i === n - 1));
  return Buffer.concat(parts);
}

/** Descifra un archivo entero. */
export function openBuffer(sealed: Buffer): Buffer {
  const o = openHeader(sealed);
  const total = plainSize(sealed.length, o.chunk);
  if (total === null) throw new SealedError('bad_format');
  const n = Math.max(1, Math.ceil(total / o.chunk));
  const out: Buffer[] = [];
  for (let i = 0; i < n; i++) {
    const start = HEADER + i * (o.chunk + TAG);
    out.push(openChunk(o, i, sealed.subarray(start, Math.min(sealed.length, start + o.chunk + TAG)), i === n - 1));
  }
  return Buffer.concat(out);
}

/**
 * Cifra en stream (sin saber el tamaño): guarda un bloque hasta saber si
 * viene otro, para marcar bien el último. Corta con `tooLarge()` si el texto
 * pasa de `max` bytes.
 */
export async function* sealStream(
  source: AsyncIterable<Uint8Array>,
  opts: { max?: number; tooLarge?: () => Error; chunk?: number; onSize?: (n: number) => void } = {},
): AsyncGenerator<Buffer> {
  const chunk = opts.chunk ?? CHUNK;
  const o = newHeader(chunk);
  yield o.header;
  let pending = Buffer.alloc(0);
  let index = 0;
  let size = 0;
  for await (const piece of source) {
    size += piece.byteLength;
    if (opts.max !== undefined && size > opts.max) throw opts.tooLarge?.() ?? new Error('file_too_large');
    pending = pending.length ? Buffer.concat([pending, Buffer.from(piece)]) : Buffer.from(piece);
    // Se deja siempre algo en pending: el último bloque se cierra al final.
    while (pending.length > chunk) {
      yield sealChunk(o, index++, pending.subarray(0, chunk), false);
      pending = pending.subarray(chunk);
    }
  }
  yield sealChunk(o, index, pending, true);
  opts.onSize?.(size);
}

/** Bytes cifrados que hay que pedir al storage para el rango [start, end] del texto (inclusive). */
export function sealedRangeFor(start: number, end: number, sealedTotal: number, chunk = CHUNK): { first: number; from: number; to: number } {
  const first = Math.floor(start / chunk);
  const last = Math.floor(end / chunk);
  const from = HEADER + first * (chunk + TAG);
  const to = Math.min(sealedTotal - 1, HEADER + (last + 1) * (chunk + TAG) - 1);
  return { first, from, to };
}

/**
 * Descifra en stream los bytes cifrados de [from, to] (lo que devolvió
 * sealedRangeFor) y entrega solo el rango [start, end] del texto.
 */
export async function* openRangeStream(
  headerBytes: Buffer,
  body: AsyncIterable<Uint8Array>,
  r: { start: number; end: number; first: number; sealedTotal: number },
): AsyncGenerator<Buffer> {
  const o = openHeader(headerBytes);
  const total = plainSize(r.sealedTotal, o.chunk);
  if (total === null) throw new SealedError('bad_format');
  const lastIndex = Math.max(0, Math.ceil(total / o.chunk) - 1);
  let index = r.first;
  let buf = Buffer.alloc(0);
  const emit = (plain: Buffer, i: number): Buffer | null => {
    const base = i * o.chunk;
    const s = Math.max(r.start, base) - base;
    const e = Math.min(r.end, base + plain.length - 1) - base;
    return e >= s ? plain.subarray(s, e + 1) : null;
  };
  for await (const piece of body) {
    buf = buf.length ? Buffer.concat([buf, Buffer.from(piece)]) : Buffer.from(piece);
    while (buf.length >= o.chunk + TAG && index <= lastIndex) {
      const plain = openChunk(o, index, buf.subarray(0, o.chunk + TAG), index === lastIndex);
      buf = buf.subarray(o.chunk + TAG);
      const out = emit(plain, index++);
      if (out) yield out;
      if (index * o.chunk > r.end) return;
    }
  }
  if (buf.length && index <= lastIndex) {
    const out = emit(openChunk(o, index, buf, index === lastIndex), index);
    if (out) yield out;
  }
}
