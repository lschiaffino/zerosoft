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

/** Bytes de un cluster sin el id, el tamaño ni el Timecode, con los bloques cuyo tiempo absoluto cae antes de `untilMs`. */
function clusterBody(b: Uint8Array, c: ClusterInfo, untilMs: number): { parts: Uint8Array[]; lastMs: number } {
  const id = readId(b, c.start)!;
  const size = readSize(b, c.start + id.length)!;
  let p = c.start + id.length + size.length;
  const parts: Uint8Array[] = [];
  let lastMs = c.timecode;
  while (p < c.end) {
    const cid = readId(b, p);
    const cs = cid && readSize(b, p + cid.length);
    if (!cid || !cs || cs.unknown) break;
    const data = p + cid.length + cs.length;
    const next = data + cs.value;
    if (cid.value === ID_SIMPLE_BLOCK || cid.value === ID_BLOCK_GROUP) {
      let blockPos = data;
      if (cid.value === ID_BLOCK_GROUP) {
        let q = data;
        blockPos = -1;
        while (q < next) {
          const qid = readId(b, q);
          const qs = qid && readSize(b, q + qid.length);
          if (!qid || !qs || qs.unknown) break;
          if (qid.value === ID_BLOCK) {
            blockPos = q + qid.length + qs.length;
            break;
          }
          q += qid.length + qs.length + qs.value;
        }
      }
      if (blockPos >= 0) {
        const tl = readSize(b, blockPos)!.length;
        const rel = ((b[blockPos + tl] << 24) >> 16) | b[blockPos + tl + 1];
        const abs = c.timecode + rel;
        if (abs < untilMs) {
          parts.push(b.subarray(p, next));
          lastMs = Math.max(lastMs, abs);
        }
      }
    } else if (cid.value !== ID_TIMECODE) {
      parts.push(b.subarray(p, next));
    }
    p = next;
  }
  return { parts, lastMs };
}

function timecodeElement(ms: number): Uint8Array {
  const out = new Uint8Array(10);
  out[0] = 0xe7;
  out[1] = 0x88;
  let v = Math.max(0, Math.round(ms));
  for (let i = 9; i >= 2; i--) {
    out[i] = v % 256;
    v = Math.floor(v / 256);
  }
  return out;
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
  return { bytes: indexWebm(out, dur), fromMs: clusters[first].timecode, startCut: first > 0 || startMs === 0 };
}

// ============================================================
// Componer sin recodificar: sacar partes y unir grabaciones
// ============================================================

interface ParsedWebm {
  header: Uint8Array;
  segmentHead: Uint8Array;
  info: Uint8Array;
  tracks: Uint8Array;
  signature: string;
  clusters: ClusterInfo[];
}

function parseTrackSignature(b: Uint8Array, start: number, end: number): string {
  const out: string[] = [];
  let p = start;
  while (p < end) {
    const id = readId(b, p);
    const size = id && readSize(b, p + id.length);
    if (!id || !size || size.unknown) break;
    const data = p + id.length + size.length;
    if (id.value === ID_TRACK_ENTRY) {
      let q = data;
      const fields: string[] = [];
      while (q < data + size.value) {
        const cid = readId(b, q);
        const cs = cid && readSize(b, q + cid.length);
        if (!cid || !cs || cs.unknown) break;
        const cd = q + cid.length + cs.length;
        if (cid.value === ID_TRACK_NUMBER) fields.push(`n${readUInt(b, cd, cs.value)}`);
        if (cid.value === ID_TRACK_TYPE) fields.push(`t${readUInt(b, cd, cs.value)}`);
        if (cid.value === 0x86) fields.push(new TextDecoder().decode(b.subarray(cd, cd + cs.value)));
        if (cid.value === 0xe0) {
          let r = cd;
          while (r < cd + cs.value) {
            const vid = readId(b, r);
            const vs = vid && readSize(b, r + vid.length);
            if (!vid || !vs || vs.unknown) break;
            const vd = r + vid.length + vs.length;
            if (vid.value === 0xb0 || vid.value === 0xba) fields.push(`${vid.value === 0xb0 ? 'w' : 'h'}${readUInt(b, vd, vs.value)}`);
            r = vd + vs.value;
          }
        }
        q = cd + cs.value;
      }
      out.push(fields.join(','));
    }
    p = data + size.value;
  }
  return out.join('|');
}

