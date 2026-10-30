/**
 * Archivos privados de una app (CVs de Hiring, PDFs firmados de Sign). Nunca
 * tienen una URL pública; se leen solo por la ruta de la app con chequeo de
 * permisos. Server-only.
 *
 * Dónde se guardan, en orden:
 * - <APP>_BLOB_READ_WRITE_TOKEN: un store de Vercel Blob propio, con
 *   `access: 'private'` (se lee con get() y el token).
 * - BLOB_READ_WRITE_TOKEN (store público de la suite): el archivo se cifra
 *   (AES-256-GCM) antes del put; lo que queda en la URL son bytes cifrados.
 * - Disco local (self-host y tests): cifrado igual, en UPLOADS_DIR/<carpeta>.
 *
 * Clave de los archivos cifrados: <APP>_FILES_KEY (recomendada: no cambia si
 * se rota NEXTAUTH_SECRET) o, si no está, una derivada con HKDF de
 * ENCRYPTION_KEY / NEXTAUTH_SECRET con la etiqueta de la app. Cada archivo
 * lleva el id de su clave; <APP>_FILES_KEY_OLD (secretos anteriores,
 * separados por coma) sigue sirviendo para leer lo guardado antes de una
 * rotación.
 *
 * La referencia guardada en la base es "blobp:<pathname>", "blobe:<url>" o
 * "local:<nombre>".
 */
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes, randomUUID } from 'crypto';
import path from 'path';
import { mkdir, readFile, unlink, writeFile } from 'fs/promises';
import { del, get, put } from '@vercel/blob';
import { uploadsRoot } from './uploads';

export interface PrivateFileStoreOptions {
  /** Carpeta (Blob y disco) y prefijo de los logs: 'hiring', 'sign'. */
  folder: string;
  /** Prefijo de las variables: HIRING → HIRING_BLOB_READ_WRITE_TOKEN, HIRING_FILES_KEY, HIRING_FILES_KEY_OLD. */
  envPrefix: string;
  /** Etiqueta del HKDF de la clave derivada ("hiring-files"). */
  hkdfLabel: string;
  /** Cabecera de 4 bytes de los archivos cifrados ("ZSH1"). */
  magic: string;
  /** Error a tirar si no hay dónde guardar (Vercel sin Blob). */
  unavailable: () => Error;
}

export interface PrivateFileStore {
  seal(plain: Buffer): Buffer;
  open(sealed: Buffer): Buffer | null;
  store(bytes: Buffer, mime: string): Promise<string>;
  read(ref: string): Promise<Buffer | null>;
  remove(refs: Array<string | null | undefined>): Promise<void>;
}

const LOCAL_NAME = /^[0-9a-f-]{36}\.bin$/;

export function privateFileStore(o: PrivateFileStoreOptions): PrivateFileStore {
  const MAGIC = Buffer.from(o.magic);
  const derive = (secret: string) => Buffer.from(hkdfSync('sha256', secret, 'zerosoft', o.hkdfLabel, 32));

  /** Claves posibles: la actual primero, después las viejas (cada secreto, directo o derivado). */
  function keys(): Buffer[] {
    const out: Buffer[] = [];
    const own = process.env[`${o.envPrefix}_FILES_KEY`]?.trim();
    if (own) out.push(createHash('sha256').update(own).digest());
    const base = process.env.ENCRYPTION_KEY || process.env.NEXTAUTH_SECRET || 'zerosoft-dev-encryption-key';
    out.push(derive(base));
    for (const old of (process.env[`${o.envPrefix}_FILES_KEY_OLD`] ?? '').split(',').map((x) => x.trim()).filter(Boolean)) {
      out.push(createHash('sha256').update(old).digest(), derive(old));
    }
    return out;
  }
  const keyId = (k: Buffer) => createHash('sha256').update(k).digest().subarray(0, 8);
  const privateToken = () => process.env[`${o.envPrefix}_BLOB_READ_WRITE_TOKEN`]?.trim() || null;

  /** "<magic>" + id de la clave (8) + iv (12) + tag (16) + datos. */
  function seal(plain: Buffer): Buffer {
    const k = keys()[0];
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', k, iv);
    const data = Buffer.concat([cipher.update(plain), cipher.final()]);
    return Buffer.concat([MAGIC, keyId(k), iv, cipher.getAuthTag(), data]);
  }

  function open(sealed: Buffer): Buffer | null {
    if (sealed.length < 40 || !sealed.subarray(0, 4).equals(MAGIC)) {
      console.error(`[${o.folder}] archivo cifrado con formato desconocido`);
      return null;
    }
    const id = sealed.subarray(4, 12);
    const k = keys().find((x) => keyId(x).equals(id));
    if (!k) {
      console.error(`[${o.folder}] no está la clave de un archivo (¿se rotó el secreto sin ${o.envPrefix}_FILES_KEY_OLD?)`);
      return null;
    }
    try {
      const decipher = createDecipheriv('aes-256-gcm', k, sealed.subarray(12, 24));
      decipher.setAuthTag(sealed.subarray(24, 40));
      return Buffer.concat([decipher.update(sealed.subarray(40)), decipher.final()]);
    } catch {
      console.error(`[${o.folder}] no se pudo descifrar un archivo`);
      return null;
    }
  }

  async function store(bytes: Buffer, mime: string): Promise<string> {
    const name = `${randomUUID()}.bin`;
    const token = privateToken();
    if (token) {
      const blob = await put(`${o.folder}/${name}`, bytes, { access: 'private', token, contentType: mime, addRandomSuffix: false });
      return `blobp:${blob.pathname}`;
    }
    const sealed = seal(bytes);
    if (process.env.BLOB_READ_WRITE_TOKEN) {
      const blob = await put(`${o.folder}/${name}`, sealed, { access: 'public', contentType: 'application/octet-stream', addRandomSuffix: true });
      return `blobe:${blob.url}`;
    }
    if (process.env.VERCEL) throw o.unavailable();
    const dir = path.join(uploadsRoot(), o.folder);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, name), sealed);
    return `local:${name}`;
  }

  async function read(ref: string): Promise<Buffer | null> {
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
        return open(Buffer.from(await res.arrayBuffer()));
      }
      if (ref.startsWith('local:')) {
        const name = ref.slice(6);
        if (!LOCAL_NAME.test(name)) return null;
        return open(await readFile(path.join(uploadsRoot(), o.folder, name)));
      }
    } catch {
      return null;
    }
    return null;
  }

  async function remove(refs: Array<string | null | undefined>): Promise<void> {
    for (const ref of refs) {
      if (!ref) continue;
      try {
        if (ref.startsWith('blobp:')) {
          const token = privateToken();
          if (token) await del(ref.slice(6), { token });
        } else if (ref.startsWith('blobe:')) {
          if (process.env.BLOB_READ_WRITE_TOKEN) await del(ref.slice(6));
        } else if (ref.startsWith('local:') && LOCAL_NAME.test(ref.slice(6))) {
          await unlink(path.join(uploadsRoot(), o.folder, ref.slice(6)));
        }
      } catch {
        /* best effort: la fila ya se borró */
      }
    }
  }

  return { seal, open, store, read, remove };
}
