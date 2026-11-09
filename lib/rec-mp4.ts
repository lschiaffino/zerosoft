/**
 * Rec: descargar en MP4 (H.264 + AAC, el que abre QuickTime, WhatsApp o
 * Slides). Server-only.
 *
 * El grabador sigue guardando WebM: así se puede recortar, unir y sacar partes
 * sin recodificar (lib/rec-webm.ts) y lo recortado nunca sale del servidor.
 * Para descargar se arma un MP4 una sola vez por versión del video (la que ven
 * los demás: con recorte, la parte de adentro) y se guarda junto al video.
 * El primer pedido de descarga lo arma y responde 202; el navegador vuelve a
 * preguntar hasta que está.
 *
 * Dónde corre ffmpeg, en orden:
 * - REC_FFMPEG_PATH, o `ffmpeg` del sistema fuera de Vercel (self-host, dev y
 *   CI): un proceso aparte en el mismo servidor.
 * - En Vercel, una microVM de Vercel Sandbox (como Robots): baja el video por
 *   una URL firmada de 60 minutos, convierte, sube el MP4 a Blob con un token
 *   de un solo archivo y avisa por otra URL firmada. La función que lo lanza
 *   no espera.
 * - Sin ninguno: se descarga el archivo original, como antes.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { mkdtemp, readFile, rm, stat, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { getDb } from './db';
import { dropRecFiles, nowDb, videoFileFor, type RecVideoRow } from './rec';
import { isTrimmed } from './rec-schema';

/** Un armado que no avisó en este tiempo se puede volver a lanzar. */
const STALE_MIN = 45;
/** Después de un fallo, se baja el original durante este tiempo antes de reintentar. */
const FAILED_COOLDOWN_MIN = 10;
const SANDBOX_SNAPSHOT_KEY = 'sandbox_snapshot:rec-mp4:v1';
const SANDBOX_ROOT = '/vercel/sandbox/mp4';

type Row = Pick<
  RecVideoRow,
  'id' | 'workspace_id' | 'url' | 'content_type' | 'trim_start' | 'trim_end' | 'trimmed_url' | 'trimmed_for' | 'mp4_url' | 'mp4_size' | 'mp4_for' | 'mp4_status' | 'mp4_started_at'
>;

/** De qué versión es el MP4: el archivo que ven los demás y el recorte que hay que aplicarle. */
export function mp4Plan(v: Row): { source: string; key: string; trim: { start: number; end: number | null } | null } | null {
  const source = videoFileFor(v as RecVideoRow, false);
  if (!source) return null;
  // Si la fuente ya es la copia cortada, no se vuelve a cortar; si es el original con recorte (MP4/MOV), sí.
  const trim = source === v.url && isTrimmed(v.trim_start, v.trim_end) ? { start: v.trim_start, end: v.trim_end } : null;
  const key = createHash('sha256')
    .update(`${source}|${trim ? `${trim.start}:${trim.end ?? ''}` : ''}`)
    .digest('hex')
    .slice(0, 24);
  return { source, key, trim };
}

/** Argumentos de ffmpeg: H.264 yuv420p (lados pares), AAC estéreo y el índice al principio (se reproduce mientras baja). */
export function ffmpegArgs(input: string, output: string, trim: { start: number; end: number | null } | null, contentType = 'video/webm'): string[] {
  const cut = trim ? ['-ss', String(trim.start), ...(trim.end !== null ? ['-to', String(trim.end)] : [])] : [];
  // El formato de entrada sale del tipo guardado, no de lo que ffmpeg adivine, y solo lee archivos locales.
  const format = contentType.startsWith('video/webm') ? 'matroska' : 'mov';
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-protocol_whitelist',
    'file,pipe',
    ...cut,
    '-f',
    format,
    '-i',
    input,
    '-map',
    '0:v:0',
    '-map',
    '0:a:0?',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '23',
    '-pix_fmt',
    'yuv420p',
    '-vf',
    'scale=trunc(iw/2)*2:trunc(ih/2)*2',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-ac',
    '2',
    '-movflags',
    '+faststart',
    output,
  ];
}

