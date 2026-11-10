/**
 * Calls: hablar con el bot de grabación (services/calls-bot, protocolo en
 * docs/calls-bot.md). Server-only.
 *
 * App → bot: pedidos firmados con HMAC-SHA256 (CALLS_BOT_SECRET) sobre
 * "<timestamp>.<MÉTODO> <path>.<cuerpo>" (la firma de un pedido no sirve para otro). Bot → app: Bearer con un token al azar por trabajo;
 * acá se guarda solo su hash y se borra cuando el trabajo termina.
 *
 * CALLS_BOT_FAKE=1 (tests, nunca en producción): no sale a internet; simula
 * una reunión corta con audio por las mismas funciones que usa el bot real.
 */
import { createHmac, timingSafeEqual } from 'crypto';
import { getDb } from '../db';
import { appBaseUrl } from '../calendar-notify';
import { listOwnerSpacePeople } from '../workspace';
import { blockedAppsFor } from '../workspace-apps';
import { getCallById, storeCallPart, type CallRow } from './core';
import { consentText, getSettings } from './settings';
import {
  ALONE_TIMEOUT_SEC,
  CallsError,
  LOBBY_TIMEOUT_SEC,
  MAX_AUDIO_SEGMENTS,
  MAX_DURATION_SEC,
  MAX_VIDEO_PARTS,
  PART_BYTES,
  hashToken,
  nowIso,
  type Caption,
  type TimelineEntry,
} from './types';

const db = () => getDb();

export function botFake(): boolean {
  return process.env.CALLS_BOT_FAKE === '1' && process.env.VERCEL_ENV !== 'production';
}

function botUrl(): string | null {
  const raw = process.env.CALLS_BOT_URL?.trim();
  // El token del trabajo viaja en el cuerpo: https siempre, salvo un bot local (self-host, pruebas).
  if (!raw) return null;
  const ok = /^https:\/\//.test(raw) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(raw);
  return ok ? raw.replace(/\/$/, '') : null;
}

function botSecret(): string | null {
  const s = process.env.CALLS_BOT_SECRET?.trim();
  return s && s.length >= 32 ? s : null;
}

/** ¿Hay bot para mandar? (la UI avisa si no). */
export function botConfigured(): boolean {
  return botFake() || Boolean(botUrl() && botSecret());
}

export function signRequest(secret: string, method: string, path: string, body: string, ts = Math.floor(Date.now() / 1000)): Record<string, string> {
  const sig = createHmac('sha256', secret).update(`${ts}.${method.toUpperCase()} ${path}.${body}`).digest('hex');
  return { 'x-zs-timestamp': String(ts), 'x-zs-signature': `sha256=${sig}` };
}

async function botFetch(method: 'POST' | 'DELETE' | 'GET', path: string, payload?: unknown): Promise<{ status: number; data: Record<string, unknown> }> {
  const base = botUrl();
  const secret = botSecret();
  if (!base || !secret) throw new CallsError('bot_not_configured', 503);
  const body = payload === undefined ? '' : JSON.stringify(payload);
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...signRequest(secret, method, path, body) },
    body: body || undefined,
    signal: AbortSignal.timeout(15_000),
    redirect: 'error',
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, data };
}

/**
 * ¿Calls está cortada para esta persona en el workspace (Ajustes › Workspace ›
 * Apps: apagada, o restringida y ella queda afuera)? Entonces el bot no entra
 * a sus reuniones: el cron no pasa por la sesión, así que lo mira acá.
 */
export async function callsBlockedFor(ws: string, person: string): Promise<boolean> {
  const who = (await listOwnerSpacePeople(ws)).find((p) => p.id === person);
  const blocked = await blockedAppsFor({ ownerId: ws, personId: person, role: who?.role ?? 'member', email: who?.email ?? null });
  return blocked.includes('calls');
}

export type DispatchResult = 'sent' | 'retry' | 'failed' | 'skipped';

/**
 * Manda el bot a la reunión de una llamada en 'queued'. Se reclama la fila
 * (dispatched_at con compare-and-set) para que dos corridas no lo manden dos veces.
 */
