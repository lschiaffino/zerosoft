/**
 * Calls: de la grabación a la llamada lista. Server-only.
 *
 * 1. Transcribe cada segmento de audio con la transcripción de Voice
 *    (lib/voice-transcribe.ts) y guarda el resultado por segmento: si la
 *    función se corta, la próxima corrida sigue donde quedó.
 * 2. Pone nombres a los hablantes (línea de tiempo del bot), calcula las
 *    métricas y pide el análisis a la IA (si falla, la llamada queda lista
 *    igual, sin análisis, y se puede reintentar).
 * 3. CRM (contactos, deal y actividad), Talk, webhook call.ready y aviso a
 *    quien grabó.
 *
 * Cada llamada se reclama con processing_claimed_at (compare-and-set).
 */
import { getDb } from '../db';
import { listOwnerSpacePeople } from '../workspace';
import { createNotification } from '../notifications';
import { localized } from '../notification-copy';
import { appBaseUrl } from '../calendar-notify';
import { readCallFile } from './files';
import { getCallById, removeCall, videoParts, type CallRow } from './core';
import { computeMetrics, offsetPieces, resolveSpeakers, type RawPiece } from './metrics';
import { analyzeCall } from './ai';
import { getSettings } from './settings';
import { CALLS_FAKE_TEXT } from './fake-text';
import { MAX_DIRECT_TRANSCRIBE_BYTES, nowIso, parseJson, type CallAnalysis, type Caption, type TimelineEntry } from './types';

const db = () => getDb();
const CLAIM_MS = 10 * 60_000;

async function transcribeBytes(ws: string, bytes: Buffer, mime: string, durationHintMs: number): Promise<{ pieces: RawPiece[]; language: string }> {
  const { transcribeAudio } = await import('../voice-transcribe');
  const res = await transcribeAudio({
    workspaceId: ws,
    audio: new Uint8Array(bytes),
    mimeType: mime,
    language: 'auto',
    durationHintMs,
    fakeText: CALLS_FAKE_TEXT,
    fakeSpeakers: true,
  });
  return { pieces: res.pieces, language: res.language };
}

/** Transcribe los segmentos que faltan. Devuelve los tramos de toda la llamada. */
async function transcribeAll(row: CallRow, deadline: number): Promise<{ pieces: RawPiece[]; language: string; done: boolean }> {
  const segs = (await db()
    .prepare("SELECT n, ref, size, mime, start_ms, transcript FROM calls_parts WHERE call_id = ? AND kind = 'audio' ORDER BY n")
    .all(row.id)) as Array<{ n: number; ref: string; size: number; mime: string; start_ms: number; transcript: string | null }>;
  let language = row.language ?? '';
  const pieces: RawPiece[] = [];
  if (segs.length) {
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      let got = parseJson<{ pieces: RawPiece[]; language: string } | null>(s.transcript, null);
      if (!got) {
        if (Date.now() > deadline) return { pieces, language, done: false };
        const bytes = await readCallFile(s.ref);
        if (!bytes) throw new Error('segment_unreadable');
        const next = segs[i + 1];
        const hint = next ? Number(next.start_ms) - Number(s.start_ms) : Math.max(1000, Number(row.duration_ms) - Number(s.start_ms));
        got = await transcribeBytes(row.workspace_id, bytes, s.mime || row.audio_mime || 'audio/ogg', hint);
        await db().prepare("UPDATE calls_parts SET transcript = ? WHERE call_id = ? AND kind = 'audio' AND n = ?").run(JSON.stringify(got), row.id, s.n);
      }
      language ||= got.language;
      pieces.push(...offsetPieces(got.pieces, Number(s.start_ms)));
    }
    return { pieces, language, done: true };
  }
  // Grabación subida: se transcribe el archivo entero si entra (tope del proveedor).
  if (Number(row.video_bytes) > 0 && Number(row.video_bytes) <= MAX_DIRECT_TRANSCRIBE_BYTES) {
    const parts = await videoParts(row.id);
    const refs = (await db().prepare("SELECT ref FROM calls_parts WHERE call_id = ? AND kind = 'video' ORDER BY n").all(row.id)) as Array<{ ref: string }>;
    const chunks: Buffer[] = [];
    for (const r of refs) {
      const b = await readCallFile(r.ref);
      if (!b) throw new Error('part_unreadable');
      chunks.push(b);
    }
    if (chunks.length !== parts.length) throw new Error('part_unreadable');
    const got = await transcribeBytes(row.workspace_id, Buffer.concat(chunks), row.video_mime || 'audio/webm', Number(row.duration_ms) || 0);
    return { pieces: got.pieces, language: got.language, done: true };
  }
  return { pieces: [], language, done: true };
}