function parseWebm(bytes: Uint8Array): ParsedWebm | null {
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
  let signature = '';
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
      signature = parseTrackSignature(bytes, data, data + size.value);
    }
    pos = data + size.value;
  }
  if (!info || !tracks || !clusters.length) return null;
  return { header: bytes.subarray(0, headerEnd), segmentHead: bytes.subarray(headerEnd, headerEnd + seg.length), info: bytes.subarray(info[0], info[1]), tracks: bytes.subarray(tracks[0], tracks[1]), signature, clusters };
}

export interface WebmEditPiece {
  /** Índice de la fuente. */
  src: number;
  /** Lo que realmente se copió de la fuente, en ms. */
  fromMs: number;
  toMs: number;
  /** Desde qué ms arranca en la salida. */
  atMs: number;
}

export type WebmComposeResult =
  | { ok: true; bytes: Uint8Array; durationMs: number; pieces: WebmEditPiece[] }
  | { ok: false; error: 'unreadable' | 'incompatible' | 'nothing_left' };

/**
 * Arma un WebM nuevo con los tramos pedidos de una o más fuentes, sin
 * recodificar. Un tramo empieza en el primer cluster con keyframe en o después
 * de su inicio (lo que se sacó no vuelve a aparecer, a cambio de perder hasta un
 * intervalo de keyframes de lo que sigue) y sus bloques se cortan en el fin. Para
 * unir, las fuentes tienen que tener las mismas pistas, códec y tamaño.
 */
export function composeWebm(sources: Array<{ bytes: Uint8Array; keep: Array<[number, number]> }>): WebmComposeResult {
  const parsed: ParsedWebm[] = [];
  for (const s of sources) {
    const p = parseWebm(s.bytes);
    if (!p) return { ok: false, error: 'unreadable' };
    parsed.push(p);
  }
  if (!parsed.length) return { ok: false, error: 'unreadable' };
  if (parsed.some((p) => p.signature !== parsed[0].signature)) return { ok: false, error: 'incompatible' };
  const out: Uint8Array[] = [parsed[0].header, parsed[0].segmentHead, Uint8Array.from([0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]), parsed[0].info, parsed[0].tracks];
  const pieces: WebmEditPiece[] = [];
  let cursor = 0;
  sources.forEach((source, src) => {
    const p = parsed[src];
    for (const [from, to] of source.keep) {
      const first = p.clusters.findIndex((c) => c.keyStart && c.timecode >= from && c.timecode < to);
      if (first < 0) continue;
      const startMs = p.clusters[first].timecode;
      let lastMs = startMs;
      const at = cursor;
      for (let i = first; i < p.clusters.length && p.clusters[i].timecode < to; i++) {
        const c = p.clusters[i];
        const { parts, lastMs: last } = clusterBody(source.bytes, c, to);
        lastMs = Math.max(lastMs, last);
        const tc = timecodeElement(at + c.timecode - startMs);
        const len = tc.length + parts.reduce((n, x) => n + x.length, 0);
        out.push(Uint8Array.from([0x1f, 0x43, 0xb6, 0x75]), sizeVint8(len), tc, ...parts);
      }
      // Un cuadro más de margen: el siguiente tramo no pisa al último bloque de este.
      const end = Math.min(to, lastMs + 34);
      const length = Math.max(1, end - startMs);
      pieces.push({ src, fromMs: startMs, toMs: startMs + length, atMs: at });
      cursor = at + length;
    }
  });
  if (!pieces.length) return { ok: false, error: 'nothing_left' };
  return { ok: true, bytes: indexWebm(concat(out), cursor), durationMs: cursor, pieces };
}

