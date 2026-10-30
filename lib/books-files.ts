/**
 * Books: comprobantes de gastos privados. Nunca tienen una URL pública; se
 * leen solo por la ruta con sesión y rol (/api/books/expenses/<id>/receipt).
 *
 * Dónde se guardan, en orden (mismo esquema que lib/hiring/files.ts):
 * - BOOKS_BLOB_READ_WRITE_TOKEN: un store de Vercel Blob propio con
 *   `access: 'private'`.
 * - BLOB_READ_WRITE_TOKEN (store público de la suite): el archivo se cifra
 *   (AES-256-GCM) antes del put; en la URL quedan bytes cifrados.
 * - Disco local (self-host y tests): cifrado igual, en UPLOADS_DIR/books-private.
 *
 * Clave: BOOKS_FILES_KEY o, si no está, una derivada con HKDF de
 * ENCRYPTION_KEY / NEXTAUTH_SECRET con la etiqueta "books-files". Cada archivo
 * lleva el id de su clave; BOOKS_FILES_KEY_OLD (separados por coma) sirve
 * para leer lo guardado antes de una rotación.
 *
 * Referencia en la base: "blobp:<pathname>", "blobe:<url>" o "local:<nombre>".
 */
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes, randomUUID } from 'crypto';
import path from 'path';
import { mkdir, readFile, unlink, writeFile } from 'fs/promises';
import { del, get, put } from '@vercel/blob';
import { uploadsRoot } from './uploads';
import { BooksError } from './books-schema';

const LOCAL_NAME = /^[0-9a-f-]{36}\.bin$/;
const LOCAL_DIR = 'books-private';
const MAGIC = Buffer.from('ZSB1');

function derive(secret: string): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, 'zerosoft', 'books-files', 32));
}

function keys(): Buffer[] {
  const out: Buffer[] = [];
  const own = process.env.BOOKS_FILES_KEY?.trim();
  if (own) out.push(createHash('sha256').update(own).digest());
  const base = process.env.ENCRYPTION_KEY || process.env.NEXTAUTH_SECRET || 'zerosoft-dev-encryption-key';
  out.push(derive(base));
  for (const old of (process.env.BOOKS_FILES_KEY_OLD ?? '').split(',').map((x) => x.trim()).filter(Boolean)) {
    out.push(createHash('sha256').update(old).digest(), derive(old));
  }
  return out;
}

const keyId = (k: Buffer) => createHash('sha256').update(k).digest().subarray(0, 8);

/** "ZSB1" + id de la clave (8) + iv (12) + tag (16) + datos. */
export function sealFile(plain: Buffer): Buffer {
  const k = keys()[0];
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', k, iv);
  const data = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, keyId(k), iv, cipher.getAuthTag(), data]);
}

export function openFile(sealed: Buffer): Buffer | null {
  if (sealed.length < 40 || !sealed.subarray(0, 4).equals(MAGIC)) return null;
  const k = keys().find((x) => keyId(x).equals(sealed.subarray(4, 12)));
  if (!k) {
    console.error('[books] falta la clave de un comprobante (¿se rotó el secreto sin BOOKS_FILES_KEY_OLD?)');
    return null;
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', k, sealed.subarray(12, 24));
    decipher.setAuthTag(sealed.subarray(24, 40));
    return Buffer.concat([decipher.update(sealed.subarray(40)), decipher.final()]);
  } catch {
    return null;
  }
}

function privateToken(): string | null {
  return process.env.BOOKS_BLOB_READ_WRITE_TOKEN?.trim() || null;
}

export async function storeBooksFile(bytes: Buffer, mime: string): Promise<string> {
  const name = `${randomUUID()}.bin`;
  const token = privateToken();
  if (token) {
    const blob = await put(`books/${name}`, bytes, { access: 'private', token, contentType: mime, addRandomSuffix: false });
    return `blobp:${blob.pathname}`;
  }
  const sealed = sealFile(bytes);
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const blob = await put(`books-private/${name}`, sealed, { access: 'public', contentType: 'application/octet-stream', addRandomSuffix: true });
    return `blobe:${blob.url}`;
  }
  if (process.env.VERCEL) throw new BooksError('storage_unavailable', 503);
  const dir = path.join(uploadsRoot(), LOCAL_DIR);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, name), sealed);
  return `local:${name}`;
}

export async function readBooksFile(ref: string): Promise<Buffer | null> {
  try {
    if (ref.startsWith('blobp:')) {
      const token = privateToken();
      if (!token) return null;
      const res = await get(ref.slice(6), { access: 'private', token });
      if (!res || res.statusCode !== 200 || !res.stream) return null;
      return Buffer.from(await new Response(res.stream).arrayBuffer());
    }
    if (ref.startsWith('blobe:')) {
      const url = ref.slice(6);
      if (!/^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\//i.test(url)) return null;
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) return null;
      return openFile(Buffer.from(await res.arrayBuffer()));
    }
    if (ref.startsWith('local:')) {
      const name = ref.slice(6);
      if (!LOCAL_NAME.test(name)) return null;
      return openFile(await readFile(path.join(uploadsRoot(), LOCAL_DIR, name)));
    }
  } catch {
    return null;
  }
  return null;
}

export async function deleteBooksFiles(refs: Array<string | null | undefined>): Promise<void> {
  for (const ref of refs) {
    if (!ref) continue;
    try {
      if (ref.startsWith('blobp:')) {
        const token = privateToken();
        if (token) await del(ref.slice(6), { token });
      } else if (ref.startsWith('blobe:')) {
        if (process.env.BLOB_READ_WRITE_TOKEN) await del(ref.slice(6));
      } else if (ref.startsWith('local:') && LOCAL_NAME.test(ref.slice(6))) {
        await unlink(path.join(uploadsRoot(), LOCAL_DIR, ref.slice(6)));
      }
    } catch {
      /* best effort */
    }
  }
}