export async function dispatchCall(callId: string, now = new Date()): Promise<DispatchResult> {
  const row = await getCallById(callId);
  if (!row || row.status !== 'queued' || !row.meeting_url) return 'skipped';
  if (await callsBlockedFor(row.workspace_id, row.owner_id)) {
    await db().prepare("UPDATE calls SET status = 'cancelled', will_join = 0, updated_at = ? WHERE id = ? AND status = 'queued'").run(now.toISOString(), callId);
    return 'skipped';
  }
  const claim = await db()
    .prepare("UPDATE calls SET dispatched_at = ?, dispatch_attempts = dispatch_attempts + 1, updated_at = ? WHERE id = ? AND status = 'queued' AND (dispatched_at IS NULL OR dispatched_at = ?)")
    .run(now.toISOString(), now.toISOString(), callId, row.dispatched_at ?? '');
  if (!claim.changes) return 'skipped';
  // Mismo token en cada reintento: si el bot ya había aceptado el trabajo, sigue sirviendo.
  const token = jobToken(callId);
  await db().prepare('UPDATE calls SET bot_token_hash = ? WHERE id = ?').run(hashToken(token), callId);
  const settings = await getSettings(row.workspace_id);
  const owner = (await db().prepare('SELECT name, email FROM users WHERE id = ?').get(row.owner_id)) as { name: string | null; email: string } | undefined;
  const { recipientLocale } = await import('../notification-copy');
  const locale = await recipientLocale(row.owner_id).catch(() => 'en' as const);
  if (botFake()) {
    const { runFakeBot } = await import('./fake-bot');
    await runFakeBot(callId, token);
    return 'sent';
  }
  try {
    const res = await botFetch('POST', '/v1/jobs', {
      jobId: row.id,
      platform: row.platform,
      meetingUrl: row.meeting_url,
      botName: settings.botName,
      consentMessage: consentText(settings, owner?.name || owner?.email?.split('@')[0] || '', locale),
      callbackUrl: `${appBaseUrl()}/api/calls/bot`,
      callbackToken: token,
      maxDurationSec: MAX_DURATION_SEC,
      lobbyTimeoutSec: LOBBY_TIMEOUT_SEC,
      aloneTimeoutSec: ALONE_TIMEOUT_SEC,
    });
    if (res.status === 202 || res.status === 200) {
      await db().prepare("UPDATE calls SET status = 'joining', error = NULL, updated_at = ? WHERE id = ? AND status = 'queued'").run(nowIso(), callId);
      return 'sent';
    }
    if (res.status === 503 || res.status >= 500 || res.status === 429) return await retryLater(row, 'bot_busy');
    const code = typeof res.data.error === 'string' ? res.data.error.slice(0, 60) : 'bot_rejected';
    await failCall(callId, code);
    return 'failed';
  } catch (err) {
    if (err instanceof CallsError && err.code === 'bot_not_configured') {
      await failCall(callId, 'bot_not_configured');
      return 'failed';
    }
    return retryLater(row, 'bot_unreachable');
  }
}

async function retryLater(row: CallRow, code: string): Promise<DispatchResult> {
  // Hasta 6 intentos (uno por minuto): después de eso la reunión ya empezó hace rato.
  if (Number(row.dispatch_attempts) + 1 >= 6) {
    await failCall(row.id, code);
    return 'failed';
  }
  await db().prepare("UPDATE calls SET dispatched_at = NULL, error = ?, updated_at = ? WHERE id = ? AND status = 'queued'").run(code, nowIso(), row.id);
  return 'retry';
}

export async function failCall(callId: string, code: string): Promise<void> {
  const res = await db()
    .prepare("UPDATE calls SET status = 'failed', error = ?, bot_token_hash = NULL, updated_at = ? WHERE id = ? AND status NOT IN ('ready', 'processing', 'failed')")
    .run(code.slice(0, 60), nowIso(), callId);
  // Lo que llegó de una grabación fallida no se puede ver: no se guarda.
  if (res.changes) await dropParts(callId);
}

export async function dropParts(callId: string): Promise<void> {
  const refs = (await db().prepare('SELECT ref FROM calls_parts WHERE call_id = ?').all(callId)) as Array<{ ref: string }>;
  if (!refs.length) return;
  await db().prepare('DELETE FROM calls_parts WHERE call_id = ?').run(callId);
  const { deleteCallFiles } = await import('./files');
  await deleteCallFiles(refs.map((r) => r.ref)).catch(() => undefined);
}

/** Token del trabajo, derivado del id con el secreto del servidor: igual en cada reintento y nunca guardado. */
export function jobToken(callId: string): string {
  const key = process.env.CALLS_FILES_KEY || process.env.ENCRYPTION_KEY || process.env.NEXTAUTH_SECRET || 'zerosoft-dev-calls';
  return createHmac('sha256', key).update(`calls-bot-token:${callId}`).digest('base64url');
}