// ============================================================
// Índice (Cues) sin recodificar
// ============================================================

/*
 * MediaRecorder no escribe Cues: para adelantar, el reproductor lee el archivo
 * de corrido hasta ese punto. Acá se recorre el archivo una vez (en streaming,
 * sin tenerlo entero en memoria), se anota dónde empieza cada cluster con
 * keyframe y se arma un header nuevo: SeekHead + Info (con Duration) + Tracks
 * + Cues, antes del primer cluster. Los clusters no se tocan (se copian tal
 * cual detrás del header nuevo). Chrome, Firefox y Safari leen las Cues del
 * principio al abrir el archivo y adelantan pidiendo un rango.
 */

const ID_SEEK_HEAD = 0x114d9b74;
const ID_CUES = 0x1c53bb6b;
const ID_VOID = 0xec;
/** Más que esto antes del primer cluster no es un WebM de MediaRecorder. */
const MAX_HEAD = 4 * 1024 * 1024;

export interface WebmClusterMark {
  /** Byte donde empieza el cluster (desde el principio del archivo). */
  offset: number;
  /** Timecode del cluster, en unidades de TimecodeScale. */
  timecode: number;
  /** Empieza con keyframe de video: se puede saltar acá. */
  key: boolean;
}

export interface WebmScan {
  /** Bytes antes del primer cluster (EBML, Segment y sus hijos: Info, Tracks...). */
  head: Uint8Array;
  clusters: WebmClusterMark[];
}

/**
 * Recorre un WebM que llega por pedazos, en orden. Guarda solo el header y una
 * marca por cluster: el contenido de los bloques se saltea sin copiarlo.
 */
export class WebmScanner {
  private pos = 0;
  private rest: Uint8Array = new Uint8Array(0);
  private skip = 0;
  private level: 'top' | 'segment' | 'cluster' = 'top';
  private headParts: Uint8Array[] = [];
  private headBytes = 0;
  private head: Uint8Array | null = null;
  private videoTrack: number | null = null;
  private cluster: { offset: number; timecode: number; key: boolean | null; end: number | null } | null = null;
  private clusters: WebmClusterMark[] = [];
  private failed = false;

  feed(chunk: Uint8Array): void {
    if (this.failed || !chunk.length) return;
    if (this.head === null && this.headBytes < MAX_HEAD) {
      // Solo lo que puede ser header: el resto de los bytes no se copia.
      const keep = chunk.slice(0, MAX_HEAD - this.headBytes);
      this.headParts.push(keep);
      this.headBytes += keep.length;
    }
    let b = chunk;
    if (this.skip) {
      if (this.skip >= b.length) {
        this.skip -= b.length;
        this.pos += b.length;
        return;
      }
      b = b.subarray(this.skip);
      this.pos += this.skip;
      this.skip = 0;
    }
    if (this.rest.length) b = concat([this.rest, b]);
    let o = 0;
    while (!this.failed && o < b.length) {
      const used = this.step(b, o);
      if (used === null) break;
      o += used;
      if (this.skip) {
        const left = b.length - o;
        if (this.skip >= left) {
          this.skip -= left;
          o = b.length;
          break;
        }
        o += this.skip;
        this.skip = 0;
      }
    }
    this.pos += o;
    this.rest = b.slice(o);
  }

