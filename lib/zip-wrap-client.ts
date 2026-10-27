/**
 * Un archivo suelto (.docx, .enex, .html, .md) → zip sin comprimir con ese
 * único archivo, en el navegador y sin cargarlo entero en memoria: el CRC se
 * calcula leyendo el archivo por partes y el Blob final referencia al File.
 * Así el importador de Docs (que lee zips por rangos) recibe siempre un zip.
 * Hasta 4 GB (sin zip64).
 */

let table: Uint32Array | null = null;

function crcTable(): Uint32Array {
  if (table) return table;
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  table = t;
  return t;
}

export async function crc32OfBlob(blob: Blob, chunk = 4 * 1024 * 1024): Promise<number> {
  const t = crcTable();
  let c = 0xffffffff;
  for (let off = 0; off < blob.size; off += chunk) {
    const bytes = new Uint8Array(await blob.slice(off, off + chunk).arrayBuffer());
    for (let i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** Nombre del archivo dentro del zip: sin carpetas ni caracteres de control. */
export function zipEntryName(name: string): string {
  return name.replace(/[\\/]/g, '_').replace(/[\u0000-\u001f]/g, '').slice(0, 200) || 'file';
}

export async function wrapFileInZip(file: Blob & { name?: string }): Promise<Blob> {
  const name = new TextEncoder().encode(zipEntryName(file.name ?? 'file'));
  const crc = await crc32OfBlob(file);
  const size = file.size;
  const local = new DataView(new ArrayBuffer(30));
  local.setUint32(0, 0x04034b50, true);
  local.setUint16(4, 20, true);
  local.setUint16(6, 0x0800, true);
  local.setUint16(8, 0, true);
  local.setUint32(14, crc, true);
  local.setUint32(18, size, true);
  local.setUint32(22, size, true);
  local.setUint16(26, name.length, true);
  const central = new DataView(new ArrayBuffer(46));
  central.setUint32(0, 0x02014b50, true);
  central.setUint16(4, 20, true);
  central.setUint16(6, 20, true);
  central.setUint16(8, 0x0800, true);
  central.setUint32(16, crc, true);
  central.setUint32(20, size, true);
  central.setUint32(24, size, true);
  central.setUint16(28, name.length, true);
  central.setUint32(42, 0, true);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, 1, true);
  end.setUint16(10, 1, true);
  end.setUint32(12, 46 + name.length, true);
  end.setUint32(16, 30 + name.length + size, true);
  return new Blob([local.buffer, name, file, central.buffer, name, end.buffer], { type: 'application/zip' });
}