/**
 * Sacar al bot ya (detener grabación o borrar la llamada). Tira bot_unreachable
 * si el bot no confirmó, así la UI no dice "detenido" con el bot adentro. Igual,
 * sin token válido el bot no puede subir nada y sale solo.
 */
export async function stopBot(callId: string): Promise<void> {
  if (botFake()) return;
  const res = await botFetch('DELETE', `/v1/jobs/${encodeURIComponent(callId)}`).catch(() => null);
  if (!res || (res.status >= 300 && res.status !== 404)) throw new CallsError('bot_unreachable', 502);
}

// ---------- Lo que manda el bot ----------

/** El trabajo cuyo token trae el bot; null si no coincide o ya terminó. */
export async function authBot(req: Request, callId: string): Promise<CallRow | null> {
  const auth = req.headers.get('authorization') ?? '';
  const m = /^Bearer ([A-Za-z0-9_-]{20,128})$/.exec(auth);
  if (!m) return null;
  const row = await getCallById(callId);
  if (!row?.bot_token_hash) return null;
  const a = Buffer.from(hashToken(m[1]), 'hex');
  const b = Buffer.from(row.bot_token_hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b) ? row : null;
}

export type BotEventType = 'joining' | 'waiting_room' | 'in_call' | 'recording' | 'participants' | 'left' | 'failed';

const FAIL_REASONS = new Set(['lobby_timeout', 'denied', 'invalid_meeting', 'join_error', 'record_error', 'upload_error', 'consent_not_sent']);
const LEFT_REASONS = new Set(['meeting_ended', 'alone', 'max_duration', 'stopped', 'removed']);

export async function handleBotEvent(
  row: CallRow,
  ev: { type: BotEventType; at?: string; detail?: { reason?: string }; participants?: Array<{ name: string }> },
): Promise<void> {
  const at = ev.at && !Number.isNaN(Date.parse(ev.at)) ? new Date(ev.at).toISOString() : nowIso();
  const ts = nowIso();
  if (ev.participants) {
    const list = ev.participants.map((p) => ({ name: String(p.name ?? '').slice(0, 120) })).filter((p) => p.name).slice(0, 100);
    await db().prepare('UPDATE calls SET participants = ? WHERE id = ?').run(JSON.stringify(list), row.id);
  }
  const live = "status IN ('queued', 'joining', 'waiting', 'recording')";
  switch (ev.type) {
    case 'participants':
      return;
    case 'joining':
      await db().prepare(`UPDATE calls SET status = 'joining', updated_at = ? WHERE id = ? AND ${live}`).run(ts, row.id);
      return;
    case 'waiting_room':
      await db().prepare(`UPDATE calls SET status = 'waiting', updated_at = ? WHERE id = ? AND ${live}`).run(ts, row.id);
      return;
    case 'in_call':
      await db().prepare(`UPDATE calls SET status = 'recording', updated_at = ? WHERE id = ? AND ${live}`).run(ts, row.id);
      return;
    case 'recording':
      await db().prepare(`UPDATE calls SET status = 'recording', started_at = ?, updated_at = ? WHERE id = ? AND ${live}`).run(at, ts, row.id);
      return;
    case 'left': {
      const reason = LEFT_REASONS.has(ev.detail?.reason ?? '') ? ev.detail!.reason! : 'meeting_ended';
      // Sin grabar todavía (se detuvo en la sala de espera): no va a llegar nada, queda cancelada.
      await db()
        .prepare(
          `UPDATE calls SET status = CASE WHEN started_at IS NULL THEN 'cancelled' ELSE 'uploading' END, ended_at = ?, end_reason = ?,
             bot_token_hash = CASE WHEN started_at IS NULL THEN NULL ELSE bot_token_hash END, updated_at = ? WHERE id = ? AND ${live}`,
        )
        .run(at, reason, ts, row.id);
      return;
    }
    case 'failed': {
      const reason = FAIL_REASONS.has(ev.detail?.reason ?? '') ? ev.detail!.reason! : 'join_error';
      await failCall(row.id, reason);
      return;
    }
  }
}

export async function storeBotPart(row: CallRow, kind: 'video' | 'audio', n: number, bytes: Buffer, mime: string, startMs: number): Promise<void> {
  if (!['joining', 'waiting', 'recording', 'uploading'].includes(row.status)) throw new CallsError('not_recording', 409);
  const safeMime = /^(video|audio)\/[a-z0-9.+-]{1,40}$/i.test(mime) ? mime.toLowerCase() : kind === 'video' ? 'video/mp4' : 'audio/ogg';
  await storeCallPart(row.id, kind, n, bytes, safeMime, startMs);
}

