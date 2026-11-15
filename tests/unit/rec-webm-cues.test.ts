import { describe, expect, it } from 'vitest';
import { composeWebm, cutWebm, indexWebm, patchWebmDuration, readWebmCues, readWebmDuration, WebmScanner, webmHeadWithCues, webmSegmentDataStart } from '@/lib/rec-webm';

/*
 * Índice (Cues) en un WebM de MediaRecorder sin recodificar: lib/rec-webm.ts.
 * Los WebM de prueba se arman acá byte a byte, como los escribe Chrome:
 * Segment y Clusters de tamaño desconocido, Info sin Duration, pista 1 de
 * video y pista 2 de audio.
 */

const UNKNOWN = [0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];

function size(n: number): number[] {
  if (n < 127) return [0x80 | n];
  const out = [0x01];
  for (let i = 6; i >= 0; i--) out.push(Math.floor(n / 256 ** i) % 256);
  return out;
}

const el = (id: number[], body: number[]) => [...id, ...size(body.length), ...body];

function uint(n: number): number[] {
  const out: number[] = [];
  let v = n;
  do {
    out.unshift(v % 256);
    v = Math.floor(v / 256);
  } while (v > 0);
  return out;
}

interface FakeCluster {
  tc: number;
  /** El bloque de video empieza con keyframe. */
  key: boolean;
  /** Un bloque de audio (marcado como keyframe) antes del de video. */
  audioFirst?: boolean;
  /** Byte que identifica el cluster en el contenido. */
  mark: number;
}

const block = (track: number, key: boolean, mark: number) => el([0xa3], [0x80 | track, 0x00, 0x00, key ? 0x80 : 0x00, mark, mark, mark]);

function fakeWebm(clusters: FakeCluster[], opts: { knownSize?: boolean; seekHeadCues?: boolean } = {}): Uint8Array {
  // Como ffmpeg: un SeekHead que apunta a unas Cues al final.
  const seekHead = opts.seekHeadCues ? el([0x11, 0x4d, 0x9b, 0x74], el([0x4d, 0xbb], [...el([0x53, 0xab], [0x1c, 0x53, 0xbb, 0x6b]), ...el([0x53, 0xac], [0x10, 0x00])])) : [];
  const ebml = el([0x1a, 0x45, 0xdf, 0xa3], [...el([0x42, 0x86], [0x01]), ...el([0x42, 0x82], Array.from('webm', (c) => c.charCodeAt(0)))]);
  const info = el([0x15, 0x49, 0xa9, 0x66], [...el([0x2a, 0xd7, 0xb1], uint(1_000_000)), ...el([0x4d, 0x80], Array.from('Chrome', (c) => c.charCodeAt(0)))]);
  const video = el([0xae], [...el([0xd7], [1]), ...el([0x83], [1]), ...el([0x86], Array.from('V_VP8', (c) => c.charCodeAt(0)))]);
  const audio = el([0xae], [...el([0xd7], [2]), ...el([0x83], [2]), ...el([0x86], Array.from('A_OPUS', (c) => c.charCodeAt(0)))]);
  const tracks = el([0x16, 0x54, 0xae, 0x6b], [...video, ...audio]);
  const body: number[] = [];
  for (const c of clusters) {
    const inner = [...el([0xe7], uint(c.tc)), ...(c.audioFirst ? block(2, true, c.mark) : []), ...block(1, c.key, c.mark), ...block(2, false, c.mark)];
    body.push(0x1f, 0x43, 0xb6, 0x75, ...(opts.knownSize ? size(inner.length) : UNKNOWN), ...inner);
  }
  return Uint8Array.from([...ebml, 0x18, 0x53, 0x80, 0x67, ...UNKNOWN, ...seekHead, ...info, ...tracks, ...body]);
}

/** Dónde empieza el primer cluster (los bytes que el índice no toca). */
function firstCluster(b: Uint8Array): number {
  for (let i = 0; i + 3 < b.length; i++) if (b[i] === 0x1f && b[i + 1] === 0x43 && b[i + 2] === 0xb6 && b[i + 3] === 0x75) return i;
  return -1;
}

/** Cada Cue apunta a un cluster: devuelve el byte marca de cada uno. */
function cueMarks(b: Uint8Array): number[] {
  const cues = readWebmCues(b)!;
  const base = webmSegmentDataStart(b)!;
  return cues.map((c) => {
    const at = base + c.pos;
    expect(Array.from(b.subarray(at, at + 4))).toEqual([0x1f, 0x43, 0xb6, 0x75]);
    // El primer SimpleBlock del cluster lleva la marca en su contenido.
    const blockAt = b.indexOf(0xa3, at + 4);
    return b[blockAt + 6];
  });
}