  /** Lee un elemento en b[o]: devuelve los bytes consumidos (0 = cambió de nivel), o null si faltan bytes. */
  private step(b: Uint8Array, o: number): number | null {
    const abs = this.pos + o;
    // Cluster de tamaño conocido: terminó.
    if (this.level === 'cluster' && this.cluster?.end !== null && this.cluster && abs >= this.cluster.end) {
      this.closeCluster();
      return 0;
    }
    const avail = b.length - o;
    const id = readId(b, o);
    if (!id) {
      if (avail < 4) return null;
      this.fail();
      return null;
    }
    const size = readSize(b, o + id.length);
    if (!size) {
      if (avail < id.length + 8 && b[o + id.length] !== 0) return null;
      this.fail();
      return null;
    }
    const hdr = id.length + size.length;
    if (this.level === 'top') {
      if (id.value === ID_EBML && !size.unknown) {
        this.skip = size.value;
        return hdr;
      }
      if (id.value === ID_SEGMENT) {
        this.level = 'segment';
        return hdr;
      }
      this.fail();
      return null;
    }
    if (this.level === 'cluster') {
      // Cluster de tamaño desconocido (MediaRecorder): termina en el primer elemento que no es suyo.
      if (this.cluster?.end === null && !CLUSTER_CHILDREN.has(id.value)) {
        this.closeCluster();
        return 0;
      }
      if (size.unknown) {
        this.fail();
        return null;
      }
      if (id.value === ID_TIMECODE) {
        if (avail < hdr + size.value) return null;
        if (this.cluster) this.cluster.timecode = readUInt(b, o + hdr, size.value);
        return hdr + size.value;
      }
      if (id.value === ID_SIMPLE_BLOCK && this.cluster && this.cluster.key === null) {
        const need = hdr + Math.min(size.value, 11);
        if (avail < need) return null;
        const track = readSize(b, o + hdr);
        if (track && hdr + track.length + 2 < hdr + size.value && (this.videoTrack === null || track.value === this.videoTrack)) {
          this.cluster.key = (b[o + hdr + track.length + 2] & 0x80) !== 0;
        }
      }
      this.skip = size.value;
      return hdr;
    }
    // Hijos del Segment.
    if (id.value === ID_CLUSTER) {
      if (this.head === null && !this.takeHead(abs)) return null;
      this.cluster = { offset: abs, timecode: 0, key: null, end: size.unknown ? null : abs + hdr + size.value };
      this.level = 'cluster';
      return hdr;
    }
    if (size.unknown) {
      this.fail();
      return null;
    }
    this.skip = size.value;
    return hdr;
  }

  private takeHead(end: number): boolean {
    if (end > MAX_HEAD) {
      this.fail();
      return false;
    }
    this.head = concat(this.headParts).slice(0, end);
    this.headParts = [];
    const tracks = findChild(this.head, ID_TRACKS);
    this.videoTrack = tracks ? videoTrackNumber(this.head, tracks[1], tracks[2]) : null;
    return true;
  }

  private closeCluster() {
    const c = this.cluster;
    if (c) this.clusters.push({ offset: c.offset, timecode: c.timecode, key: c.key ?? this.videoTrack === null });
    this.cluster = null;
    this.level = 'segment';
  }

  private fail() {
    this.failed = true;
    this.headParts = [];
    this.rest = new Uint8Array(0);
  }

  /** Cierra la lectura. null si el archivo no se entendió o no tiene clusters. */
  finish(): WebmScan | null {
    if (this.level === 'cluster') this.closeCluster();
    if (this.failed || !this.head || !this.clusters.length) return null;
    return { head: this.head, clusters: this.clusters };
  }
}

/** Hijo del Segment antes del primer cluster: [inicio, inicio de los datos, fin]. */
function findChild(head: Uint8Array, want: number): [number, number, number] | null {
  for (const c of segmentChildren(head) ?? []) if (c.id === want) return [c.start, c.data, c.end];
  return null;
}

interface HeadChild {
  id: number;
  start: number;
  data: number;
  end: number;
}

