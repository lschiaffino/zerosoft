/**
 * Inbox: envíos programados de varios mensajes ("Más tarde" con una
 * secuencia). Cada mensaje es su fila en inbox_scheduled (sale como su propia
 * burbuja), atadas por batch_id y ordenadas por seq. delay_s es la espera
 * después del anterior: el primero sale a la hora elegida y cada uno espera a
 * que el anterior haya salido (si uno falla, los siguientes esperan).
 * Un mensaje puede llevar un archivo de WhatsApp (subido antes a
 * /api/inbox/upload); el texto va como pie. Server-only.
 */
import { readFile } from 'fs/promises';
import { getDb } from '../db';
import { deleteUploads, localUploadPath } from '../uploads';
import { futureIso, getScheduledOwned, getThreadRow, listScheduled, newId, nowIso, type ScheduledRow } from './core';
import { InboxError, LIMITS, type ScheduledDto } from './types';

export const MAX_PARTS = 10;
/** Espera máxima entre dos mensajes de una secuencia. */
export const MAX_DELAY_S = 7 * 86_400;
/** Tope de un archivo de un programado (el de WhatsApp para documentos y videos). */
export const MAX_SCHEDULED_MEDIA = 16 * 1024 * 1024;

export interface PartMedia {
  url: string;
  name: string;
  type: string;
}

export interface PartInput {
  body: string;
  delaySec?: number;
  media?: PartMedia | null;
}

/**
 * ¿La URL es un archivo subido para Inbox? Solo las que guarda
 * /api/inbox/upload: la carpeta local privada o Vercel Blob bajo inbox/.
 * Nada de URLs arbitrarias (el servidor las baja para mandarlas).
 */
export function isInboxMediaUrl(url: string): boolean {
  if (/^\/uploads\/inbox\/[A-Za-z0-9._-]{1,200}$/.test(url)) return true;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && /\.public\.blob\.vercel-storage\.com$/.test(u.hostname) && /^\/inbox\/[A-Za-z0-9._%-]{1,240}$/.test(u.pathname);
  } catch {
    return false;
  }
}

/** Limpia y valida las partes: 1 a MAX_PARTS, cada una con texto o archivo. */
export function cleanParts(parts: PartInput[], channel: string): Array<{ body: string; delaySec: number; media: PartMedia | null }> {
  if (!Array.isArray(parts) || parts.length === 0 || parts.length > MAX_PARTS) throw new InboxError('invalid_input', 400);
  return parts.map((p, i) => {
    const body = String(p.body ?? '').trim();
    if (body.length > LIMITS.message) throw new InboxError('too_long', 400);
    const media = p.media && p.media.url ? p.media : null;
    if (media) {
      if (channel !== 'whatsapp') throw new InboxError('media_unsupported', 400);
      if (!isInboxMediaUrl(media.url)) throw new InboxError('invalid_input', 400);
    }
    if (!body && !media) throw new InboxError('invalid_input', 400);
    const delay = i === 0 ? 0 : Math.max(0, Math.min(MAX_DELAY_S, Math.floor(Number(p.delaySec) || 0)));
    return {
      body,
      delaySec: delay,
      media: media ? { url: media.url, name: String(media.name || 'archivo').slice(0, 200), type: String(media.type || 'application/octet-stream').slice(0, 100) } : null,
    };
  });
}

/** Hora prevista de cada parte: la primera a `base`, las demás sumando esperas. */
export function plannedTimes(base: Date, delays: number[]): string[] {
  let t = base.getTime();
  return delays.map((d, i) => {
    if (i > 0) t += d * 1000;
    return new Date(t).toISOString();
  });
}

async function batchRows(owner: string, batchId: string): Promise<ScheduledRow[]> {
  return (await getDb().prepare('SELECT * FROM inbox_scheduled WHERE owner_id = ? AND batch_id = ? ORDER BY seq').all(owner, batchId)) as unknown as ScheduledRow[];
}

