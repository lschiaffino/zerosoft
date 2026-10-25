/**
 * Duración en el header de un WebM de MediaRecorder.
 *
 * Chrome y Firefox escriben el WebM en vivo: el Segment tiene tamaño
 * desconocido y la Info no trae Duration, así que el reproductor muestra
 * "∞" y no deja adelantar hasta bajar todo el archivo. Como subimos el video
 * por partes mientras se graba, la primera parte (la que tiene el header) se
 * guarda hasta el final y acá se le escribe la duración antes de subirla.
 *
 * Lógica pura sobre bytes (la usa el navegador y la prueban los unit tests).
 */

const ID_EBML = 0x1a45dfa3;
const ID_SEGMENT = 0x18538067;
const ID_INFO = 0x1549a966;
const ID_DURATION = 0x4489;
const ID_CLUSTER = 0x1f43b675;
const ID_TIMECODE_SCALE = 0x2ad7b1;

interface Vint {
  value: number;
  length: number;
  unknown: boolean;
}

/** ID de un elemento (con los bits de marca, como se escriben en la spec). */
function readId(b: Uint8Array, pos: number): Vint | null {
  const first = b[pos];
  if (first === undefined) return null;
  let length = 0;
  for (let mask = 0x80; mask >= 0x10; mask >>= 1) {
    length++;
    if (first & mask) break;
    if (mask === 0x10) return null;
  }
  if (pos + length > b.length) return null;
  let value = 0;
  for (let i = 0; i < length; i++) value = value * 256 + b[pos + i];
  return { value, length, unknown: false };
}

/** Tamaño de un elemento (vint sin la marca). Todos unos = desconocido. */
function readSize(b: Uint8Array, pos: number): Vint | null {
  const first = b[pos];
  if (first === undefined || first === 0) return null;
  let length = 1;
  let mask = 0x80;
  while (!(first & mask)) {
    mask >>= 1;
    length++;
  }
  if (pos + length > b.length) return null;
  let value = first & (mask - 1);
  let allOnes = value === mask - 1;
  for (let i = 1; i < length; i++) {
    const byte = b[pos + i];
    if (byte !== 0xff) allOnes = false;
    value = value * 256 + byte;
  }
  return { value, length, unknown: allOnes };
}

/** Tamaño como vint de 8 bytes (0x01 + 7 bytes), así no hay que calcular el largo mínimo. */
function sizeVint8(n: number): Uint8Array {
  const out = new Uint8Array(8);
  out[0] = 0x01;
  let v = n;
  for (let i = 7; i >= 1; i--) {
    out[i] = v % 256;
    v = Math.floor(v / 256);
  }
  return out;
}

function durationElement(value: number): Uint8Array {
  const out = new Uint8Array(11);
  out[0] = 0x44;
  out[1] = 0x89;
  out[2] = 0x88; // tamaño 8
  new DataView(out.buffer).setFloat64(3, value);
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/**
 * Devuelve los bytes con Duration = `durationMs` (en unidades de
 * TimecodeScale, que por defecto es 1 ms). Si no entiende la estructura,
 * devuelve los mismos bytes: el video se ve igual, solo sin duración.
 */
export function patchWebmDuration(bytes: Uint8Array, durationMs: number): Uint8Array {
  if (!(durationMs > 0)) return bytes;
  const ebml = readId(bytes, 0);
  if (!ebml || ebml.value !== ID_EBML) return bytes;
  const ebmlSize = readSize(bytes, ebml.length);
  if (!ebmlSize || ebmlSize.unknown) return bytes;
  let pos = ebml.length + ebmlSize.length + ebmlSize.value;
  const seg = readId(bytes, pos);
  if (!seg || seg.value !== ID_SEGMENT) return bytes;
  const segSize = readSize(bytes, pos + seg.length);
  if (!segSize) return bytes;
  pos += seg.length + segSize.length;
  // Hijos del Segment hasta encontrar Info (antes del primer Cluster).
  while (pos < bytes.length) {
    const id = readId(bytes, pos);
    if (!id) return bytes;
    const size = readSize(bytes, pos + id.length);
    if (!size) return bytes;
    const dataStart = pos + id.length + size.length;
    if (id.value === ID_CLUSTER) return bytes;
    if (id.value !== ID_INFO) {
      if (size.unknown) return bytes;
      pos = dataStart + size.value;
      continue;
    }
    if (size.unknown || dataStart + size.value > bytes.length) return bytes;
    const infoEnd = dataStart + size.value;
    let scale = 1_000_000;
    let p = dataStart;
    while (p < infoEnd) {
      const cid = readId(bytes, p);
      if (!cid) return bytes;
      const csize = readSize(bytes, p + cid.length);
      if (!csize || csize.unknown) return bytes;
      const cdata = p + cid.length + csize.length;
      if (cid.value === ID_TIMECODE_SCALE) {
        let v = 0;
        for (let i = 0; i < csize.value; i++) v = v * 256 + bytes[cdata + i];
        if (v > 0) scale = v;
      }
      if (cid.value === ID_DURATION) {
        // Ya hay Duration: se pisa en el lugar.
        const out = bytes.slice();
        const dv = new DataView(out.buffer, out.byteOffset, out.byteLength);
        const units = (durationMs * 1_000_000) / scale;
        if (csize.value === 8) dv.setFloat64(cdata, units);
        else if (csize.value === 4) dv.setFloat32(cdata, units);
        else return bytes;
        return out;
      }
      p = cdata + csize.value;
    }
    const units = (durationMs * 1_000_000) / scale;
    const children = concat([bytes.subarray(dataStart, infoEnd), durationElement(units)]);
    return concat([
      bytes.subarray(0, pos),
      bytes.subarray(pos, pos + id.length),
      sizeVint8(children.length),
      children,
      bytes.subarray(infoEnd),
    ]);
  }
  return bytes;
}

/** Duration (ms) que trae el header, o null. Para tests y diagnósticos. */
export function readWebmDuration(bytes: Uint8Array): number | null {
  const ebml = readId(bytes, 0);
  if (!ebml || ebml.value !== ID_EBML) return null;
  const ebmlSize = readSize(bytes, ebml.length);
  if (!ebmlSize) return null;
  let pos = ebml.length + ebmlSize.length + ebmlSize.value;
  const seg = readId(bytes, pos);
  const segSize = seg && readSize(bytes, pos + seg.length);
  if (!seg || !segSize) return null;
  pos += seg.length + segSize.length;
  while (pos < bytes.length) {
    const id = readId(bytes, pos);
    const size = id && readSize(bytes, pos + id.length);
    if (!id || !size || size.unknown) return null;
    const dataStart = pos + id.length + size.length;
    if (id.value === ID_INFO) {
      let p = dataStart;
      while (p < dataStart + size.value) {
        const cid = readId(bytes, p);
        const csize = cid && readSize(bytes, p + cid.length);
        if (!cid || !csize) return null;
        const cdata = p + cid.length + csize.length;
        if (cid.value === ID_DURATION) {
          const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
          return csize.value === 8 ? dv.getFloat64(cdata) : dv.getFloat32(cdata);
        }
        p = cdata + csize.value;
      }
      return null;
    }
    pos = dataStart + size.value;
  }
  return null;
}