/** Hijos del Segment en un header (los bytes antes del primer cluster), o null si no se entiende. */
function segmentChildren(head: Uint8Array): HeadChild[] | null {
  const ebml = readId(head, 0);
  if (!ebml || ebml.value !== ID_EBML) return null;
  const ebmlSize = readSize(head, ebml.length);
  if (!ebmlSize || ebmlSize.unknown) return null;
  const segAt = ebml.length + ebmlSize.length + ebmlSize.value;
  const seg = readId(head, segAt);
  const segSize = seg && readSize(head, segAt + seg.length);
  if (!seg || seg.value !== ID_SEGMENT || !segSize) return null;
  const out: HeadChild[] = [];
  let p = segAt + seg.length + segSize.length;
  while (p < head.length) {
    const id = readId(head, p);
    const size = id && readSize(head, p + id.length);
    if (!id || !size || size.unknown) return null;
    const data = p + id.length + size.length;
    if (data + size.value > head.length) return null;
    out.push({ id: id.value, start: p, data, end: data + size.value });
    p = data + size.value;
  }
  return out;
}

function uintElement(id: number[], value: number): number[] {
  const out = [...id, 0x88];
  const bytes: number[] = [];
  let v = Math.max(0, Math.floor(value));
  for (let i = 0; i < 8; i++) {
    bytes.unshift(v % 256);
    v = Math.floor(v / 256);
  }
  return [...out, ...bytes];
}

function idBytes(id: number): number[] {
  const out: number[] = [];
  let v = id;
  while (v > 0) {
    out.unshift(v % 256);
    v = Math.floor(v / 256);
  }
  return out;
}

/** Elemento con tamaño de 1 byte (contenido de menos de 127 bytes). */
function small(id: number[], body: number[]): number[] {
  return [...id, 0x80 | body.length, ...body];
}

/**
 * Header nuevo con índice: el EBML de siempre, Segment de tamaño desconocido,
 * SeekHead, Info (con `durationMs`), Tracks, lo demás que hubiera y Cues (un
 * punto por cluster con keyframe, como mucho uno cada `minGapMs`). Los
 * clusters van detrás sin cambios, desde `scan.clusters[0].offset`. null si
 * ya tiene índice o no se entiende: entonces se deja el archivo como está.
 */
