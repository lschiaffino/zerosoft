import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtemp, readFile, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import { getDb, upsertUser } from '@/lib/db';
import { createVideo, finalizeVideo, getVideoRow, setVideoFile, type RecActor } from '@/lib/rec';
import { assembleLocal, saveLocalPart } from '@/lib/rec-upload';
import { checkMp4Sig, downloadMp4, ffmpegArgs, mp4Filename, mp4Plan, mp4Sig } from '@/lib/rec-mp4';
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
