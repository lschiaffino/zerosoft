import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import { getDb, upsertUser } from '@/lib/db';
import { cutWebm, patchWebmDuration, readWebmDuration } from '@/lib/rec-webm';
import { encodeGif, fixedPalette, lzwEncode, paletteIndex } from '@/lib/rec-gif';
import {
  chapterAt,
  chaptersToText,
  clampTrim,
  cleanCtaUrl,
  cleanSegments,
  csvCell,
  fmtClock,
  parseChapters,
  parseClock,
  segmentsToVtt,
  trimmedDuration,
  viewStats,
  chaptersInTrim,
  coveredPct,
  mergeRanges,
  retentionCurve,
  segmentsInTrim,
  nameKey,
} from '@/lib/rec-schema';
import {
  addComment,
  createFolder,
  createVideo,
  deleteComment,
  deleteFolder,
  finalizeVideo,
  getAnalytics,
  getPublicVideoRow,
  getVideoRow,
  listComments,
  listVideos,
  publicAccess,
  setTrimmedFile,
  toDto,
  toPublicDto,
  videoFileFor,
  assetVisible,
  RecError,
  searchRec,
  setVideoFile,
  trackRecView,
  unlockToken,
  updateVideo,
  verifyPassword,
  type RecActor,
} from '@/lib/rec';
import { assembleLocal, isOwnRecUrl, saveLocalPart } from '@/lib/rec-upload';
import { fakeSegments, processRecVideo, summaryPrompt } from '@/lib/rec-ai';

// ---------- WebM ----------

/** WebM mínimo como lo escribe MediaRecorder: EBML, Segment de tamaño desconocido, Info sin Duration y un Cluster. */
function liveWebm(): Uint8Array {
  const ebml = [0x1a, 0x45, 0xdf, 0xa3, 0x84, 0x42, 0x86, 0x81, 0x01];
  const segment = [0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];
  // Info: TimecodeScale 1000000 (0x0F4240) y MuxingApp "Chrome".
  const infoBody = [0x2a, 0xd7, 0xb1, 0x83, 0x0f, 0x42, 0x40, 0x4d, 0x80, 0x86, ...Array.from('Chrome').map((c) => c.charCodeAt(0))];
  const info = [0x15, 0x49, 0xa9, 0x66, 0x80 | infoBody.length, ...infoBody];
  const cluster = [0x1f, 0x43, 0xb6, 0x75, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xe7, 0x81, 0x00];
  return Uint8Array.from([...ebml, ...segment, ...info, ...cluster]);
}

describe('duración en el header WebM', () => {
  it('agrega Duration a la Info de un WebM en vivo y deja el resto igual', () => {
    const src = liveWebm();
    expect(readWebmDuration(src)).toBeNull();
    const out = patchWebmDuration(src, 12_345);
    expect(readWebmDuration(out)).toBeCloseTo(12_345, 3);
    // El Cluster sigue al final, intacto.
    expect(Array.from(out.slice(-15))).toEqual(Array.from(src.slice(-15)));
  });

  it('pisa una Duration existente y no toca bytes que no entiende', () => {
    const once = patchWebmDuration(liveWebm(), 1000);
    const twice = patchWebmDuration(once, 2500);
    expect(twice.length).toBe(once.length);
    expect(readWebmDuration(twice)).toBeCloseTo(2500, 3);
    const junk = Uint8Array.from([1, 2, 3, 4]);
    expect(patchWebmDuration(junk, 1000)).toBe(junk);
    expect(patchWebmDuration(liveWebm(), 0)).toEqual(liveWebm());
  });
});