/**
 * Procesa una llamada en 'processing'. 'done' (lista o falló del todo),
 * 'partial' (se cortó por tiempo, sigue la próxima), 'skipped' (otro la tiene).
 */
export async function processCall(callId: string, opts: { budgetMs?: number; now?: Date } = {}): Promise<'done' | 'partial' | 'skipped'> {
  const now = opts.now ?? new Date();
  const row0 = await getCallById(callId);
  if (!row0 || row0.status !== 'processing') return 'skipped';
  const stale = new Date(now.getTime() - CLAIM_MS).toISOString();
  const claim = await db()
    .prepare("UPDATE calls SET processing_claimed_at = ?, processing_attempts = processing_attempts + 1 WHERE id = ? AND status = 'processing' AND (processing_claimed_at IS NULL OR processing_claimed_at < ?)")
    .run(now.toISOString(), callId, stale);
  if (!claim.changes) return 'skipped';
  const row = (await getCallById(callId))!;
  const deadline = Date.now() + (opts.budgetMs ?? 200_000);
  try {
    const settings = await getSettings(row.workspace_id);
    let tr: Awaited<ReturnType<typeof transcribeAll>>;
    try {
      tr = await transcribeAll(row, deadline);
    } catch (err) {
      // Sin transcripción (proveedor caído, cuota) igual hay subtítulos de Meet.
      console.error('[calls] transcribe failed', err instanceof Error ? err.message : 'error');
      if (Number(row.processing_attempts) + 1 < 3) {
        await db().prepare('UPDATE calls SET processing_claimed_at = NULL WHERE id = ?').run(callId);
        return 'partial';
      }
      tr = { pieces: [], language: row.language ?? '', done: true };
    }
    if (!tr.done) {
      await db().prepare('UPDATE calls SET processing_claimed_at = NULL WHERE id = ?').run(callId);
      return 'partial';
    }
    const people = await listOwnerSpacePeople(row.workspace_id, {});
    const ownerName = people.find((p) => p.id === row.owner_id)?.name ?? '';
    const { utterances, speakers } = resolveSpeakers(tr.pieces, parseJson<TimelineEntry[]>(row.speaker_timeline, []), parseJson<Caption[]>(row.captions, []), {
      internalNames: [ownerName, ...people.map((p) => p.name ?? '')].filter(Boolean),
      botName: settings.botName,
      unknownLabel: 'Speaker',
    });
    const metrics = computeMetrics(utterances, speakers);
    const durationMs = Number(row.duration_ms) || (utterances.length ? utterances[utterances.length - 1].b : 0);
    let analysis: CallAnalysis | null = null;
    let error: string | null = utterances.length ? null : 'no_speech';
    if (utterances.length) {
      try {
        analysis = await analyzeCall({ ws: row.workspace_id, title: row.title, utterances, speakers, settings, language: tr.language || 'en' });
      } catch (err) {
        console.error('[calls] analysis failed', err instanceof Error ? err.message : 'error');
        error = 'analysis_failed';
      }
    }
    const ts = nowIso();
    await db()
      .prepare(
        `UPDATE calls SET status = 'ready', transcript = ?, transcript_text = ?, speakers = ?, metrics = ?, analysis = ?, language = ?, duration_ms = ?, error = ?,
           processing_claimed_at = NULL, updated_at = ? WHERE id = ? AND status = 'processing'`,
      )
      .run(
        JSON.stringify(utterances),
        utterances.map((u) => u.t).join(' ').slice(0, 400_000),
        JSON.stringify(speakers),
        JSON.stringify(metrics),
        analysis ? JSON.stringify(analysis) : null,
        tr.language || null,
        durationMs,
        error,
        ts,
        callId,
      );
    // Las transcripciones por segmento ya no hacen falta (quedan en la llamada).
    await db().prepare("UPDATE calls_parts SET transcript = NULL WHERE call_id = ? AND kind = 'audio'").run(callId);
    await afterReady(callId).catch((err) => console.error('[calls] after ready', err instanceof Error ? err.message : 'error'));
    return 'done';
  } catch (err) {
    console.error('[calls] process failed', err instanceof Error ? err.message : 'error');
    if (Number(row.processing_attempts) + 1 >= 3) {
      await db().prepare("UPDATE calls SET status = 'failed', error = 'processing_failed', processing_claimed_at = NULL, updated_at = ? WHERE id = ?").run(nowIso(), callId);
      return 'done';
    }
    await db().prepare('UPDATE calls SET processing_claimed_at = NULL WHERE id = ?').run(callId);
    return 'partial';
  }
}

