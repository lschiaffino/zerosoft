/**
 * Lector de zip por rangos, sin dependencias: lee el directorio central y
 * cada archivo pidiendo solo los bytes que hacen falta (un Range a Vercel
 * Blob, un read posicionado en disco o un slice de un Buffer). Así un export
 * de Notion de cientos de MB se procesa por tandas sin bajarlo entero en cada
 * request. Soporta stored y deflate, zip64 y tope de tamaño por archivo
 * descomprimido (nada de zip bombs). Solo servidor.
 */
import { open as openFile } from 'fs/promises';
import { deflateRawSync, inflateRawSync } from 'zlib';

export interface ZipSource {
  size(): Promise<number>;
  read(offset: number, length: number): Promise<Buffer>;
}

export class ZipError extends Error {
  constructor(public code: 'invalid_zip' | 'zip_entry_too_large' | 'zip_unsupported') {
    super(code);
    this.name = 'ZipError';
  }
}

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  /** Offset del local header dentro de la fuente. */
  offset: number;
}

export function bufferSource(buf: Buffer): ZipSource {
  return {
    size: async () => buf.length,
    read: async (offset, length) => buf.subarray(offset, Math.min(buf.length, offset + length)),
  };
}

/** Una parte de otra fuente (un zip guardado sin comprimir adentro de otro). */
export function sliceSource(src: ZipSource, base: number, length: number): ZipSource {
  return {
    size: async () => length,
    read: (offset, len) => src.read(base + offset, Math.max(0, Math.min(len, length - offset))),
  };
}

export function fileSource(path: string): ZipSource {
  return {
    async size() {
      const fh = await openFile(path, 'r');
      try {
        return (await fh.stat()).size;
      } finally {
        await fh.close();
      }
    },
    async read(offset, length) {
      const fh = await openFile(path, 'r');
      try {
        const buf = Buffer.alloc(length);
        const { bytesRead } = await fh.read(buf, 0, length, offset);
        return buf.subarray(0, bytesRead);
      } finally {
        await fh.close();
      }
    },
  };
}

/** Archivo por HTTP con Range (Vercel Blob lo soporta). */
export function urlSource(url: string, headers: Record<string, string> = {}): ZipSource {
  let size: number | null = null;
  return {
    async size() {
      if (size !== null) return size;
      const res = await fetch(url, { method: 'HEAD', headers, cache: 'no-store' });
      if (!res.ok) throw new ZipError('invalid_zip');
      size = Number(res.headers.get('content-length'));
      if (!Number.isFinite(size) || size <= 0) throw new ZipError('invalid_zip');
      return size;
    },
    async read(offset, length) {
      if (length <= 0) return Buffer.alloc(0);
      const res = await fetch(url, { headers: { ...headers, range: `bytes=${offset}-${offset + length - 1}` }, cache: 'no-store' });
      if (res.status !== 206 && res.status !== 200) throw new ZipError('invalid_zip');
      const buf = Buffer.from(await res.arrayBuffer());
      // Un servidor sin Range devuelve todo: se recorta.
      return res.status === 200 ? buf.subarray(offset, offset + length) : buf;
    },
  };
}

const EOCD = 0x06054b50;
const EOCD64 = 0x06064b50;
const EOCD64_LOCATOR = 0x07064b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

function readU64(buf: Buffer, at: number): number {
  return Number(buf.readBigUInt64LE(at));
}