/** WebM con pista de video y clusters de tamaño desconocido en 0, 2000 (sin keyframe) y 4000 ms. */
function clusteredWebm(): Uint8Array {
  const ebml = [0x1a, 0x45, 0xdf, 0xa3, 0x84, 0x42, 0x86, 0x81, 0x01];
  const segment = [0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];
  const infoBody = [0x2a, 0xd7, 0xb1, 0x83, 0x0f, 0x42, 0x40];
  const info = [0x15, 0x49, 0xa9, 0x66, 0x80 | infoBody.length, ...infoBody];
  const entry = [0xd7, 0x81, 0x01, 0x83, 0x81, 0x01];
  const trackEntry = [0xae, 0x80 | entry.length, ...entry];
  const tracks = [0x16, 0x54, 0xae, 0x6b, 0x80 | trackEntry.length, ...trackEntry];
  const cluster = (tc: number[], key: boolean, payload: number) => [
    0x1f, 0x43, 0xb6, 0x75, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xe7, 0x80 | tc.length, ...tc,
    0xa3, 0x85, 0x81, 0x00, 0x00, key ? 0x80 : 0x00, payload,
  ];
  return Uint8Array.from([...ebml, ...segment, ...info, ...tracks, ...cluster([0x00], true, 0x71), ...cluster([0x07, 0xd0], false, 0x72), ...cluster([0x0f, 0xa0], true, 0x73)]);
}

describe('recorte WebM sin recodificar', () => {
  it('se queda con el header y los clusters del rango, desde el keyframe anterior al inicio', () => {
    const src = clusteredWebm();
    const has = (b: Uint8Array, x: number) => Array.from(b).includes(x);
    // Inicio 4500: el cluster de 4000 tiene keyframe; fin abierto.
    const a = cutWebm(src, 4500, null, 6000)!;
    expect(a.fromMs).toBe(4000);
    expect(a.startCut).toBe(true);
    expect([has(a.bytes, 0x71), has(a.bytes, 0x72), has(a.bytes, 0x73)]).toEqual([false, false, true]);
    expect(readWebmDuration(a.bytes)).toBeCloseTo(6000, 3);
    // Inicio 2500: el cluster de 2000 no empieza con keyframe, se arranca en 0; fin 3000 deja afuera el de 4000.
    const b = cutWebm(src, 2500, 3000, 6000)!;
    expect(b.fromMs).toBe(0);
    expect([has(b.bytes, 0x71), has(b.bytes, 0x72), has(b.bytes, 0x73)]).toEqual([true, true, false]);
    expect(readWebmDuration(b.bytes)).toBeCloseTo(3000, 3);
    expect(cutWebm(Uint8Array.from([1, 2, 3]), 0, null, 1)).toBeNull();
  });
});

describe('tiempo visto y recorte para los demás', () => {
  it('unión de intervalos, % visto, retención, transcripción y capítulos dentro del recorte', () => {
    expect(mergeRanges([[5, 10], [0, 6], [20, 30], [29.8, 40]])).toEqual([[0, 10], [20, 40]]);
    expect(coveredPct([[0, 10], [90, 100]], 100)).toBe(20);
    expect(coveredPct([[0, 50], [0, 50]], 100)).toBe(50);
    expect(retentionCurve([[[0, 100]], [[0, 50]]], 100, 4)).toEqual([100, 100, 50, 50]);
    // Los que cruzan un borde (b empieza antes del inicio, d termina después del fin) quedan afuera.
    expect(
      segmentsInTrim([{ start: 0, end: 4, text: 'a' }, { start: 4, end: 8, text: 'b' }, { start: 6, end: 9, text: 'c' }, { start: 9, end: 12, text: 'd' }], 5, 10).map((x) => x.text),
    ).toEqual(['c']);
    expect(chaptersInTrim([{ start: 0, title: 'A' }, { start: 30, title: 'B' }, { start: 70, title: 'C' }], 40, 60)).toEqual([{ start: 40, title: 'B' }]);
  });
});

describe('miniatura y nombres con recorte', () => {
  it('la miniatura o el GIF de antes del recorte no se muestran; un cuadro de adentro sí', () => {
    const base = { trim_start: 10, trim_end: 60, thumb_at: 1, thumb_for: '0:', gif_for: '0:' };
    expect(assetVisible({ ...base, trim_start: 0, trim_end: null }, 'thumb')).toBe(true);
    expect(assetVisible(base, 'thumb')).toBe(false);
    expect(assetVisible(base, 'gif')).toBe(false);
    expect(assetVisible({ ...base, thumb_at: 20 }, 'thumb')).toBe(true);
    expect(assetVisible({ ...base, thumb_at: null, thumb_for: '10:60', gif_for: '10:60' }, 'thumb')).toBe(true);
    expect(assetVisible({ ...base, gif_for: '10:60' }, 'gif')).toBe(true);
  });

  it('nameKey iguala variantes (NFKC, invisibles, puntuación, cirílicas)', () => {
    expect(nameKey('Ana')).toBe('ana');
    expect(nameKey('Ａ.n\u200ba')).toBe('ana');
    expect(nameKey('Аnа')).toBe('ana');
    expect(nameKey('José Pérez')).toBe('joseperez');
    expect(nameKey('Ana')).not.toBe(nameKey('Anna'));
  });
});