export function mp4Filename(title: string): string {
  return `${(title || 'video').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100) || 'video'}.mp4`;
}

function localFfmpeg(): string | null {
  const own = process.env.REC_FFMPEG_PATH?.trim();
  if (own) return own;
  if (process.env.VERCEL) return null;
  if (process.env.REC_FFMPEG === 'off') return null;
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    const p = path.join(dir, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
    if (dir && existsSync(p)) return p;
  }
  return null;
}

function sandboxAvailable(): boolean {
  if (process.env.REC_MP4_SANDBOX === 'off') return false;
  return !!process.env.VERCEL && !!process.env.BLOB_READ_WRITE_TOKEN;
}

export type Mp4State = { state: 'ready'; url: string; size: number } | { state: 'preparing' } | { state: 'original' };

/**
 * Qué bajar: el MP4 si ya está; si la fuente ya es un MP4 sin recorte, ese
 * mismo; si no, se lanza el armado (una vez, aun con dos pedidos a la vez) y
 * se responde "preparando". Sin dónde convertir, el original.
 */
export async function downloadMp4(v: Row & { title?: string }): Promise<Mp4State> {
  const plan = mp4Plan(v);
  if (!plan) return { state: 'original' };
  if (v.mp4_url && v.mp4_for === plan.key) return { state: 'ready', url: v.mp4_url, size: Number(v.mp4_size) || 0 };
  if (v.content_type.startsWith('video/mp4') && !plan.trim) return { state: 'original' };
  const runner = localFfmpeg() ? 'local' : sandboxAvailable() ? 'sandbox' : null;
  if (!runner) return { state: 'original' };
  const now = Date.now();
  const ago = (min: number) => new Date(now - min * 60_000).toISOString().slice(0, 19).replace('T', ' ');
  // Falló hace poco con esta misma versión: el original, sin relanzar en bucle.
  if (v.mp4_status === 'failed' && v.mp4_for === plan.key && v.mp4_started_at && v.mp4_started_at > ago(FAILED_COOLDOWN_MIN)) return { state: 'original' };
  const claim = await getDb()
    .prepare(
      `UPDATE rec_videos SET mp4_status = 'processing', mp4_for = ?, mp4_started_at = ?, mp4_job = NULL
       WHERE id = ? AND NOT (mp4_status = 'processing' AND mp4_for = ? AND mp4_started_at > ?)`,
    )
    .run(plan.key, nowDb(), v.id, plan.key, ago(STALE_MIN));
  if (claim.changes) {
    const job = () => (runner === 'local' ? runLocal(v.id, plan.key) : runSandbox(v.id, plan.key)).catch((err) => failJob(v.id, plan.key, err));
    try {
      const { after } = await import('next/server');
      after(job);
    } catch {
      void job();
    }
  }
  return { state: 'preparing' };
}

async function failJob(id: string, key: string, err: unknown): Promise<void> {
  console.error('[rec-mp4]', err instanceof Error ? err.message.slice(0, 300) : err);
  await getDb().prepare("UPDATE rec_videos SET mp4_status = 'failed' WHERE id = ? AND mp4_for = ? AND mp4_status = 'processing'").run(id, key);
}

/** Guarda el MP4 si sigue siendo de la versión vigente; si no (otro recorte mientras tanto), lo borra. */
export async function finishJob(id: string, key: string, url: string, size: number): Promise<boolean> {
  const db = getDb();
  const prev = (await db.prepare('SELECT mp4_url FROM rec_videos WHERE id = ?').get(id)) as { mp4_url: string | null } | undefined;
  const res = await db
    .prepare("UPDATE rec_videos SET mp4_url = ?, mp4_size = ?, mp4_status = 'none', mp4_job = NULL WHERE id = ? AND mp4_for = ? AND mp4_status = 'processing'")
    .run(url, Math.max(0, Math.round(size)), id, key);
  if (!res.changes) {
    await dropRecFiles([url]).catch(() => undefined);
    return false;
  }
  if (prev?.mp4_url && prev.mp4_url !== url) await dropRecFiles([prev.mp4_url]).catch(() => undefined);
  return true;
}

