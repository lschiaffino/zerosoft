import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtemp, readFile, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import { getDb, upsertUser } from '@/lib/db';
import { createVideo, finalizeVideo, getVideoRow, setVideoFile, type RecActor } from '@/lib/rec';
import { assembleLocal, saveLocalPart } from '@/lib/rec-upload';
import { checkMp4Sig, downloadMp4, ffmpegArgs, mp4Filename, mp4Plan, mp4Sig, playbackMp4 } from '@/lib/rec-mp4';
import { localUploadPath } from '@/lib/uploads';

const has = (bin: string) => {
  try {
    execFileSync(bin, ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};
const FFMPEG = has('ffmpeg') && has('ffprobe');

let dir = '';
const owner: RecActor = { ws: 'mp4-owner', actor: 'mp4-owner', admin: true, name: 'Owner' };

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'rec-mp4-'));
  vi.stubEnv('UPLOADS_DIR', dir);
  vi.stubEnv('BLOB_READ_WRITE_TOKEN', '');
  await upsertUser({ id: 'mp4-owner', email: 'mp4-owner@test.local', name: 'Owner' });
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

async function videoFrom(bytes: Buffer, type: string, duration: number) {
  const v = await createVideo(owner, { title: 'Demo: "uno/dos"', mode: 'screen', contentType: type });
  await saveLocalPart(v.id, 'video', 1, bytes);
  const out = await assembleLocal(v.id, 'video', type, 1);
  await setVideoFile(v.id, 'video', out.url, { size: out.size, contentType: type });
  await finalizeVideo(owner, v.id, { durationSec: duration });
  return (await getVideoRow(owner, v.id))!;
}

function probe(file: string): { v: string; a: string; duration: number; pix: string } {
  const j = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]).toString()) as {
    streams: Array<{ codec_type: string; codec_name: string; pix_fmt?: string }>;
    format: { duration: string; format_name: string };
  };
  return {
    v: j.streams.find((s) => s.codec_type === 'video')?.codec_name ?? '',
    a: j.streams.find((s) => s.codec_type === 'audio')?.codec_name ?? '',
    pix: j.streams.find((s) => s.codec_type === 'video')?.pix_fmt ?? '',
    duration: Number(j.format.duration),
  };
}

describe('MP4 de descarga: reglas', () => {
  it('nombre del archivo, firma de las URLs de la microVM y argumentos', () => {
    expect(mp4Filename('Demo: "uno/dos"')).toBe('Demo uno dos.mp4');
    expect(mp4Filename('')).toBe('video.mp4');
    const exp = Math.floor(Date.now() / 1000) + 60;
    const sig = mp4Sig('id-1', 'k'.repeat(24), 'source', exp);
    expect(checkMp4Sig('id-1', 'k'.repeat(24), 'source', String(exp), sig)).toBe(true);
    expect(checkMp4Sig('id-1', 'k'.repeat(24), 'done', String(exp), sig)).toBe(false);
    expect(checkMp4Sig('id-2', 'k'.repeat(24), 'source', String(exp), sig)).toBe(false);
    expect(checkMp4Sig('id-1', 'k'.repeat(24), 'source', String(exp - 120), mp4Sig('id-1', 'k'.repeat(24), 'source', exp - 120))).toBe(false);
    const args = ffmpegArgs('in', 'out.mp4', { start: 2, end: 5 });
    expect(args.slice(args.indexOf('-ss'), args.indexOf('-ss') + 4)).toEqual(['-ss', '2', '-to', '5']);
    expect(args).toEqual(expect.arrayContaining(['libx264', 'aac', 'yuv420p', '+faststart']));
    // Keyframe cada 2 s: adelantar en el reproductor no decodifica de más.
    expect(args[args.indexOf('-force_key_frames') + 1]).toBe('expr:gte(t,n_forced*2)');
  });

  it('el reproductor usa el MP4 solo si es de la versión vigente y sin recorte aplicado', async () => {
    const v = await videoFrom(Buffer.from('x'), 'video/webm', 10);
    const plan = mp4Plan(v)!;
    expect(playbackMp4(v, false)).toBeNull();
    await getDb().prepare("UPDATE rec_videos SET mp4_url = '/uploads/rec/x-download.mp4', mp4_size = 9, mp4_for = ? WHERE id = ?").run(plan.key, v.id);
    const ready = (await getVideoRow(owner, v.id))!;
    expect(playbackMp4(ready, false)).toEqual({ url: '/uploads/rec/x-download.mp4', size: 9, key: plan.key });
    expect(playbackMp4(ready, true)).toEqual({ url: '/uploads/rec/x-download.mp4', size: 9, key: plan.key });
    // MP4 de otra versión: no.
    await getDb().prepare("UPDATE rec_videos SET mp4_for = 'otra' WHERE id = ?").run(v.id);
    expect(playbackMp4((await getVideoRow(owner, v.id))!, false)).toBeNull();
    // Con recorte y la copia cortada: quien mira recibe el MP4 de la copia; quien administra, el original (WebM).
    await getDb().prepare("UPDATE rec_videos SET trim_start = 2, trim_end = 5, trimmed_url = '/uploads/rec/x-trimmed.webm', trimmed_for = '2:5' WHERE id = ?").run(v.id);
    const cut = (await getVideoRow(owner, v.id))!;
    const cutPlan = mp4Plan(cut)!;
    expect(cutPlan.source).toBe('/uploads/rec/x-trimmed.webm');
    await getDb().prepare('UPDATE rec_videos SET mp4_for = ? WHERE id = ?').run(cutPlan.key, v.id);
    const cutReady = (await getVideoRow(owner, v.id))!;
    expect(playbackMp4(cutReady, false)?.key).toBe(cutPlan.key);
    expect(playbackMp4(cutReady, true)).toBeNull();
  });

  it('la versión cambia con el recorte (y un MP4 sin recorte se baja tal cual)', async () => {
    const v = await videoFrom(Buffer.from('x'), 'video/mp4', 10);
    const a = mp4Plan(v)!;
    expect(a.trim).toBeNull();
    vi.stubEnv('REC_FFMPEG', 'off');
    expect(await downloadMp4(v)).toEqual({ state: 'original' });
    await getDb().prepare('UPDATE rec_videos SET trim_start = 2, trim_end = 5 WHERE id = ?').run(v.id);
    const b = mp4Plan((await getVideoRow(owner, v.id))!)!;
    expect(b.key).not.toBe(a.key);
    expect(b.trim).toEqual({ start: 2, end: 5 });
    vi.stubEnv('REC_FFMPEG', '');
  });
});