// ---------- GIF ----------

/** Decoder LZW de GIF (solo para verificar el encoder). */
function lzwDecode(data: Uint8Array, minCodeSize: number): number[] {
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  let size = minCodeSize + 1;
  let dict: number[][] = [];
  const reset = () => {
    dict = Array.from({ length: clear + 2 }, (_, i) => (i < clear ? [i] : []));
    size = minCodeSize + 1;
  };
  reset();
  const out: number[] = [];
  let bit = 0;
  let prev: number[] | null = null;
  const read = () => {
    let code = 0;
    for (let i = 0; i < size; i++, bit++) if (data[bit >> 3] & (1 << (bit & 7))) code |= 1 << i;
    return code;
  };
  for (;;) {
    const code = read();
    if (code === clear) {
      reset();
      prev = null;
      continue;
    }
    if (code === eoi) break;
    let entry: number[];
    if (code < dict.length) entry = dict[code];
    else if (prev) entry = [...prev, prev[0]];
    else throw new Error('bad code');
    out.push(...entry);
    if (prev) dict.push([...prev, entry[0]]);
    prev = entry;
    if (dict.length === 1 << size && size < 12) size++;
  }
  return out;
}

describe('GIF de vista previa', () => {
  it('LZW ida y vuelta, también con muchos códigos (reinicio de tabla)', () => {
    const small = Uint8Array.from([0, 0, 0, 1, 2, 2, 2, 2, 3, 0, 0, 0]);
    expect(lzwDecode(lzwEncode(small, 8), 8)).toEqual(Array.from(small));
    const big = Uint8Array.from({ length: 40_000 }, (_, i) => (i * 7919) % 251);
    expect(lzwDecode(lzwEncode(big, 8), 8)).toEqual(Array.from(big));
  });

  it('arma un GIF89a animado con loop y la paleta fija', () => {
    const frame = (v: number) => ({ width: 4, height: 2, rgba: Uint8ClampedArray.from({ length: 32 }, (_, i) => (i % 4 === 3 ? 255 : v)) });
    const gif = encodeGif([frame(0), frame(255)], 25);
    expect(new TextDecoder().decode(gif.slice(0, 6))).toBe('GIF89a');
    expect(gif[6]).toBe(4);
    expect(new TextDecoder().decode(gif.slice(13 + 768 + 3, 13 + 768 + 14))).toBe('NETSCAPE2.0');
    expect(gif[gif.length - 1]).toBe(0x3b);
    expect(fixedPalette().length).toBe(768);
    expect(paletteIndex(255, 255, 255)).toBe(251);
    expect(() => encodeGif([])).toThrow();
  });
});

// ---------- Lógica pura ----------