export function webmHeadWithCues(scan: WebmScan, durationMs: number, minGapMs = 1000): Uint8Array | null {
  const { head, clusters } = scan;
  const children = segmentChildren(head);
  if (!children || !clusters.length || clusters[0].offset !== head.length) return null;
  // Ya indexado (Cues al principio, o un SeekHead que apunta a unas Cues del final): no se toca.
  if (children.some((c) => c.id === ID_CUES || (c.id === ID_SEEK_HEAD && seekHeadHasCues(head, c)))) return null;
  const info = children.find((c) => c.id === ID_INFO);
  const tracks = children.find((c) => c.id === ID_TRACKS);
  if (!info || !tracks) return null;
  const ebml = readId(head, 0)!;
  const ebmlSize = readSize(head, ebml.length)!;
  const ebmlEnd = ebml.length + ebmlSize.length + ebmlSize.value;
  const segHead = concat([head.subarray(0, ebmlEnd), head.subarray(ebmlEnd, ebmlEnd + 4), Uint8Array.from([0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff])]);
  // Info con la duración: se reusa patchWebmDuration sobre un documento mínimo.
  const bareInfo = head.subarray(info.start, info.end);
  const mini = concat([segHead, bareInfo]);
  const infoBytes = (durationMs > 0 ? patchWebmDuration(mini, durationMs) : mini).subarray(segHead.length);
  let scale = 1_000_000;
  for (let p = info.data; p < info.end; ) {
    const cid = readId(head, p);
    const cs = cid && readSize(head, p + cid.length);
    if (!cid || !cs || cs.unknown) break;
    const cd = p + cid.length + cs.length;
    if (cid.value === ID_TIMECODE_SCALE) scale = readUInt(head, cd, cs.value) || scale;
    p = cd + cs.value;
  }
  // El SeekHead viejo (sin Cues) se reemplaza por el nuevo; el relleno (Void) se descarta.
  const others = children.filter((c) => c.id !== ID_INFO && c.id !== ID_TRACKS && c.id !== ID_VOID && c.id !== ID_SEEK_HEAD).map((c) => head.subarray(c.start, c.end));
  const tracksBytes = head.subarray(tracks.start, tracks.end);
  const vt = videoTrackNumber(head, tracks.data, tracks.end) ?? firstTrackNumber(head, tracks.data, tracks.end);
  if (vt === null) return null;
  // Puntos: clusters con keyframe, separados al menos minGapMs (en unidades de TimecodeScale).
  const gap = (minGapMs * 1_000_000) / scale;
  const points: WebmClusterMark[] = [];
  for (const c of clusters) {
    if (!c.key) continue;
    if (points.length && c.timecode - points[points.length - 1].timecode < gap) continue;
    points.push(c);
  }
  if (!points.length) return null;
  // Tamaños fijos (enteros de 8 bytes): las posiciones no dependen del tamaño de las Cues.
  const CUE_POINT = 34;
  const cuesLen = 4 + 8 + points.length * CUE_POINT;
  const SEEK_HEAD = 68;
  const posInfo = SEEK_HEAD;
  const posTracks = posInfo + infoBytes.length;
  const posCues = posTracks + tracksBytes.length + others.reduce((n, x) => n + x.length, 0);
  const firstCluster = posCues + cuesLen;
  const seek = (id: number, pos: number) => small([0x4d, 0xbb], [...small([0x53, 0xab], idBytes(id)), ...uintElement([0x53, 0xac], pos)]);
  const seekHead = small(idBytes(ID_SEEK_HEAD), [...seek(ID_INFO, posInfo), ...seek(ID_TRACKS, posTracks), ...seek(ID_CUES, posCues)]);
  if (seekHead.length !== SEEK_HEAD) return null;
  const cues: number[] = [...idBytes(ID_CUES), ...Array.from(sizeVint8(points.length * CUE_POINT))];
  for (const c of points) {
    const pos = firstCluster + (c.offset - head.length);
    const point = small([0xbb], [...uintElement([0xb3], c.timecode), ...small([0xb7], [...uintElement([0xf7], vt), ...uintElement([0xf1], pos)])]);
    if (point.length !== CUE_POINT) return null;
    cues.push(...point);
  }
  return concat([segHead, Uint8Array.from(seekHead), infoBytes, tracksBytes, ...others, Uint8Array.from(cues)]);
}

/** El SeekHead tiene una entrada para Cues (unas Cues al final, como las escribe ffmpeg). */
function seekHeadHasCues(head: Uint8Array, seekHead: HeadChild): boolean {
  for (let p = seekHead.data; p < seekHead.end; ) {
    const id = readId(head, p);
    const s = id && readSize(head, p + id.length);
    if (!id || !s || s.unknown) return false;
    const d = p + id.length + s.length;
    if (id.value === 0x4dbb) {
      for (let q = d; q < d + s.value; ) {
        const cid = readId(head, q);
        const cs = cid && readSize(head, q + cid.length);
        if (!cid || !cs || cs.unknown) break;
        const cd = q + cid.length + cs.length;
        if (cid.value === 0x53ab && readUInt(head, cd, cs.value) === ID_CUES) return true;
        q = cd + cs.value;
      }
    }
    p = d + s.value;
  }
  return false;
}

function firstTrackNumber(b: Uint8Array, start: number, end: number): number | null {
  let p = start;
  while (p < end) {
    const id = readId(b, p);
    const size = id && readSize(b, p + id.length);
    if (!id || !size || size.unknown) return null;
    const data = p + id.length + size.length;
    if (id.value === ID_TRACK_ENTRY) {
      for (let q = data; q < data + size.value; ) {
        const cid = readId(b, q);
        const cs = cid && readSize(b, q + cid.length);
        if (!cid || !cs || cs.unknown) break;
        const cd = q + cid.length + cs.length;
        if (cid.value === ID_TRACK_NUMBER) return readUInt(b, cd, cs.value);
        q = cd + cs.value;
      }
    }
    p = data + size.value;
  }
  return null;
}