/** Vuelve a pedir el análisis (después de cambiar la metodología, o si falló). */
export async function reanalyze(row: CallRow): Promise<CallAnalysis> {
  const settings = await getSettings(row.workspace_id);
  const analysis = await analyzeCall({
    ws: row.workspace_id,
    title: row.title,
    utterances: parseJson(row.transcript, []),
    speakers: parseJson(row.speakers, []),
    settings,
    language: row.language || 'en',
  });
  await db().prepare("UPDATE calls SET analysis = ?, error = CASE WHEN error = 'analysis_failed' THEN NULL ELSE error END, updated_at = ? WHERE id = ?").run(JSON.stringify(analysis), nowIso(), row.id);
  return analysis;
}

/** Lo que pasa cuando una llamada queda lista: CRM, Talk, webhook y aviso. */
export async function afterReady(callId: string): Promise<void> {
  let row = await getCallById(callId);
  if (!row || row.status !== 'ready') return;
  const { linkCallToCrm, logCallToCrm } = await import('./crm');
  await linkCallToCrm(row).catch((err) => console.error('[calls] crm link', err instanceof Error ? err.message : 'error'));
  row = (await getCallById(callId))!;
  await logCallToCrm(row).catch((err) => console.error('[calls] crm log', err instanceof Error ? err.message : 'error'));
  row = (await getCallById(callId))!;
  const analysis = parseJson<CallAnalysis | null>(row.analysis, null);
  const link = `${appBaseUrl()}/app/calls/call/${row.id}`;
  await createNotification({
    userId: row.owner_id,
    type: 'calls_activity',
    title: localized('callsReady', { title: row.title || null }),
    body: analysis?.summary.slice(0, 200),
    href: `/app/calls/call/${row.id}`,
    sourceType: 'call',
    sourceId: row.id,
  }).catch(() => null);
  await postToTalk(row, analysis, link).catch((err) => console.error('[calls] talk', err instanceof Error ? err.message : 'error'));
  const { emitWebhook } = await import('../webhooks');
  const settings = await getSettings(row.workspace_id);
  const owner = row.owner_id;
  const ws = row.workspace_id;
  await emitWebhook(
    ws,
    'call.ready',
    {
      id: row.id,
      title: row.title,
      url: link,
      startedAt: row.started_at,
      durationMs: Number(row.duration_ms),
      ownerId: row.owner_id,
      dealId: row.deal_id,
      summary: analysis?.summary ?? '',
      nextSteps: analysis?.nextSteps ?? [],
    },
    // Solo los webhooks de quien ve la llamada: el que grabó, un admin, o todos si es del equipo.
    async (creatorId) => {
      if (!creatorId || creatorId === ws || creatorId === owner || settings.visibility === 'team') return true;
      const admin = await db()
        .prepare("SELECT 1 AS ok FROM team_members m JOIN teams t ON t.id = m.team_id WHERE t.owner_id = ? AND m.user_id = ? AND m.role IN ('owner', 'admin') LIMIT 1")
        .get(ws, creatorId);
      return Boolean(admin);
    },
  );
}

async function postToTalk(row: CallRow, analysis: CallAnalysis | null, link: string): Promise<void> {
  const settings = await getSettings(row.workspace_id);
  if (!settings.talkChannel || !settings.talkChannelSetBy || row.posted_at) return;
  // Un canal del equipo no muestra llamadas privadas.
  if (settings.visibility === 'private') return;
  const claim = await db().prepare('UPDATE calls SET posted_at = ? WHERE id = ? AND posted_at IS NULL').run(nowIso(), row.id);
  if (!claim.changes) return;
  const min = Math.max(1, Math.round(Number(row.duration_ms) / 60_000));
  const lines = [`**${row.title || 'Call'}** · ${min} min`, ''];
  if (analysis?.summary) lines.push(analysis.summary, '');
  if (analysis?.nextSteps.length) lines.push(...analysis.nextSteps.slice(0, 5).map((n) => `- ${n.text}`), '');
  lines.push(link);
  const { postAsBot } = await import('../talk-bot');
  try {
    await postAsBot(row.workspace_id, { channel: settings.talkChannel, body: lines.join('\n').slice(0, 3900), botName: 'Calls', memberId: settings.talkChannelSetBy });
  } catch (err) {
    await db().prepare('UPDATE calls SET posted_at = NULL WHERE id = ?').run(row.id);
    throw err;
  }
}