async function sourceRow(id: string): Promise<(Row & { title: string }) | null> {
  return ((await getDb().prepare('SELECT * FROM rec_videos WHERE id = ?').get(id)) as (Row & { title: string }) | undefined) ?? null;
}

async function storeMp4(v: Row, bytes: Buffer): Promise<string> {
  const { blobUploadEnabled, recBlobAccess } = await import('./rec-upload');
  if (blobUploadEnabled()) {
    const { put } = await import('@vercel/blob');
    const res = await put(`rec/${v.workspace_id}/${v.id}/${randomBytes(9).toString('base64url')}-mp4.mp4`, bytes, {
      access: recBlobAccess(),
      contentType: 'video/mp4',
      addRandomSuffix: false,
      multipart: bytes.length > 50 * 1024 * 1024,
    });
    return res.url;
  }
  const { saveUpload } = await import('./uploads');
  return saveUpload('rec', `${v.id}-download.mp4`, 'video/mp4', bytes);
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d: Buffer) => {
      err = (err + d.toString()).slice(-2000);
    });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}: ${err.slice(-300)}`))));
  });
}

/** ffmpeg en este servidor. */
async function runLocal(id: string, key: string): Promise<void> {
  const ffmpeg = localFfmpeg();
  const v = await sourceRow(id);
  if (!ffmpeg || !v) return;
  const plan = mp4Plan(v);
  if (!plan || plan.key !== key) return;
  const dir = await mkdtemp(path.join(os.tmpdir(), 'rec-mp4-'));
  try {
    const { localUploadPath } = await import('./uploads');
    let input = localUploadPath(plan.source, 'rec');
    if (!input) {
      const { readRecBlob } = await import('./rec-upload');
      input = path.join(dir, 'in');
      await writeFile(input, await readRecBlob(plan.source));
    }
    const out = path.join(dir, 'out.mp4');
    await run(ffmpeg, ffmpegArgs(input, out, plan.trim, v.content_type));
    const size = (await stat(out)).size;
    await finishJob(id, key, await storeMp4(v, await readFile(out)), size);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

// ============================================================
// Vercel Sandbox
// ============================================================

/** Firma de las URLs que usa la microVM: video, versión, para qué y hasta cuándo. */
export function mp4Sig(id: string, key: string, purpose: 'source' | 'done', exp: number): string {
  return createHmac('sha256', process.env.NEXTAUTH_SECRET ?? 'rec').update(`rec-mp4:${purpose}:${id}:${key}:${exp}`).digest('base64url');
}

export function checkMp4Sig(id: string, key: string, purpose: 'source' | 'done', exp: string | null, sig: string | null, now = Date.now()): boolean {
  if (!exp || !sig || !/^\d{1,12}$/.test(exp) || Number(exp) * 1000 < now) return false;
  const want = mp4Sig(id, key, purpose, Number(exp));
  return sig.length === want.length && timingSafeEqual(Buffer.from(sig), Buffer.from(want));
}

function signedUrl(base: string, id: string, key: string, purpose: 'source' | 'done', minutes: number): string {
  const exp = Math.floor(Date.now() / 1000) + minutes * 60;
  return `${base}/api/rec/mp4?id=${encodeURIComponent(id)}&key=${key}&purpose=${purpose}&exp=${exp}&sig=${mp4Sig(id, key, purpose, exp)}`;
}

/** Script de la microVM: baja por partes, convierte, sube con el token de un archivo y avisa. */
export function sandboxRunner(): string {
  return `'use strict';
