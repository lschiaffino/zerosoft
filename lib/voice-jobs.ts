/**
 * Voice: trabajos en segundo plano (cron de cada minuto y tick). Server-only.
 * - Notas en cola: al cortar una grabación (o si se cortó sola) la nota con
 *   IA se arma acá; claim por fila (notes_status queued → running).
 * - Grabaciones colgadas: una reunión en "recording" sin trozos nuevos por
 *   más de 10 minutos (pestaña cerrada, red caída) se cierra y su nota queda
 *   en cola.
 * - Limpieza: reuniones vacías sin tocar de más de un día y grabaciones
 *   importadas a Blob que quedaron sin procesar más de 24 horas.
 */
import { list, del } from '@vercel/blob';
import { AiError } from './ai';
import { getDb } from './db';
import { workspaceRole } from './api-auth';
import { ownerScopeFor } from './crm-visibility';
import { closeRecording, UNTOUCHED_SQL, VoiceError, type VoiceSessionRow } from './voice';
import { enhance } from './voice-service';
import { meetingLabels, voiceMessages } from './voice-http';
import { voiceBlobEnabled } from './voice-blob';

export const STALE_RECORDING_MS = 10 * 60_000;
const EMPTY_MEETING_MS = 24 * 3_600_000;
const ORPHAN_BLOB_MS = 24 * 3_600_000;

/** Arma la nota de una reunión en cola. Devuelve el estado final. */
export async function processQueuedNote(sessionId: string): Promise<'done' | 'error' | 'skipped' | 'retry'> {
  const db = getDb();
  const claim = await db
    .prepare("UPDATE voice_sessions SET notes_status = 'running' WHERE id = ? AND notes_status = 'queued'")
    .run(sessionId);
  if (!claim.changes) return 'skipped';
  const row = (await db.prepare('SELECT * FROM voice_sessions WHERE id = ?').get(sessionId)) as VoiceSessionRow | undefined;
  if (!row) return 'skipped';
  const owner = { workspaceId: row.workspace_id, personId: row.person_id };
  const set = (status: string) => db.prepare('UPDATE voice_sessions SET notes_status = ? WHERE id = ?').run(status, sessionId);
  try {
    const scope = await ownerScopeFor({ workspaceId: owner.workspaceId, personId: owner.personId, role: await workspaceRole(owner.workspaceId, owner.personId) });
    await enhance({
      owner,
      scope,
      sessionId,
      locale: row.locale,
      labels: meetingLabels(row.locale),
      builtinNames: voiceMessages(row.locale).templates.builtin,
    });
    await set('done');
    return 'done';
  } catch (err) {
    if (err instanceof AiError && err.code === 'rate_limited') {
      await set('queued');
      return 'retry';
    }
    if (err instanceof VoiceError && err.code === 'invalid_state') {
      await set('');
      return 'skipped';
    }
    if (!(err instanceof AiError)) console.error('[voice] queued note failed', err instanceof Error ? err.message : 'error');
    await set('error');
    return 'error';
  }
}

export interface VoiceCronResult {
  closed: number;
  notes: number;
  emptyDeleted: number;
  blobsDeleted: number;
}

export async function runVoiceCron(opts: { budgetMs?: number; now?: Date; cleanup?: boolean } = {}): Promise<VoiceCronResult> {
  const start = Date.now();
  const now = opts.now ?? new Date();
  const budget = opts.budgetMs ?? 30_000;
  const db = getDb();
  const out: VoiceCronResult = { closed: 0, notes: 0, emptyDeleted: 0, blobsDeleted: 0 };

  // 1. Grabaciones colgadas.
  const staleBefore = new Date(now.getTime() - STALE_RECORDING_MS).toISOString();
  const stale = (await db
    .prepare("SELECT id FROM voice_sessions WHERE status = 'recording' AND COALESCE(last_chunk_at, updated_at) < ? LIMIT 100")
    .all(staleBefore)) as Array<{ id: string }>;
  for (const s of stale) {
    const res = await closeRecording(s.id, { queueNotes: true });
    if (res.closed) out.closed += 1;
  }

  // 2. Notas en cola (cada una puede tardar: con presupuesto de tiempo).
  const queued = (await db.prepare("SELECT id FROM voice_sessions WHERE notes_status = 'queued' ORDER BY updated_at LIMIT 20").all()) as Array<{ id: string }>;
  for (const q of queued) {
    if (Date.now() - start > budget) break;
    if ((await processQueuedNote(q.id)) === 'done') out.notes += 1;
  }

  if (opts.cleanup === false) return out;

  // 3. Reuniones vacías sin tocar de más de un día.
  const emptyBefore = new Date(now.getTime() - EMPTY_MEETING_MS).toISOString();
  const del1 = await db.prepare(`DELETE FROM voice_sessions WHERE id IN (SELECT s.id FROM voice_sessions s WHERE ${UNTOUCHED_SQL} AND s.created_at < ? LIMIT 500)`).run(emptyBefore);
  out.emptyDeleted = del1.changes;

  // 4. Grabaciones importadas a Blob que no se procesaron (se borran al transcribir).
  if (voiceBlobEnabled()) {
    try {
      const cutoff = now.getTime() - ORPHAN_BLOB_MS;
      let cursor: string | undefined;
      for (let page = 0; page < 5; page++) {
        const res = await list({ prefix: 'voice/', limit: 500, cursor });
        const old = res.blobs.filter((b) => new Date(b.uploadedAt).getTime() < cutoff).map((b) => b.url);
        if (old.length) {
          await del(old);
          out.blobsDeleted += old.length;
        }
        if (!res.hasMore || !res.cursor) break;
        cursor = res.cursor;
      }
    } catch (err) {
      console.error('[voice] blob cleanup failed', err instanceof Error ? err.message : 'error');
    }
  }
  return out;
}

/**
 * Arma la nota después de responder (next/server `after`); fuera de un
 * request (tests, scripts) corre enseguida. Si se cae, el cron la retoma.
 */
export async function queueNoteAfterResponse(sessionId: string): Promise<void> {
  const job = () => processQueuedNote(sessionId).then(() => undefined).catch(() => undefined);
  try {
    const { after } = await import('next/server');
    after(job);
  } catch {
    await job();
  }
}