describe('rec-schema', () => {
  it('reloj y capítulos como Loom (empiezan en 0:00, 5 s mínimo)', () => {
    expect(fmtClock(65)).toBe('1:05');
    expect(fmtClock(3723)).toBe('1:02:03');
    expect(parseClock('1:05')).toBe(65);
    expect(parseClock('1:61')).toBeNull();
    const ch = parseChapters('0:03 Intro\nbasura\n0:05 Muy cerca\n1:00 Demo\n0:30 - Setup');
    expect(ch).toEqual([
      { start: 0, title: 'Intro' },
      { start: 30, title: 'Setup' },
      { start: 60, title: 'Demo' },
    ]);
    expect(chaptersToText(ch)).toBe('0:00 Intro\n0:30 Setup\n1:00 Demo');
    expect(chapterAt(ch, 45)).toBe(1);
    expect(parseChapters('0:00 A\n2:00 Fuera', 90)).toEqual([{ start: 0, title: 'A' }]);
  });

  it('recorte no destructivo dentro de la duración', () => {
    expect(clampTrim(2, 8, 10)).toEqual({ start: 2, end: 8 });
    expect(clampTrim(-3, 20, 10)).toEqual({ start: 0, end: null });
    expect(clampTrim(5, 5.2, 10)).toEqual({ start: 5, end: 6 });
    expect(clampTrim(50, null, 10)).toEqual({ start: 9, end: null });
    expect(trimmedDuration(10, 2, 8)).toBe(6);
    expect(trimmedDuration(10, 2, null)).toBe(8);
  });

  it('CTA solo con URL web', () => {
    expect(cleanCtaUrl('zerosoft.ai/demo')).toBe('https://zerosoft.ai/demo');
    expect(cleanCtaUrl('mailto:a@b.co')).toBeNull();
    expect(cleanCtaUrl('http://127.0.0.1/x')).toBeNull();
    expect(cleanCtaUrl('https://localhost')).toBeNull();
    expect(cleanCtaUrl('javascript:alert(1)')).toBeNull();
  });

  it('subtítulos, segmentos, estadísticas y CSV', () => {
    const segs = cleanSegments([{ start: 5, end: 7, text: ' dos ' }, { start: 0, end: 2, text: 'uno' }, { start: 9, end: 9, text: '' }]);
    expect(segs.map((s) => s.text)).toEqual(['uno', 'dos']);
    expect(segmentsToVtt(segs)).toContain('00:00:05.000 --> 00:00:07.000\ndos');
    const s = viewStats(
      [
        { viewer_key: 'a', watched_sec: 10, max_position: 5, duration_sec: 10, cta_clicks: 0 },
        { viewer_key: 'a', watched_sec: 10, max_position: 10, duration_sec: 10, cta_clicks: 1 },
        { viewer_key: 'b', watched_sec: 2, max_position: 2, duration_sec: 10, cta_clicks: 0 },
      ],
      10,
    );
    expect(s).toEqual({ views: 3, unique: 2, avgPct: 60, completed: 1, ctaClicks: 1 });
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
  });
});

// ---------- Base ----------

let uploads = '';
const owner: RecActor = { ws: 'rec-owner', actor: 'rec-owner', admin: true, name: 'Owner' };
const member: RecActor = { ws: 'rec-owner', actor: 'rec-member', admin: false, name: 'Member' };
const mateActor = (): RecActor => ({ ws: 'rec-owner', actor: 'rec-mate', admin: false, name: 'Mate' });

beforeAll(async () => {
  uploads = await mkdtemp(path.join(os.tmpdir(), 'rec-up-'));
  vi.stubEnv('UPLOADS_DIR', uploads);
  vi.stubEnv('BLOB_READ_WRITE_TOKEN', '');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  await upsertUser({ id: 'rec-owner', email: 'rec-owner@test.local', name: 'Owner' });
  await upsertUser({ id: 'rec-member', email: 'rec-member@test.local', name: 'Member' });
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await rm(uploads, { recursive: true, force: true });
});

async function readyVideo(actor: RecActor, title = 'Demo', duration = 90) {
  const v = await createVideo(actor, { title, mode: 'screen_camera', contentType: 'video/webm' });
  await saveLocalPart(v.id, 'video', 2, Buffer.from('second'));
  await saveLocalPart(v.id, 'video', 1, Buffer.from('first-'));
  const out = await assembleLocal(v.id, 'video', 'video/webm', 2);
  await setVideoFile(v.id, 'video', out.url, { size: out.size });
  await finalizeVideo(actor, v.id, { durationSec: duration, width: 1280, height: 720 });
  return (await getVideoRow(actor, v.id))!;
}