const fs = require('fs');
const { spawnSync } = require('child_process');
const job = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
async function main() {
  const out = fs.openSync('${SANDBOX_ROOT}/in', 'w');
  let start = 0, total = Infinity;
  while (start < total) {
    const r = await fetch(job.source, { headers: { range: 'bytes=' + start + '-' } });
    if (!r.ok) throw new Error('source ' + r.status);
    const buf = Buffer.from(await r.arrayBuffer());
    fs.writeSync(out, buf);
    if (r.status === 200) break;
    const m = /bytes (\\d+)-(\\d+)\\/(\\d+)/.exec(r.headers.get('content-range') || '');
    if (!m) throw new Error('range');
    total = Number(m[3]);
    start = Number(m[2]) + 1;
  }
  fs.closeSync(out);
  const ff = require('ffmpeg-static');
  const args = job.args.map((a) => a === '__IN__' ? '${SANDBOX_ROOT}/in' : a === '__OUT__' ? '${SANDBOX_ROOT}/out.mp4' : a);
  const r = spawnSync(ff, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  if (r.status !== 0) throw new Error('ffmpeg ' + String(r.stderr).slice(-300));
  const { put } = require('@vercel/blob/client');
  const size = fs.statSync('${SANDBOX_ROOT}/out.mp4').size;
  const blob = await put(job.pathname, fs.createReadStream('${SANDBOX_ROOT}/out.mp4'), { access: job.access, token: job.token, contentType: 'video/mp4', multipart: true });
  await fetch(job.done, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: blob.url, size }) });
}
main().catch(async (e) => {
  await fetch(job.done, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ error: String(e && e.message || e).slice(0, 300) }) }).catch(() => {});
  process.exit(1);
});
`;
}

type SandboxModule = typeof import('@vercel/sandbox');

function sandboxCredentials(): Record<string, string> {
  if (process.env.VERCEL_OIDC_TOKEN || process.env.VERCEL === '1') return {};
  const { VERCEL_TOKEN: token, VERCEL_TEAM_ID: teamId, VERCEL_PROJECT_ID: projectId } = process.env;
  return token && teamId && projectId ? { token, teamId, projectId } : {};
}

async function sandboxSnapshot(Sandbox: SandboxModule['Sandbox']): Promise<string> {
  const row = (await getDb().prepare('SELECT value FROM robot_runtime WHERE key = ?').get(SANDBOX_SNAPSHOT_KEY)) as { value: string } | undefined;
  if (row?.value) return row.value;
  const sbx = await Sandbox.create({ ...sandboxCredentials(), image: 'vercel/sandbox/node:24', resources: { vcpus: 2 }, timeout: 10 * 60_000, persistent: false } as Parameters<
    SandboxModule['Sandbox']['create']
  >[0]);
  try {
    await sbx.mkDir(SANDBOX_ROOT).catch(() => {});
    await sbx.writeFiles([{ path: `${SANDBOX_ROOT}/package.json`, content: Buffer.from(JSON.stringify({ name: 'rec-mp4', private: true })) }]);
    const r = await sbx.runCommand({ cmd: 'npm', args: ['install', 'ffmpeg-static@5.2.0', '@vercel/blob@2', '--no-audit', '--no-fund'], cwd: SANDBOX_ROOT });
    if (r.exitCode !== 0) throw new Error(`mp4 snapshot: ${(await r.stderr().catch(() => '')).slice(-300)}`);
    const snap = await sbx.snapshot({ expiration: 0 });
    await getDb()
      .prepare('INSERT INTO robot_runtime (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
      .run(SANDBOX_SNAPSHOT_KEY, snap.snapshotId, new Date().toISOString());
    return snap.snapshotId;
  } catch (err) {
    await sbx.stop().catch(() => {});
    throw err;
  }
}

/** Lanza la microVM y vuelve: la VM avisa al terminar (POST /api/rec/mp4?purpose=done). */
async function runSandbox(id: string, key: string): Promise<void> {
  const v = await sourceRow(id);
  if (!v) return;
  const plan = mp4Plan(v);
  if (!plan || plan.key !== key) return;
  const { Sandbox } = await import('@vercel/sandbox');
  const { generateClientTokenFromReadWriteToken } = await import('@vercel/blob/client');
  const { recBlobAccess } = await import('./rec-upload');
  const { recBaseUrl } = await import('./rec-page');
  const base = recBaseUrl();
  const pathname = `rec/${v.workspace_id}/${v.id}/${randomBytes(9).toString('base64url')}-mp4.mp4`;
  const token = await generateClientTokenFromReadWriteToken({
    pathname,
    allowedContentTypes: ['video/mp4'],
    validUntil: Date.now() + 2 * 3600_000,
    addRandomSuffix: false,
  });
  let snapshotId = await sandboxSnapshot(Sandbox);
  const create = (sid: string) =>
    Sandbox.create({
      ...sandboxCredentials(),
      source: { type: 'snapshot', snapshotId: sid },
      resources: { vcpus: 4 },
      timeout: STALE_MIN * 60_000,
      persistent: false,
    } as Parameters<SandboxModule['Sandbox']['create']>[0]);
  let sbx;
  try {
    sbx = await create(snapshotId);
  } catch {
    // Snapshot vencido o borrado: se rearma una vez.
    await getDb().prepare('DELETE FROM robot_runtime WHERE key = ?').run(SANDBOX_SNAPSHOT_KEY);
    snapshotId = await sandboxSnapshot(Sandbox);
    sbx = await create(snapshotId);
  }
  const job = {
    source: signedUrl(base, id, key, 'source', 60),
    done: signedUrl(base, id, key, 'done', STALE_MIN + 5),
    pathname,
    token,
    access: recBlobAccess(),
    args: ffmpegArgs('__IN__', '__OUT__', plan.trim, v.content_type),
  };
  await sbx.writeFiles([
    { path: `${SANDBOX_ROOT}/run.cjs`, content: Buffer.from(sandboxRunner()) },
    { path: `${SANDBOX_ROOT}/job.json`, content: Buffer.from(JSON.stringify(job)) },
  ]);
  await getDb().prepare('UPDATE rec_videos SET mp4_job = ? WHERE id = ? AND mp4_for = ?').run(sbx.name, id, key);
  await sbx.runCommand({ cmd: 'node', args: [`${SANDBOX_ROOT}/run.cjs`, `${SANDBOX_ROOT}/job.json`], cwd: SANDBOX_ROOT, detached: true });
}

/** Aviso de la microVM: guarda el MP4 (o marca el fallo) y la apaga. */
export async function sandboxDone(id: string, key: string, body: { url?: string; size?: number; error?: string }): Promise<void> {
  const row = (await getDb().prepare('SELECT workspace_id, mp4_job FROM rec_videos WHERE id = ?').get(id)) as { workspace_id: string; mp4_job: string | null } | undefined;
  if (!row) return;
  const { isOwnRecUrl } = await import('./rec-upload');
  if (body.url && isOwnRecUrl(body.url, row.workspace_id, id) && /-mp4\.mp4$/.test(body.url)) await finishJob(id, key, body.url, Number(body.size) || 0);
  else await failJob(id, key, new Error(body.error || 'sandbox_failed'));
  if (row.mp4_job) {
    try {
      const { Sandbox } = await import('@vercel/sandbox');
      const sbx = await Sandbox.get({ ...sandboxCredentials(), name: row.mp4_job } as Parameters<SandboxModule['Sandbox']['get']>[0]);
      await sbx.stop();
    } catch {
      /* se apaga sola al vencer */
    }
  }
}

export { sourceRow as mp4SourceRow };