export interface CallsCronResult {
  synced: number;
  dispatched: number;
  processed: number;
  expired: number;
  purged: number;
}

/**
 * Cron de Calls (cada minuto, aparte del resto): agenda desde los
 * calendarios, manda el bot a las reuniones que empiezan, procesa grabaciones
 * y cierra las que quedaron colgadas.
 */
export async function runCallsCron(opts: { budgetMs?: number; now?: Date } = {}): Promise<CallsCronResult> {
  const started = Date.now();
  const budget = opts.budgetMs ?? 240_000;
  const now = opts.now ?? new Date();
  const out: CallsCronResult = { synced: 0, dispatched: 0, processed: 0, expired: 0, purged: 0 };
  const { syncDueCalendars, dispatchDue } = await import('./schedule');
  out.synced = await syncDueCalendars({ now, budgetMs: 40_000 }).catch((err) => {
    console.error('[calls] sync', err instanceof Error ? err.message : 'error');
    return 0;
  });
  out.dispatched = await dispatchDue(now).catch((err) => {
    console.error('[calls] dispatch', err instanceof Error ? err.message : 'error');
    return 0;
  });
  out.expired = await expireStuck(now);
  const { purgeAbandonedUploads } = await import('./core');
  out.purged = await purgeAbandonedUploads(now).catch(() => 0);
  const stale = new Date(now.getTime() - CLAIM_MS).toISOString();
  const pending = (await db()
    .prepare("SELECT id FROM calls WHERE status = 'processing' AND (processing_claimed_at IS NULL OR processing_claimed_at < ?) ORDER BY updated_at LIMIT 10")
    .all(stale)) as Array<{ id: string }>;
  for (const p of pending) {
    const left = budget - (Date.now() - started);
    if (left < 30_000) break;
    const r = await processCall(p.id, { budgetMs: left - 20_000, now });
    if (r !== 'skipped') out.processed++;
  }
  return out;
}

/** Llamadas colgadas: el bot nunca avisó, o la grabación quedó a medio subir. */
async function expireStuck(now: Date): Promise<number> {
  const ago = (min: number) => new Date(now.getTime() - min * 60_000).toISOString();
  let n = 0;
  // En la sala de espera o entrando más de 30 min sin novedades: el bot se perdió.
  n += (await db().prepare("UPDATE calls SET status = 'failed', error = 'bot_lost', bot_token_hash = NULL, updated_at = ? WHERE status IN ('joining', 'waiting') AND updated_at < ?").run(now.toISOString(), ago(30))).changes;
  // Grabando más de 3 h 30 sin cerrar, o subiendo más de 2 h.
  n += (await db().prepare("UPDATE calls SET status = 'failed', error = 'bot_lost', bot_token_hash = NULL, updated_at = ? WHERE status = 'recording' AND updated_at < ?").run(now.toISOString(), ago(210))).changes;
  n += (await db().prepare("UPDATE calls SET status = 'failed', error = 'upload_incomplete', bot_token_hash = NULL, updated_at = ? WHERE status = 'uploading' AND source = 'bot' AND updated_at < ?").run(now.toISOString(), ago(120))).changes;
  // Agendadas que ya pasaron sin despacharse (el bot no fue): salteadas.
  n += (await db().prepare("UPDATE calls SET status = 'skipped', updated_at = ? WHERE status = 'scheduled' AND scheduled_end IS NOT NULL AND scheduled_end < ?").run(now.toISOString(), now.toISOString())).changes;
  // Salteadas y canceladas de hace más de 30 días: no se muestran en ningún lado.
  const old = (await db().prepare("SELECT id FROM calls WHERE status IN ('skipped', 'cancelled') AND updated_at < ? LIMIT 200").all(ago(30 * 24 * 60))) as Array<{ id: string }>;
  for (const r of old) await removeCall(r.id);
  // Partes de grabaciones que fallaron o se cancelaron: no se pueden ver, se borran.
  const { dropParts } = await import('./bot');
  const orphans = (await db()
    .prepare("SELECT DISTINCT p.call_id FROM calls_parts p JOIN calls c ON c.id = p.call_id WHERE c.status = 'cancelled' OR (c.status = 'failed' AND c.video_parts = 0) LIMIT 50")
    .all()) as Array<{ call_id: string }>;
  for (const r of orphans) await dropParts(r.call_id);
  return n;
}