describe('videos, carpetas y acceso', () => {
  it('sube por partes en cualquier orden y las une en orden', async () => {
    const v = await readyVideo(owner);
    expect(v.status).toBe('ready');
    expect(v.size).toBe(12);
    expect(isOwnRecUrl(v.url!, owner.ws, v.id)).toBe(true);
    expect(isOwnRecUrl(v.url!, owner.ws, 'otro')).toBe(false);
    expect(isOwnRecUrl(`https://x.public.blob.vercel-storage.com/rec/${owner.ws}/${v.id}/a-video.webm`, owner.ws, v.id)).toBe(true);
    expect(isOwnRecUrl(`https://x.public.blob.vercel-storage.com/crm/a.webm`, owner.ws, v.id)).toBe(false);
    const { readFile } = await import('fs/promises');
    const { localUploadPath } = await import('@/lib/uploads');
    expect((await readFile(localUploadPath(v.url!, 'rec')!)).toString()).toBe('first-second');
    // Faltan partes: no se cierra.
    const w = await createVideo(owner, { title: 'x', mode: 'camera', contentType: 'video/webm' });
    await saveLocalPart(w.id, 'video', 2, Buffer.from('b'));
    await expect(assembleLocal(w.id, 'video', 'video/webm', 2)).rejects.toBeInstanceOf(RecError);
  });

  it('Mis videos es de cada uno; el workspace lo ven todos; carpetas por espacio', async () => {
    const mine = await readyVideo(member, 'Solo mío');
    expect((await listVideos(member, { kind: 'mine' })).map((x) => x.id)).toContain(mine.id);
    expect((await listVideos({ ...member, actor: 'otra-persona' }, { kind: 'mine' })).map((x) => x.id)).not.toContain(mine.id);
    expect(await getVideoRow({ ...member, actor: 'otra-persona' }, mine.id)).toBeNull();
    // Lo personal es solo del autor: ni un admin del workspace lo ve ni lo edita (como en Loom).
    expect(await getVideoRow(owner, mine.id)).toBeNull();
    await expect(updateVideo(owner, mine.id, { title: 'x' })).rejects.toMatchObject({ code: 'not_found' });
    expect((await listVideos(owner, { kind: 'all' })).map((x) => x.id)).not.toContain(mine.id);
    const folder = await createFolder(member, { name: 'Ventas', space: 'workspace' });
    await updateVideo(member, mine.id, { folderId: folder.id });
    const moved = (await getVideoRow(member, mine.id))!;
    expect(moved.space).toBe('workspace');
    expect((await listVideos({ ...member, actor: 'otra-persona' }, { kind: 'folder', folderId: folder.id })).map((x) => x.id)).toEqual([mine.id]);
    expect((await searchRec({ ...member, actor: 'otra-persona' }, 'Ventas')).map((x) => x.kind)).toEqual(['folder']);
    // Otro miembro lo ve pero no lo puede editar; un admin sí (espacio del workspace).
    await expect(updateVideo({ ...member, actor: 'otra-persona' }, mine.id, { title: 'x' })).rejects.toMatchObject({ code: 'forbidden' });
    await updateVideo(owner, mine.id, { description: 'admin' });
    await deleteFolder(member, folder.id);
    expect((await getVideoRow(member, mine.id))!.folder_id).toBeNull();
  });

  it('privacidad: contraseña, vencimiento y solo workspace', async () => {
    const v = await readyVideo(owner, 'Privado');
    const anon = { ws: null, userId: null };
    const author = { ws: owner.ws, userId: owner.actor };
    const mate = { ws: owner.ws, userId: 'rec-member' };
    await expect(updateVideo(owner, v.id, { password: 'corta' })).rejects.toMatchObject({ code: 'invalid_password' });
    await updateVideo(owner, v.id, { password: 'clave-uno' });
    let row = (await getPublicVideoRow(v.share_id))!;
    // Con contraseña la descarga arranca apagada.
    expect(row.allow_download).toBe(0);
    expect(await verifyPassword('clave-uno', row.password_hash)).toBe(true);
    expect(await verifyPassword('otra', row.password_hash)).toBe(false);
    expect(publicAccess(row, anon, null)).toBe('password');
    expect(publicAccess(row, anon, unlockToken(row))).toBe('ok');
    expect(publicAccess(row, author, null)).toBe('ok');
    // Un miembro del workspace respeta la contraseña como cualquiera: solo el autor saltea.
    expect(publicAccess(row, mate, null)).toBe('password');
    await updateVideo(owner, v.id, { password: 'clave-dos' });
    const before = unlockToken(row);
    row = (await getPublicVideoRow(v.share_id))!;
    expect(publicAccess(row, anon, before)).toBe('password');
    await updateVideo(owner, v.id, { expiresAt: new Date(Date.now() - 1000).toISOString() });
    row = (await getPublicVideoRow(v.share_id))!;
    expect(publicAccess(row, anon, unlockToken(row))).toBe('expired');
    expect(publicAccess(row, mate, unlockToken(row))).toBe('expired');
    expect(publicAccess(row, author, null)).toBe('ok');
    await updateVideo(owner, v.id, { expiresAt: null, password: null, privacy: 'workspace' });
    row = (await getPublicVideoRow(v.share_id))!;
    expect(publicAccess(row, anon, null)).toBe('signin');
    expect(publicAccess(row, { ws: 'otro-ws', userId: 'x' }, null)).toBe('forbidden');
    expect(publicAccess(row, mate, null)).toBe('ok');
    await expect(updateVideo(owner, v.id, { ctaLabel: 'Agendá', ctaUrl: 'ftp://x' })).rejects.toMatchObject({ code: 'invalid_cta_url' });
    // WebM: el recorte necesita antes la copia cortada (si no, lo recortado se podría bajar).
    await expect(updateVideo(owner, v.id, { trimStart: 3, trimEnd: 60 })).rejects.toMatchObject({ code: 'trim_needs_cut' });
    await expect(updateVideo(owner, v.id, { trimStart: 30, trimEnd: 10 })).rejects.toMatchObject({ code: 'invalid_trim' });
    await setTrimmedFile(v.id, '/uploads/rec/cut.webm', '3:60');
    await updateVideo(owner, v.id, { ctaLabel: 'Agendá', ctaUrl: 'cal.com/demo', trimStart: 3, trimEnd: 60, chaptersText: '0:00 Intro\n0:40 Demo\n1:10 Fuera' });
    row = (await getPublicVideoRow(v.share_id))!;
    expect([row.cta_url, row.trim_start, row.trim_end, row.chapters_source]).toEqual(['https://cal.com/demo', 3, 60, 'user']);
    expect(videoFileFor(row, false)).toBe('/uploads/rec/cut.webm');
    expect(videoFileFor(row, true)).toBe(row.url);
    // Los demás no ven capítulos, transcripción ni resumen de lo recortado.
    await getDb().prepare('UPDATE rec_videos SET transcript = ?, summary = ? WHERE id = ?').run(
      JSON.stringify([{ start: 0, end: 2, text: 'secreto al inicio' }, { start: 10, end: 12, text: 'parte visible' }, { start: 65, end: 70, text: 'secreto al final' }]),
      'Resumen viejo',
      v.id,
    );
    row = (await getPublicVideoRow(v.share_id))!;
    const pub = toPublicDto(row);
    expect(pub.transcript.map((x) => x.text)).toEqual(['parte visible']);
    expect(pub.chapters).toEqual([{ start: 3, title: 'Intro' }, { start: 40, title: 'Demo' }]);
    expect(pub.summary).toBe('');
    expect(toPublicDto(row, true).transcript.length).toBe(3);
    expect(toDto(row, owner).transcript.length).toBe(3);
    await updateVideo(owner, v.id, { privacy: 'link', space: 'workspace' });
    expect((await searchRec(mateActor(), 'secreto')).length).toBe(0);
    expect((await searchRec(mateActor(), 'visible')).length).toBe(1);
    expect((await searchRec(owner, 'secreto')).length).toBe(1);
  });
});