/**
 * Archivo entero en memoria: el mismo WebM con Duration e índice al principio.
 * Si no se puede indexar, al menos con la duración (como antes).
 */
export function indexWebm(bytes: Uint8Array, durationMs: number): Uint8Array {
  const scanner = new WebmScanner();
  scanner.feed(bytes);
  const scan = scanner.finish();
  const head = scan ? webmHeadWithCues(scan, durationMs) : null;
  if (!scan || !head) return patchWebmDuration(bytes, durationMs);
  return concat([head, bytes.subarray(scan.head.length)]);
}

/** Cues del header (para tests y diagnósticos): tiempo y posición de cada punto, o null si no hay. */
export function readWebmCues(bytes: Uint8Array): Array<{ time: number; pos: number }> | null {
  const children = segmentChildrenUntilCluster(bytes);
  const cues = children?.find((c) => c.id === ID_CUES);
  if (!cues) return null;
  const out: Array<{ time: number; pos: number }> = [];
  const walk = (start: number, end: number, cb: (id: number, data: number, size: number) => void) => {
    for (let p = start; p < end; ) {
      const id = readId(bytes, p);
      const s = id && readSize(bytes, p + id.length);
      if (!id || !s || s.unknown) return;
      const d = p + id.length + s.length;
      cb(id.value, d, s.value);
      p = d + s.value;
    }
  };
  walk(cues.data, cues.end, (id, d, s) => {
    if (id !== 0xbb) return;
    let time = 0;
    let pos = -1;
    walk(d, d + s, (cid, cd, cs) => {
      if (cid === 0xb3) time = readUInt(bytes, cd, cs);
      if (cid === 0xb7) walk(cd, cd + cs, (tid, td, ts) => {
        if (tid === 0xf1) pos = readUInt(bytes, td, ts);
      });
    });
    out.push({ time, pos });
  });
  return out;
}

/** Hijos del Segment hasta el primer cluster, sobre el archivo entero. */
function segmentChildrenUntilCluster(bytes: Uint8Array): HeadChild[] | null {
  const ebml = readId(bytes, 0);
  const ebmlSize = ebml && readSize(bytes, ebml.length);
  if (!ebml || ebml.value !== ID_EBML || !ebmlSize || ebmlSize.unknown) return null;
  const segAt = ebml.length + ebmlSize.length + ebmlSize.value;
  const seg = readId(bytes, segAt);
  const segSize = seg && readSize(bytes, segAt + seg.length);
  if (!seg || seg.value !== ID_SEGMENT || !segSize) return null;
  let p = segAt + seg.length + segSize.length;
  const out: HeadChild[] = [];
  while (p < bytes.length) {
    const id = readId(bytes, p);
    const size = id && readSize(bytes, p + id.length);
    if (!id || !size || size.unknown || id.value === ID_CLUSTER) break;
    const data = p + id.length + size.length;
    out.push({ id: id.value, start: p, data, end: data + size.value });
    p = data + size.value;
  }
  return out;
}

/** Offset donde empiezan los datos del Segment (las posiciones de SeekHead y Cues cuentan desde acá). */
export function webmSegmentDataStart(bytes: Uint8Array): number | null {
  const ebml = readId(bytes, 0);
  const ebmlSize = ebml && readSize(bytes, ebml.length);
  if (!ebml || !ebmlSize || ebmlSize.unknown) return null;
  const segAt = ebml.length + ebmlSize.length + ebmlSize.value;
  const seg = readId(bytes, segAt);
  const segSize = seg && readSize(bytes, segAt + seg.length);
  return seg && segSize ? segAt + seg.length + segSize.length : null;
}