async function insertParts(owner: string, threadId: string, batchId: string, firstSeq: number, sendAt: string, parts: ReturnType<typeof cleanParts>, now: Date) {
  const db = getDb();
  const times = plannedTimes(new Date(sendAt), parts.map((p) => p.delaySec));
  const nowS = nowIso(now);
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    await db
      .prepare(
        `INSERT INTO inbox_scheduled (id, owner_id, thread_id, body, send_at, status, batch_id, seq, delay_s, media_url, media_name, media_type, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(newId('ibq'), owner, threadId, p.body, times[i], batchId, firstSeq + i, p.delaySec, p.media?.url ?? '', p.media?.name ?? '', p.media?.type ?? '', nowS, nowS);
  }
}

/**
 * Programa una secuencia. `key` (generado por la pantalla) la hace
 * idempotente: el mismo pedido dos veces (doble clic, reintento) no duplica.
 */
export async function createBatch(owner: string, input: { threadId: string; sendAt: string; parts: PartInput[]; key?: string }, now = new Date()): Promise<ScheduledDto[]> {
  const thread = await getThreadRow(owner, input.threadId);
  const parts = cleanParts(input.parts, thread.channel);
  const at = futureIso(input.sendAt, now);
  const key = input.key && /^[A-Za-z0-9_-]{8,64}$/.test(input.key) ? `ibb_${input.key}` : newId('ibb');
  const existing = await batchRows(owner, key);
  if (existing.length) {
    if (existing[0].thread_id !== thread.id) throw new InboxError('invalid_input', 400);
    return (await listScheduled(owner, thread.id)).filter((s) => s.batchId === key);
  }
  const pending = (await getDb().prepare("SELECT COUNT(*) AS n FROM inbox_scheduled WHERE owner_id = ? AND status = 'pending'").get(owner)) as { n: number };
  if (Number(pending.n) + parts.length > 2000) throw new InboxError('too_many', 400);
  await insertParts(owner, thread.id, key, 0, at, parts, now);
  return (await listScheduled(owner, thread.id)).filter((s) => s.batchId === key);
}

/** La secuencia de un programado (o el programado solo, si es de antes de las secuencias). */
async function batchOf(owner: string, id: string): Promise<{ row: ScheduledRow; rows: ScheduledRow[] }> {
  const row = await getScheduledOwned(owner, id);
  return { row, rows: row.batch_id ? await batchRows(owner, row.batch_id) : [row] };
}

const OPEN = new Set(['pending', 'failed', 'missed']);

/**
 * Cambia lo que falta mandar de una secuencia: las partes que no salieron se
 * reemplazan por `parts` desde `sendAt`. Lo que ya salió queda. Los archivos
 * que dejan de usarse se borran.
 */
export async function replaceBatch(owner: string, id: string, input: { sendAt: string; parts: PartInput[] }, now = new Date()): Promise<ScheduledDto[]> {
  const { row, rows } = await batchOf(owner, id);
  if (rows.some((r) => r.status === 'sending')) throw new InboxError('busy', 409);
  const thread = await getThreadRow(owner, row.thread_id);
  const parts = cleanParts(input.parts, thread.channel);
  const at = futureIso(input.sendAt, now);
  const open = rows.filter((r) => OPEN.has(r.status));
  if (!open.length) throw new InboxError('not_found', 404);
  const db = getDb();
  const nowS = nowIso(now);
  for (const r of open) await db.prepare("UPDATE inbox_scheduled SET status = 'cancelled', updated_at = ? WHERE id = ? AND status IN ('pending','failed','missed')").run(nowS, r.id);
  const kept = new Set(parts.map((p) => p.media?.url).filter(Boolean));
  await deleteUploads(open.map((r) => r.media_url).filter((u) => u && !kept.has(u)));
  const batchId = row.batch_id || newId('ibb');
  const nextSeq = Math.max(-1, ...rows.map((r) => Number(r.seq))) + 1;
  await insertParts(owner, thread.id, batchId, row.batch_id ? nextSeq : 0, at, parts, now);
  return (await listScheduled(owner, thread.id)).filter((s) => s.batchId === batchId);
}

/** Cancela lo que falta de la secuencia (todas sus partes sin mandar). */
export async function cancelBatch(owner: string, id: string, now = new Date()): Promise<void> {
  const { rows } = await batchOf(owner, id);
  const open = rows.filter((r) => OPEN.has(r.status));
  if (!open.length) throw new InboxError('not_found', 404);
  for (const r of open) {
    await getDb().prepare("UPDATE inbox_scheduled SET status = 'cancelled', updated_at = ? WHERE id = ? AND status IN ('pending','failed','missed')").run(nowIso(now), r.id);
  }
  await deleteUploads(open.map((r) => r.media_url).filter(Boolean));
}

/** La primera parte que falta mandar de la secuencia (para "Enviar ya"). */
export async function firstOpenPart(owner: string, id: string): Promise<ScheduledRow> {
  const { rows } = await batchOf(owner, id);
  const first = rows.find((r) => OPEN.has(r.status) || r.status === 'sending');
  if (!first) throw new InboxError('not_found', 404);
  if (first.status === 'sending') throw new InboxError('busy', 409);
  return first;
}

/**
 * Siguiente parte pendiente después de `row` en su secuencia. Su hora pasa a
 * ser ahora + su espera: la espera se cuenta desde que salió el anterior (que
 * pudo salir tarde, o antes con "Enviar ya").
 */
export async function scheduleNextPart(row: ScheduledRow, now: Date): Promise<ScheduledRow | null> {
  if (!row.batch_id) return null;
  const next = (await getDb()
    .prepare("SELECT * FROM inbox_scheduled WHERE owner_id = ? AND batch_id = ? AND seq > ? AND status = 'pending' ORDER BY seq LIMIT 1")
    .get(row.owner_id, row.batch_id, row.seq)) as ScheduledRow | undefined;
  if (!next) return null;
  const at = new Date(now.getTime() + Number(next.delay_s) * 1000).toISOString();
  if (next.send_at !== at) {
    await getDb().prepare("UPDATE inbox_scheduled SET send_at = ?, updated_at = ? WHERE id = ? AND status = 'pending'").run(at, nowIso(now), next.id);
    next.send_at = at;
  }
  return next;
}

/**
 * Parte de una secuencia que todavía espera a una anterior (que no salió ni se
 * canceló). En SQL, sobre el alias s.
 */
export const BLOCKED_SQL =
  "(s.batch_id <> '' AND EXISTS (SELECT 1 FROM inbox_scheduled p WHERE p.batch_id = s.batch_id AND p.owner_id = s.owner_id AND p.seq < s.seq AND p.status NOT IN ('sent','cancelled')))";

/** Bytes de un archivo subido para Inbox (local o Blob). */
export async function readInboxMedia(url: string): Promise<Buffer> {
  if (!isInboxMediaUrl(url)) throw new InboxError('media_unavailable', 410);
  if (url.startsWith('/uploads/')) {
    const file = localUploadPath(url, 'inbox');
    const data = file ? await readFile(file).catch(() => null) : null;
    if (!data) throw new InboxError('media_unavailable', 410);
    return data;
  }
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) }).catch(() => null);
  if (!res?.ok) throw new InboxError('media_unavailable', 410);
  if (Number(res.headers.get('content-length') ?? 0) > MAX_SCHEDULED_MEDIA) throw new InboxError('too_large', 413);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_SCHEDULED_MEDIA) throw new InboxError('too_large', 413);
  return buf;
}