const SAMPLE: FakeCluster[] = [
  { tc: 0, key: true, mark: 0x10 },
  { tc: 500, key: true, mark: 0x11 },
  { tc: 1000, key: false, mark: 0x12 },
  { tc: 1500, key: true, mark: 0x13 },
  { tc: 2600, key: true, mark: 0x14 },
  { tc: 3000, key: true, mark: 0x15 },
  // Audio con keyframe primero y el video sin keyframe: no se puede saltar acá.
  { tc: 4000, key: false, audioFirst: true, mark: 0x16 },
  { tc: 5000, key: true, audioFirst: true, mark: 0x17 },
];

describe('índice (Cues) en un WebM sin recodificar', () => {
  it('pone Duration y un punto por cluster con keyframe de video, como mucho uno por segundo', () => {
    const src = fakeWebm(SAMPLE);
    expect(readWebmCues(src)).toBeNull();
    const out = indexWebm(src, 5400);
    expect(readWebmDuration(out)).toBeCloseTo(5400, 3);
    expect(readWebmCues(out)!.map((c) => c.time)).toEqual([0, 1500, 2600, 5000]);
    expect(cueMarks(out)).toEqual([0x10, 0x13, 0x14, 0x17]);
    // Los clusters se copian tal cual detrás del header nuevo.
    expect(Array.from(out.subarray(firstCluster(out)))).toEqual(Array.from(src.subarray(firstCluster(src))));
  });

  it('leído por pedazos (como las partes de la subida) da el mismo header que el archivo entero', () => {
    const src = fakeWebm(SAMPLE);
    const whole = indexWebm(src, 5400);
    for (const step of [1, 2, 3, 7, 50, 1000]) {
      const s = new WebmScanner();
      for (let at = 0; at < src.length; at += step) s.feed(src.subarray(at, at + step));
      const scan = s.finish()!;
      expect(scan.clusters.map((c) => [c.timecode, c.key])).toEqual(SAMPLE.map((c) => [c.tc, c.key]));
      expect(scan.head.length).toBe(firstCluster(src));
      const head = webmHeadWithCues(scan, 5400)!;
      expect(Array.from(head)).toEqual(Array.from(whole.subarray(0, head.length)));
    }
  });

  it('clusters de tamaño conocido también', () => {
    const src = fakeWebm(SAMPLE, { knownSize: true });
    const out = indexWebm(src, 5400);
    expect(cueMarks(out)).toEqual([0x10, 0x13, 0x14, 0x17]);
  });

  it('un archivo ya indexado no se vuelve a indexar: solo se corrige la duración', () => {
    const once = indexWebm(fakeWebm(SAMPLE), 5400);
    const twice = indexWebm(once, 6000);
    expect(twice.length).toBe(once.length);
    expect(readWebmDuration(twice)).toBeCloseTo(6000, 3);
    expect(readWebmCues(twice)).toEqual(readWebmCues(once));
    // Con Cues al final (SeekHead que las nombra): tampoco se toca, solo la duración.
    const ffmpegLike = fakeWebm(SAMPLE, { seekHeadCues: true });
    expect(Array.from(indexWebm(ffmpegLike, 5400))).toEqual(Array.from(patchWebmDuration(ffmpegLike, 5400)));
  });

  it('lo que no entiende queda como antes (solo la duración, o igual)', () => {
    const junk = Uint8Array.from([1, 2, 3, 4, 5, 6]);
    expect(indexWebm(junk, 1000)).toBe(junk);
    // Sin clusters: solo Duration.
    const empty = fakeWebm([]);
    const out = indexWebm(empty, 1000);
    expect(readWebmCues(out)).toBeNull();
    expect(Array.from(out)).toEqual(Array.from(patchWebmDuration(empty, 1000)));
    // Un pedazo roto en el medio: el lector se rinde y no inventa un índice.
    const broken = fakeWebm(SAMPLE);
    broken.fill(0, firstCluster(broken) + 40, firstCluster(broken) + 48);
    const s = new WebmScanner();
    s.feed(broken);
    expect(s.finish()).toBeNull();
  });

  it('el recorte y la edición sin recodificar salen indexados', () => {
    const src = fakeWebm(SAMPLE);
    const cut = cutWebm(src, 1600, null, 5400)!;
    expect(cut.fromMs).toBe(1500);
    expect(cueMarks(cut.bytes)).toEqual([0x13, 0x14, 0x17]);
    const composed = composeWebm([{ bytes: src, keep: [[0, 1200], [2600, 5400]] }]);
    expect(composed.ok).toBe(true);
    if (!composed.ok) return;
    // 0 y 500 del primer tramo; 2600, 3000 y 5000 del segundo, corridos.
    const cues = readWebmCues(composed.bytes)!;
    expect(cues.length).toBeGreaterThanOrEqual(2);
    expect(cueMarks(composed.bytes)[0]).toBe(0x10);
    expect(cueMarks(composed.bytes)).toContain(0x14);
  });
});