export interface BotComplete {
  endReason?: string;
  durationMs: number;
  video: { parts: number; bytes: number; mime: string } | null;
  audio: { segments: number; mime: string } | null;
  speakers?: TimelineEntry[];
  captions?: Caption[];
  participants?: Array<{ name: string }>;
}

/**
 * Fin de la grabación: se guardan los datos del bot, se invalida su token y la
 * llamada pasa a 'processing' (la transcribe y analiza el cron o el after()).
 */
export async function completeBotJob(row: CallRow, c: BotComplete): Promise<void> {
  const parts = (await db().prepare('SELECT kind, n, size FROM calls_parts WHERE call_id = ?').all(row.id)) as Array<{ kind: string; n: number; size: number }>;
  const video = parts.filter((p) => p.kind === 'video');
  const audio = parts.filter((p) => p.kind === 'audio');
  let videoOk = Boolean(c.video && c.video.parts > 0 && c.video.parts <= MAX_VIDEO_PARTS);
  if (videoOk) {
    const total = video.reduce((s, p) => s + Number(p.size), 0);
    // Todas las partes, de 4 MB salvo la última, y el tamaño que dice el bot.
    const complete = video.length === c.video!.parts && total === c.video!.bytes && video.every((p) => Number(p.n) === video.length - 1 || Number(p.size) === PART_BYTES);
    if (!complete) videoOk = false;
  }
  if (!videoOk && !audio.length) {
    await failCall(row.id, 'upload_incomplete');
    return;
  }
  const clampTimeline = (c.speakers ?? [])
    .slice(0, 20_000)
    .map((s) => ({ name: String(s.name ?? '').slice(0, 120), startMs: Number(s.startMs) || 0, endMs: Number(s.endMs) || 0 }))
    .filter((s) => s.name && s.endMs >= s.startMs);
  const captions = (c.captions ?? [])
    .slice(0, 20_000)
    .map((x) => ({ speaker: String(x.speaker ?? '').slice(0, 120), text: String(x.text ?? '').slice(0, 2000), startMs: Number(x.startMs) || 0 }))
    .filter((x) => x.text);
  const participants = (c.participants ?? []).map((p) => ({ name: String(p.name ?? '').slice(0, 120) })).filter((p) => p.name).slice(0, 100);
  const ts = nowIso();
  await db()
    .prepare(
      `UPDATE calls SET status = 'processing', bot_token_hash = NULL, duration_ms = ?, end_reason = COALESCE(end_reason, ?), ended_at = COALESCE(ended_at, ?),
         started_at = COALESCE(started_at, ?), video_mime = ?, video_bytes = ?, video_parts = ?, audio_mime = ?, audio_segments = ?,
         speaker_timeline = ?, captions = ?, participants = CASE WHEN ? = '[]' THEN participants ELSE ? END, updated_at = ?
       WHERE id = ? AND status IN ('queued', 'joining', 'waiting', 'recording', 'uploading')`,
    )
    .run(
      Math.max(0, Math.round(Number(c.durationMs) || 0)),
      (c.endReason ?? 'meeting_ended').slice(0, 30),
      ts,
      ts,
      videoOk ? (c.video!.mime || 'video/mp4').slice(0, 60) : null,
      videoOk ? c.video!.bytes : 0,
      videoOk ? c.video!.parts : 0,
      audio.length ? (c.audio?.mime || 'audio/ogg').slice(0, 60) : null,
      Math.min(MAX_AUDIO_SEGMENTS, audio.length),
      JSON.stringify(clampTimeline),
      JSON.stringify(captions),
      JSON.stringify(participants),
      JSON.stringify(participants),
      ts,
      row.id,
    );
  if (!videoOk && video.length) {
    // Partes de un video que no llegó entero: no sirven y ocupan lugar.
    const refs = (await db().prepare("SELECT ref FROM calls_parts WHERE call_id = ? AND kind = 'video'").all(row.id)) as Array<{ ref: string }>;
    await db().prepare("DELETE FROM calls_parts WHERE call_id = ? AND kind = 'video'").run(row.id);
    const { deleteCallFiles } = await import('./files');
    await deleteCallFiles(refs.map((r) => r.ref)).catch(() => undefined);
  }
}

/** Mensajes de error que la UI traduce (calls.errors.<código>). */
export const BOT_ERRORS = ['bot_not_configured', 'bot_unreachable', 'bot_busy', 'bot_rejected', 'lobby_timeout', 'denied', 'invalid_meeting', 'join_error', 'record_error', 'upload_error', 'upload_incomplete', 'bot_lost'] as const;