describe.skipIf(!FFMPEG)('MP4 de descarga con ffmpeg local', () => {
  it('un WebM de MediaRecorder sale H.264/AAC con duración, una sola vez', async () => {
    const src = path.join(dir, 'src.webm');
    execFileSync('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=321x181:rate=15', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '3', '-c:v', 'libvpx', '-c:a', 'libopus', '-y', src]);
    const v = await videoFrom(await readFile(src), 'video/webm', 3);
    expect(await downloadMp4(v)).toEqual({ state: 'preparing' });
    // Un segundo pedido mientras se arma no lanza otro.
    expect(await downloadMp4((await getVideoRow(owner, v.id))!)).toEqual({ state: 'preparing' });
    let row = (await getVideoRow(owner, v.id))!;
    for (let i = 0; i < 120 && !row.mp4_url; i++) {
      await new Promise((r) => setTimeout(r, 250));
      row = (await getVideoRow(owner, v.id))!;
    }
    expect(row.mp4_url).toBeTruthy();
    const ready = await downloadMp4(row);
    expect(ready.state).toBe('ready');
    const file = localUploadPath(row.mp4_url!, 'rec')!;
    const p = probe(file);
    expect([p.v, p.a, p.pix]).toEqual(['h264', 'aac', 'yuv420p']);
    expect(p.duration).toBeGreaterThan(2.5);
    expect(p.duration).toBeLessThan(3.5);
    // Índice (moov) antes de los datos (mdat): el navegador sabe dónde está cada segundo con el primer pedido.
    const bytes = await readFile(file);
    expect(bytes.indexOf('moov')).toBeGreaterThan(0);
    expect(bytes.indexOf('moov')).toBeLessThan(bytes.indexOf('mdat'));
    // Keyframes a lo sumo cada 2 s.
    const keys = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v', '-skip_frame', 'nokey', '-show_entries', 'frame=pts_time', '-of', 'csv=p=0', file])
      .toString()
      .trim()
      .split('\n')
      .map((l) => parseFloat(l));
    expect(keys.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < keys.length; i++) expect(keys[i] - keys[i - 1]).toBeLessThanOrEqual(2.1);
  });

  it('un MP4 recortado sale cortado (lo recortado no se baja)', async () => {
    const src = path.join(dir, 'src.mp4');
    execFileSync('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=15', '-f', 'lavfi', '-i', 'sine', '-t', '6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-y', src]);
    const v = await videoFrom(await readFile(src), 'video/mp4', 6);
    await getDb().prepare('UPDATE rec_videos SET trim_start = 1, trim_end = 3 WHERE id = ?').run(v.id);
    expect((await downloadMp4((await getVideoRow(owner, v.id))!)).state).toBe('preparing');
    let row = (await getVideoRow(owner, v.id))!;
    for (let i = 0; i < 120 && !row.mp4_url; i++) {
      await new Promise((r) => setTimeout(r, 250));
      row = (await getVideoRow(owner, v.id))!;
    }
    const p = probe(localUploadPath(row.mp4_url!, 'rec')!);
    expect(p.duration).toBeGreaterThan(1.5);
    expect(p.duration).toBeLessThan(2.6);
  });
});
