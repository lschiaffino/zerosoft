/**
 * Hiring: archivos privados de candidatos (CVs y documentos). Nunca tienen
 * una URL pública; se leen solo por la ruta con chequeo de permisos.
 *
 * Dónde se guardan, en orden:
 * - HIRING_BLOB_READ_WRITE_TOKEN: un store de Vercel Blob propio, con
 *   `access: 'private'` (se lee con get() y el token).
 * - BLOB_READ_WRITE_TOKEN (store público de la suite): el archivo se cifra con
 *   lib/secret-box (AES-256-GCM) antes del put; lo que queda en la URL son
 *   bytes cifrados.
 * - Disco local (self-host y tests): cifrado igual, en UPLOADS_DIR/hiring.
 *
 * La referencia guardada en la base es "blobp:<pathname>", "blobe:<url>" o
 * "local:<nombre>".
 */
import { randomUUID } from 'crypto';
import path from 'path';
import { mkdir, readFile, unlink, writeFile } from 'fs/promises';
import { del, get, put } from '@vercel/blob';
import { openBytes, sealBytes } from '../secret-box';
import { uploadsRoot } from '../uploads';
import { HiringError } from './types';

const LOCAL_NAME = /^[0-9a-f-]{36}\.bin$/;

function privateToken(): string | null {
  return process.env.HIRING_BLOB_READ_WRITE_TOKEN?.trim() || null;
}

export async function storeHiringFile(bytes: Buffer, mime: string): Promise<string> {
  const name = `${randomUUID()}.bin`;
  const token = privateToken();
  if (token) {
    const blob = await put(`hiring/${name}`, bytes, { access: 'private', token, contentType: mime, addRandomSuffix: false });
    return `blobp:${blob.pathname}`;
  }
  const sealed = sealBytes(bytes);
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const blob = await put(`hiring/${name}`, sealed, { access: 'public', contentType: 'application/octet-stream', addRandomSuffix: true });
    return `blobe:${blob.url}`;
  }
  if (process.env.VERCEL) throw new HiringError('storage_unavailable', 503);
  const dir = path.join(uploadsRoot(), 'hiring');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, name), sealed);
  return `local:${name}`;
}

export async function readHiringFile(ref: string): Promise<Buffer | null> {
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
      const res = await fetch(url);
      if (!res.ok) return null;
      return openBytes(Buffer.from(await res.arrayBuffer()));
    }
    if (ref.startsWith('local:')) {
      const name = ref.slice(6);
      if (!LOCAL_NAME.test(name)) return null;
      return openBytes(await readFile(path.join(uploadsRoot(), 'hiring', name)));
    }
  } catch {
    return null;
  }
  return null;
}

export async function deleteHiringFiles(refs: Array<string | null | undefined>): Promise<void> {
  for (const ref of refs) {
    if (!ref) continue;
    try {
      if (ref.startsWith('blobp:')) {
        const token = privateToken();
        if (token) await del(ref.slice(6), { token });
      } else if (ref.startsWith('blobe:')) {
        if (process.env.BLOB_READ_WRITE_TOKEN) await del(ref.slice(6));
      } else if (ref.startsWith('local:') && LOCAL_NAME.test(ref.slice(6))) {
        await unlink(path.join(uploadsRoot(), 'hiring', ref.slice(6)));
      }
    } catch {
      /* best effort: la fila ya se borró */
    }
  }
}
