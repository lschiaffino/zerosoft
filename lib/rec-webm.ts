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

// ============================================================
// Recorte sin recodificar: header + los clusters del rango
// ============================================================

const ID_TRACKS = 0x1654ae6b;
const ID_TRACK_ENTRY = 0xae;
const ID_TRACK_NUMBER = 0xd7;
const ID_TRACK_TYPE = 0x83;
const ID_TIMECODE = 0xe7;
const ID_SIMPLE_BLOCK = 0xa3;
const ID_BLOCK_GROUP = 0xa0;
const ID_BLOCK = 0xa1;
const ID_REFERENCE_BLOCK = 0xfb;
const CLUSTER_CHILDREN = new Set([ID_TIMECODE, ID_SIMPLE_BLOCK, ID_BLOCK_GROUP, 0xa7, 0xab, 0xec]);

interface ClusterInfo {
  start: number;
  end: number;
  timecode: number;
  /** El primer bloque de video del cluster es keyframe (se puede empezar a decodificar acá). */
  keyStart: boolean;
}

function readUInt(b: Uint8Array, pos: number, len: number): number {
  let v = 0;
  for (let i = 0; i < len; i++) v = v * 256 + b[pos + i];
  return v;
}

/** Número de pista de un Block/SimpleBlock (vint con la marca sacada). */
function blockTrack(b: Uint8Array, pos: number): number | null {
  const s = readSize(b, pos);
  return s ? s.value : null;
}

function videoTrackNumber(b: Uint8Array, start: number, end: number): number | null {
  let p = start;
  while (p < end) {
    const id = readId(b, p);
    const size = id && readSize(b, p + id.length);
    if (!id || !size || size.unknown) return null;
    const data = p + id.length + size.length;
    if (id.value === ID_TRACK_ENTRY) {
      let q = data;
      let num: number | null = null;
      let type: number | null = null;
      while (q < data + size.value) {
        const cid = readId(b, q);
        const cs = cid && readSize(b, q + cid.length);
        if (!cid || !cs || cs.unknown) break;
        const cd = q + cid.length + cs.length;
        if (cid.value === ID_TRACK_NUMBER) num = readUInt(b, cd, cs.value);
        if (cid.value === ID_TRACK_TYPE) type = readUInt(b, cd, cs.value);
        q = cd + cs.value;
      }
      if (type === 1 && num !== null) return num;
    }
    p = data + size.value;
  }
  return null;
}

/** Recorre un cluster (también de tamaño desconocido, como los de MediaRecorder) y devuelve dónde termina. */
function scanCluster(b: Uint8Array, start: number, dataStart: number, size: Vint, videoTrack: number | null): ClusterInfo | null {
  const limit = size.unknown ? b.length : Math.min(b.length, dataStart + size.value);
  let p = dataStart;
  let timecode = 0;
  let keyStart: boolean | null = null;
  while (p < limit) {
    const id = readId(b, p);
    const s = id && readSize(b, p + id.length);
    if (!id || !s) break;
    if (size.unknown && !CLUSTER_CHILDREN.has(id.value)) break;
    if (s.unknown) return null;
    const data = p + id.length + s.length;
    if (data + s.value > b.length) break;
    if (id.value === ID_TIMECODE) timecode = readUInt(b, data, s.value);
    if (keyStart === null && id.value === ID_SIMPLE_BLOCK) {
      const tr = blockTrack(b, data);
      if (videoTrack === null || tr === videoTrack) {
        const tl = readSize(b, data)!.length;
        keyStart = (b[data + tl + 2] & 0x80) !== 0;
      }
    }
    if (keyStart === null && id.value === ID_BLOCK_GROUP) {
      let q = data;
      let isVideo = false;
      let ref = false;
      while (q < data + s.value) {
        const cid = readId(b, q);
        const cs = cid && readSize(b, q + cid.length);
        if (!cid || !cs || cs.unknown) break;
        const cd = q + cid.length + cs.length;
        if (cid.value === ID_BLOCK) isVideo = videoTrack === null || blockTrack(b, cd) === videoTrack;
        if (cid.value === ID_REFERENCE_BLOCK) ref = true;
        q = cd + cs.value;
      }
      if (isVideo) keyStart = !ref;
    }
    p = data + s.value;
  }
  return { start, end: size.unknown ? p : limit, timecode, keyStart: keyStart ?? videoTrack === null };
}

export interface WebmCut {
  bytes: Uint8Array;
  /** Desde qué milisegundo hay imagen (keyframe en o antes del inicio pedido). */
  fromMs: number;
  /** El inicio quedó cortado (false = no había keyframe antes del inicio y se mantuvo desde 0). */
  startCut: boolean;
}

/**
 * Copia del WebM solo con los clusters del rango [startMs, endMs): el header
 * (EBML, Info con la duración nueva y Tracks) y desde el último cluster que
 * empieza con keyframe en o antes del inicio hasta el último que empieza
 * antes del fin. Sin recodificar. null si no se entiende la estructura.
 */
export function cutWebm(bytes: Uint8Array, startMs: number, endMs: number | null, durationMs: number): WebmCut | null {
  const ebml = readId(bytes, 0);
  if (!ebml || ebml.value !== ID_EBML) return null;
  const ebmlSize = readSize(bytes, ebml.length);
  if (!ebmlSize || ebmlSize.unknown) return null;
  const headerEnd = ebml.length + ebmlSize.length + ebmlSize.value;
  const seg = readId(bytes, headerEnd);
  if (!seg || seg.value !== ID_SEGMENT) return null;
  const segSize = readSize(bytes, headerEnd + seg.length);
  if (!segSize) return null;
  let pos = headerEnd + seg.length + segSize.length;
  let info: [number, number] | null = null;
  let tracks: [number, number] | null = null;
  let videoTrack: number | null = null;
  const clusters: ClusterInfo[] = [];
  while (pos < bytes.length) {
    const id = readId(bytes, pos);
    const size = id && readSize(bytes, pos + id.length);
    if (!id || !size) break;
    const data = pos + id.length + size.length;
    if (id.value === ID_CLUSTER) {
      const c = scanCluster(bytes, pos, data, size, videoTrack);
      if (!c || c.end <= pos) break;
      clusters.push(c);
      pos = c.end;
      continue;
    }
    if (size.unknown) return null;
    if (id.value === ID_INFO) info = [pos, data + size.value];
    if (id.value === ID_TRACKS) {
      tracks = [pos, data + size.value];
      videoTrack = videoTrackNumber(bytes, data, data + size.value);
    }
    pos = data + size.value;
  }
  if (!info || !tracks || clusters.length === 0) return null;
  const end = endMs ?? Infinity;
  let first = 0;
  for (let i = 0; i < clusters.length; i++) {
    if (clusters[i].timecode > startMs) break;
    if (clusters[i].keyStart) first = i;
  }
  const chosen = clusters.slice(first).filter((c, i) => i === 0 || c.timecode < end);
  const parts: Uint8Array[] = [
    bytes.subarray(0, headerEnd),
    bytes.subarray(headerEnd, headerEnd + seg.length),
    Uint8Array.from([0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]),
    bytes.subarray(info[0], info[1]),
    bytes.subarray(tracks[0], tracks[1]),
    ...chosen.map((c) => bytes.subarray(c.start, c.end)),
  ];
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  const dur = Number.isFinite(end) ? Math.min(end, durationMs || end) : durationMs;
  return { bytes: patchWebmDuration(out, dur), fromMs: clusters[first].timecode, startCut: first > 0 || startMs === 0 };
}
