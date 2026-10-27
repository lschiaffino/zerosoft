/**
 * Writer de zip mínimo, sin dependencias: archivos guardados sin comprimir
 * (método STORE) o comprimidos con deflate (`deflate: true`, el export de
 * Docs) con su crc32. Alcanza para paquetes como la extensión de Chrome
 * (extensions/chrome) que se descarga desde Ajustes del CRM. Lo lee
 * cualquier descompresor y lib/zip-reader.ts. Sin zip64: hasta 4 GB.
 */
import { deflateRawSync } from 'zlib';

export interface ZipInput {
  /** Ruta dentro del zip con "/" (sin "/" inicial). */
  name: string;
  data: Uint8Array | string;
  /** Fecha de modificación (default: 2026-01-01, así el zip es reproducible). */
  date?: Date;
  /** Comprimir con deflate (texto); las imágenes y PDFs ya vienen comprimidos. */
  deflate?: boolean;
}

let crcTable: Uint32Array | null = null;

function table(): Uint32Array {
  if (crcTable) return crcTable;
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  crcTable = t;
  return t;
}

export function crc32(data: Uint8Array): number {
  const t = table();
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = t[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getUTCFullYear());
  return {
    time: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | Math.floor(d.getUTCSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate(),
  };
}

const DEFAULT_DATE = new Date(Date.UTC(2026, 0, 1));

/** Arma el zip en memoria. Nombres repetidos o con ".." se rechazan. */
export function buildZip(files: ZipInput[]): Buffer {
  const enc = new TextEncoder();
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  const seen = new Set<string>();
  let offset = 0;
  for (const f of files) {
    const name = f.name.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!name || name.split('/').includes('..') || seen.has(name)) throw new Error(`zip_bad_name:${f.name}`);
    seen.add(name);
    const nameBytes = Buffer.from(enc.encode(name));
    const raw = Buffer.from(typeof f.data === 'string' ? enc.encode(f.data) : f.data);
    const crc = crc32(raw);
    const packed = f.deflate ? deflateRawSync(raw) : null;
    // Si comprimido no achica, va sin comprimir.
    const method = packed && packed.length < raw.length ? 8 : 0;
    const data = method === 8 ? packed! : raw;
    const { time, date } = dosTime(f.date ?? DEFAULT_DATE);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // versión necesaria
    local.writeUInt16LE(0x0800, 6); // nombres en UTF-8
    local.writeUInt16LE(method, 8); // 0 STORE, 8 deflate
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBytes, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);

    offset += local.length + nameBytes.length + data.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}