export async function listZipEntries(src: ZipSource): Promise<ZipEntry[]> {
  const total = await src.size();
  if (total < 22) throw new ZipError('invalid_zip');
  const tailLen = Math.min(total, 65_557);
  const tail = await src.read(total - tailLen, tailLen);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new ZipError('invalid_zip');
  let count = tail.readUInt16LE(eocd + 10);
  let cdSize = tail.readUInt32LE(eocd + 12);
  let cdOffset = tail.readUInt32LE(eocd + 16);

  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    const loc = eocd - 20;
    if (loc < 0 || tail.readUInt32LE(loc) !== EOCD64_LOCATOR) throw new ZipError('invalid_zip');
    const eocd64At = readU64(tail, loc + 8);
    const rec = await src.read(eocd64At, 56);
    if (rec.length < 56 || rec.readUInt32LE(0) !== EOCD64) throw new ZipError('invalid_zip');
    count = readU64(rec, 32);
    cdSize = readU64(rec, 40);
    cdOffset = readU64(rec, 48);
  }
  if (cdOffset + cdSize > total || cdSize > 64 * 1024 * 1024) throw new ZipError('invalid_zip');

  const cd = await src.read(cdOffset, cdSize);
  const entries: ZipEntry[] = [];
  let p = 0;
  for (let n = 0; n < count && p + 46 <= cd.length; n++) {
    if (cd.readUInt32LE(p) !== CENTRAL) break;
    const method = cd.readUInt16LE(p + 10);
    let compressedSize = cd.readUInt32LE(p + 20);
    let size = cd.readUInt32LE(p + 24);
    const nameLen = cd.readUInt16LE(p + 28);
    const extraLen = cd.readUInt16LE(p + 30);
    const commentLen = cd.readUInt16LE(p + 32);
    let offset = cd.readUInt32LE(p + 42);
    // Notion (y casi todo) marca UTF-8 (bit 11); sin la marca igual se lee como UTF-8.
    const name = cd.toString('utf8', p + 46, p + 46 + nameLen);
    // Zip64: los campos en 0xFFFFFFFF vienen en el extra 0x0001, en este orden.
    let e = p + 46 + nameLen;
    const extraEnd = e + extraLen;
    while (e + 4 <= extraEnd) {
      const id = cd.readUInt16LE(e);
      const len = cd.readUInt16LE(e + 2);
      if (id === 0x0001) {
        let q = e + 4;
        if (size === 0xffffffff) {
          size = readU64(cd, q);
          q += 8;
        }
        if (compressedSize === 0xffffffff) {
          compressedSize = readU64(cd, q);
          q += 8;
        }
        if (offset === 0xffffffff) offset = readU64(cd, q);
      }
      e += 4 + len;
    }
    if (!name.endsWith('/')) entries.push({ name, method, compressedSize, size, offset });
    p = extraEnd + commentLen;
  }
  return entries;
}

/** Offset donde empiezan los datos del archivo (después del local header). */
export async function zipEntryDataOffset(src: ZipSource, entry: ZipEntry): Promise<number> {
  const head = await src.read(entry.offset, 30);
  if (head.length < 30 || head.readUInt32LE(0) !== LOCAL) throw new ZipError('invalid_zip');
  return entry.offset + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
}

export async function readZipEntry(src: ZipSource, entry: ZipEntry, maxBytes: number): Promise<Buffer> {
  if (entry.size > maxBytes) throw new ZipError('zip_entry_too_large');
  const start = await zipEntryDataOffset(src, entry);
  const data = await src.read(start, entry.compressedSize);
  if (entry.method === 0) return data;
  if (entry.method !== 8) throw new ZipError('zip_unsupported');
  try {
    return inflateRawSync(data, { maxOutputLength: maxBytes });
  } catch {
    throw new ZipError('zip_entry_too_large');
  }
}

// ---------- Escritura (tests y fixtures) ----------

/** CRC-32 (para armar zips en los tests y en fixtures). */
function crc32(buf: Buffer): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}

/** Zip mínimo (stored o deflate) a partir de archivos en memoria. */
export function buildZip(files: Array<{ name: string; data: Buffer | string; deflate?: boolean }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const raw = typeof f.data === 'string' ? Buffer.from(f.data, 'utf8') : f.data;
    const body = f.deflate ? deflateRawSync(raw) : raw;
    const name = Buffer.from(f.name, 'utf8');
    const crc = crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(f.deflate ? 8 : 0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, body);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt16LE(f.deflate ? 8 : 0, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(EOCD, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