describe('vistas, comentarios y avisos', () => {
  it('cuenta espectadores únicos, % visto y clics, sin contar al autor, y avisa la primera vez', async () => {
    const v = await readyVideo(owner, 'Vistas', 100);
    const author = { key: 'u:rec-owner', userId: 'rec-owner', name: 'Owner', isAuthor: true };
    expect(await trackRecView(v, author, {})).toEqual({ viewId: null });
    const ana = { key: 'a:ana', userId: null, name: 'Ana', isAuthor: false };
    const first = await trackRecView(v, ana, { duration: 100 });
    await trackRecView(v, ana, { viewId: first.viewId!, watched: 50, position: 50, duration: 100, cta: true, ranges: [[0, 50]] });
    // Otra vista de Ana y una de Beto.
    await trackRecView(v, ana, { duration: 100 });
    const beto = await trackRecView(v, { key: 'u:beto', userId: 'beto', name: 'Beto', isAuthor: false }, { duration: 100 });
    await trackRecView(v, { key: 'u:beto', userId: 'beto', name: 'Beto', isAuthor: false }, { viewId: beto.viewId!, watched: 60, position: 100, ranges: [[0, 60]] });
    await trackRecView(v, { key: 'u:beto', userId: 'beto', name: 'Beto', isAuthor: false }, { viewId: beto.viewId!, watched: 100, position: 100, ranges: [[0, 60], [55, 100]] });
    // Adelantar no cuenta: Caro vio 0–10 y 90–100, es el 20 %.
    const caro = await trackRecView(v, { key: 'a:caro', userId: null, name: '', isAuthor: false }, { duration: 100, ranges: [[0, 10]] });
    await trackRecView(v, { key: 'a:caro', userId: null, name: '', isAuthor: false }, { viewId: caro.viewId!, position: 100, ranges: [[90, 100]] });
    // Un viewId ajeno no suma.
    expect(await trackRecView(v, ana, { viewId: beto.viewId!, watched: 99, position: 99 })).toEqual({ viewId: null });
    const a = await getAnalytics(owner, v.id);
    expect([a.views, a.unique, a.avgPct, a.completed, a.ctaClicks]).toEqual([4, 3, 57, 1, 1]);
    expect(a.viewers.find((x) => x.viewerKey === 'a:caro')?.pct).toBe(20);
    expect(a.retention.length).toBe(20);
    expect(a.retention[0]).toBe(100);
    // La analítica es de quien administra.
    await expect(getAnalytics(mateActor(), v.id)).rejects.toBeTruthy();
    expect(a.viewers.find((x) => x.name === 'Beto')?.signedIn).toBe(true);
    const notes = (await getDb().prepare("SELECT title FROM notifications WHERE user_id = ? AND type = 'rec_view' AND source_id = ?").all('rec-owner', v.id)) as Array<{ title: string }>;
    expect(notes.length).toBe(3);
  });

  it('comentarios y reacciones con el segundo, respuestas, borrar y aviso al autor', async () => {
    const v = await readyVideo(owner, 'Comentarios', 100);
    const ana = { key: 'a:ana2', userId: null, name: 'Ana', isAuthor: false };
    const c = await addComment(v, ana, { kind: 'comment', body: 'Acá falta el paso de import', atSec: 42 });
    await addComment(v, ana, { kind: 'reaction', emoji: '🎉', atSec: 10 });
    await expect(addComment(v, ana, { kind: 'reaction', emoji: '💩' })).rejects.toMatchObject({ code: 'invalid_reaction' });
    await expect(addComment(v, { ...ana, name: '' }, { kind: 'comment', body: 'x' })).rejects.toMatchObject({ code: 'name_required' });
    const r = await addComment(v, { key: 'u:rec-owner', userId: 'rec-owner', name: 'Owner', isAuthor: true }, { kind: 'comment', body: 'Lo agrego', parentId: c.id, atSec: 50 });
    expect(r.atSec).toBeNull();
    const page = await listComments(v, ana.key);
    expect(page.comments.filter((x) => x.mine).length).toBe(1);
    expect(page.reactions).toEqual({ '🎉': 1 });
    expect(page.reactionMarks[0].mine).toBe(true);
    expect(page.comments.find((x) => x.id === r.id)?.byAuthor).toBe(true);
    expect(page.comments.find((x) => x.id === c.id)?.guest).toBe(true);
    // Avisos agrupados: un solo aviso sin leer con la cuenta.
    const types = (await getDb().prepare("SELECT meta, title FROM notifications WHERE source_id = ? AND type = 'rec_comment'").all(v.id)) as Array<{ meta: string; title: string }>;
    expect(types.length).toBe(1);
    expect(JSON.parse(types[0].meta).count).toBe(2);
    // Un invitado no puede usar el nombre de alguien del workspace.
    // Sin revelar membresía: el nombre de un miembro (o una variante) sale como invitado a secas.
    for (const fake of ['Owner', 'rec-owner', 'О.w\u200bn е r', 'ＯＷＮＥＲ']) {
      const x = await addComment(v, { ...ana, name: fake }, { kind: 'comment', body: 'x' });
      expect([x.authorName, x.guest]).toEqual(['', true]);
    }
    expect((await addComment(v, { ...ana, name: 'Ana María' }, { kind: 'comment', body: 'y' })).authorName).toBe('Ana María');
    // Paginación: de a 50, los más nuevos primero.
    for (let i = 0; i < 55; i++) await addComment(v, { ...ana, name: 'Lote' }, { kind: 'comment', body: `n${i}`, atSec: i });
    const p1 = await listComments(v, null);
    expect(p1.comments.filter((x) => !x.parentId).length).toBe(50);
    // Orden estable aunque caigan en el mismo segundo: el más nuevo primero.
    expect(p1.comments[0].body).toBe('n54');
    expect(p1.total).toBe(61);
    const p2 = await listComments(v, null, { before: p1.nextBefore });
    expect(p2.comments.filter((x) => !x.parentId).length).toBeGreaterThan(0);
    await expect(deleteComment(v, c.id, { ...ana, key: 'a:otro' }, null)).rejects.toMatchObject({ code: 'forbidden' });
    await deleteComment(v, c.id, ana, null);
    expect((await listComments(v, null)).total).toBe(60);
    await updateVideo(owner, v.id, { commentsRequireAccount: true });
    const acc = (await getVideoRow(owner, v.id))!;
    await expect(addComment(acc, ana, { kind: 'comment', body: 'x' })).rejects.toMatchObject({ code: 'signin_required' });
    await updateVideo(owner, v.id, { allowComments: false });
    const off = (await getVideoRow(owner, v.id))!;
    await expect(addComment(off, ana, { kind: 'comment', body: 'x' })).rejects.toMatchObject({ code: 'comments_off' });
  });
});

