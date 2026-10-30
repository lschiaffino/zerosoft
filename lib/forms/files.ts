/**
 * Forms: archivos de las respuestas (preguntas de archivo y firmas). Mismo
 * esquema que los CVs de Hiring (lib/hiring/files.ts): nunca tienen URL
 * pública; se guardan cifrados (o en un store privado de Vercel Blob) y solo
 * se leen por /api/forms/files/<id> con el acceso al formulario.
 *
 * El tipo se decide por los bytes (no por la extensión ni el content-type
 * del navegador) y el tamaño tiene tope por pregunta (máximo 10 MB).
 */
import path from 'path';
import { randomUUID } from 'crypto';
import { mkdir, readFile, unlink, writeFile } from 'fs/promises';
import { del, get, put } from '@vercel/blob';
import { uploadsRoot } from '../uploads';
import { openFile, sealFile } from '../hiring/files';
import { FormsError } from './types';

const LOCAL_NAME = /^[0-9a-f-]{36}\.bin$/;
export const FORMS_FILE_MAX_BYTES = 10 * 1024 * 1024;

export interface SniffedFile {
  mime: string;
  ext: string;
}

/** Tipo real por los primeros bytes. PDF, imágenes comunes y documentos de Office. */
export function sniffFormFile(b: Uint8Array, filename: string): SniffedFile | null {
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  const starts = (...sig: number[]) => b.length >= sig.length && sig.every((x, i) => b[i] === x);
  if (starts(0x25, 0x50, 0x44, 0x46, 0x2d)) return { mime: 'application/pdf', ext: 'pdf' };
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return { mime: 'image/png', ext: 'png' };
  if (starts(0xff, 0xd8, 0xff)) return { mime: 'image/jpeg', ext: 'jpg' };
  if (starts(0x47, 0x49, 0x46, 0x38)) return { mime: 'image/gif', ext: 'gif' };
  if (starts(0x52, 0x49, 0x46, 0x46) && b.length >= 12 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return { mime: 'image/webp', ext: 'webp' };
  if (starts(0x50, 0x4b, 0x03, 0x04)) {
    if (ext === 'docx') return { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: 'docx' };
    if (ext === 'xlsx') return { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: 'xlsx' };
    return null;
  }
  if (starts(0xd0, 0xcf, 0x11, 0xe0) && ext === 'doc') return { mime: 'application/msword', ext: 'doc' };
  return null;
}

export function safeFileName(name: string, ext: string): string {
  const base = (name.replace(/[^\w.\- ]+/g, '_').slice(-100) || `file.${ext}`).replace(/\.[^.]*$/, '');
  return `${base || 'file'}.${ext}`;
}

function privateToken(): string | null {
  return process.env.FORMS_BLOB_READ_WRITE_TOKEN?.trim() || process.env.HIRING_BLOB_READ_WRITE_TOKEN?.trim() || null;
}

export async function storeFormFile(bytes: Buffer, mime: string): Promise<string> {
  const name = `${randomUUID()}.bin`;
  const token = privateToken();
  if (token) {
    const blob = await put(`forms/${name}`, bytes, { access: 'private', token, contentType: mime, addRandomSuffix: false });
    return `blobp:${blob.pathname}`;
  }
  const sealed = sealFile(bytes);
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const blob = await put(`forms/${name}`, sealed, { access: 'public', contentType: 'application/octet-stream', addRandomSuffix: true });
    return `blobe:${blob.url}`;
  }
  if (process.env.VERCEL) throw new FormsError('storage_unavailable', 503);
  const dir = path.join(uploadsRoot(), 'forms');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, name), sealed);
  return `local:${name}`;
}

export async function readFormFile(ref: string): Promise<Buffer | null> {
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
      return openFile(Buffer.from(await res.arrayBuffer()));
    }
    if (ref.startsWith('local:')) {
      const name = ref.slice(6);
      if (!LOCAL_NAME.test(name)) return null;
      return openFile(await readFile(path.join(uploadsRoot(), 'forms', name)));
    }
  } catch {
    return null;
  }
  return null;
}

export async function deleteFormFiles(refs: Array<string | null | undefined>): Promise<void> {
  for (const ref of refs) {
    if (!ref) continue;
    try {
      if (ref.startsWith('blobp:')) {
        const token = privateToken();
        if (token) await del(ref.slice(6), { token });
      } else if (ref.startsWith('blobe:')) {
        if (process.env.BLOB_READ_WRITE_TOKEN) await del(ref.slice(6));
      } else if (ref.startsWith('local:') && LOCAL_NAME.test(ref.slice(6))) {
        await unlink(path.join(uploadsRoot(), 'forms', ref.slice(6)));
      }
    } catch {
      /* best effort: la fila ya se borró */
    }
  }
}