describe('transcripción y resumen', () => {
  it('con el fake transcribe, pone título y capítulos (si no se tocaron) y anota el uso', async () => {
    vi.stubEnv('REC_AI_FAKE', '1');
    const v = await readyVideo(owner, 'Video del 25 oct', 90);
    expect(await processRecVideo(v.id)).toBe('done');
    expect(await processRecVideo(v.id)).toBeNull();
    const row = (await getVideoRow(owner, v.id))!;
    expect(row.title).toBe('Onboarding walkthrough');
    expect(JSON.parse(row.chapters)).toEqual([
      { start: 0, title: 'Intro' },
      { start: 45, title: 'Walkthrough' },
    ]);
    expect(JSON.parse(row.transcript).length).toBe(fakeSegments(90).length);
    const usage = (await getDb().prepare("SELECT feature FROM ai_usage WHERE user_id = ? AND feature LIKE 'rec_%'").all(owner.ws)) as Array<{ feature: string }>;
    expect(new Set(usage.map((u) => u.feature))).toEqual(new Set(['rec_transcribe', 'rec_summary']));
    // El título que puso la persona no se pisa.
    const w = await readyVideo(owner, 'x', 30);
    await updateVideo(owner, w.id, { title: 'Mi título' });
    await processRecVideo(w.id);
    expect((await getVideoRow(owner, w.id))!.title).toBe('Mi título');
    expect(summaryPrompt(fakeSegments(30), 30)).toContain('[0:05]');
    vi.stubEnv('REC_AI_FAKE', '');
  });

  it('sin IA queda disabled con ai_disabled', async () => {
    vi.stubEnv('REC_AI_FAKE', '1');
    const v = await readyVideo(owner, 'Sin IA', 20);
    expect(await processRecVideo(v.id, { forceOff: true })).toBe('disabled');
    expect((await getVideoRow(owner, v.id))!.transcript_error).toBe('ai_disabled');
    vi.stubEnv('REC_AI_FAKE', '');
    vi.stubEnv('AI_GATEWAY_API_KEY', '');
    vi.stubEnv('VERCEL_OIDC_TOKEN', '');
    vi.stubEnv('VERCEL', '');
    const w = await readyVideo(owner, 'Sin IA 2', 20);
    expect(await processRecVideo(w.id)).toBe('disabled');
  });
});
