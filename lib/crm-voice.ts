/**
 * CRM — llamadas desde el navegador (Twilio Voice). Estado en crm_calls:
 *
 * 1. La UI crea la llamada (createOutboundCall) y conecta el Voice JS SDK con
 *    el id; Twilio pide el TwiML (/api/crm/voice/twiml) y acá se valida que la
 *    identidad del cliente sea la persona que creó la llamada.
 * 2. Al cortar, el action del <Dial> (o el respaldo de la UI) cierra la
 *    llamada una sola vez (compare-and-set sobre ended_at) y registra la
 *    actividad 'call' con duración y resultado en el timeline.
 * 3. Grabación (si el workspace la activó, con aviso a la otra parte) y
 *    transcripción en tiempo real de las dos pistas llegan por webhook.
 * 4. Con la llamada cerrada y la transcripción completa, se resume con IA
 *    (lib/ai.ts, feature crm_call_summary) y el resumen va a la actividad.
 *
 * Entrantes: el número del workspace suena en los navegadores de su equipo.
 * Server-only.
 */
import { getDb, type CrmCallRow, type CrmVoiceSettingsRow } from './db';
import { dbNow } from './crm-email';
import { formatPhoneDisplay, phoneDigits } from './crm-calls';
import { voiceIdentity } from './twilio-voice';

export const TRANSCRIPT_MAX = 60_000;
export const CONSENT_MAX = 300;
export const VOICE_LANGUAGES = ['en-US', 'es-US', 'es-ES', 'es-MX', 'pt-BR'] as const;

export interface VoiceSettings {
  callerId: string;
  recordCalls: boolean;
  consentEnabled: boolean;
  consentText: string;
  transcribe: boolean;
  language: string;
  inboundEnabled: boolean;
}

const DEFAULT_SETTINGS: VoiceSettings = {
  callerId: '',
  recordCalls: false,
  consentEnabled: true,
  consentText: '',
  transcribe: true,
  language: 'en-US',
  inboundEnabled: false,
};

/** Aviso por defecto si el workspace no escribió uno (en el idioma de la llamada). */
export function defaultConsentText(language: string): string {
  const l = language.toLowerCase();
  if (l.startsWith('es')) return 'Esta llamada puede ser grabada y transcrita.';
  if (l.startsWith('pt')) return 'Esta chamada pode ser gravada e transcrita.';
  return 'This call may be recorded and transcribed.';
}

function fromRow(r: CrmVoiceSettingsRow | undefined): VoiceSettings {
  if (!r) return { ...DEFAULT_SETTINGS };
  return {
    callerId: r.caller_id,
    recordCalls: r.record_calls === 1,
    consentEnabled: r.consent_enabled === 1,
    consentText: r.consent_text,
    transcribe: r.transcribe === 1,
    language: r.language || 'en-US',
    inboundEnabled: r.inbound_enabled === 1,
  };
}

export async function getVoiceSettings(userId: string): Promise<VoiceSettings> {
  return fromRow(
    (await getDb().prepare('SELECT * FROM crm_voice_settings WHERE user_id = ?').get(userId)) as
      | CrmVoiceSettingsRow
      | undefined,
  );
}

export class VoiceError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

export async function saveVoiceSettings(userId: string, s: VoiceSettings): Promise<VoiceSettings> {
  const db = getDb();
  if (s.callerId) {
    const taken = (await db
      .prepare('SELECT user_id FROM crm_voice_settings WHERE caller_id = ? AND user_id <> ?')
      .get(s.callerId, userId)) as { user_id: string } | undefined;
    if (taken) throw new VoiceError('number_taken');
  }
  await db
    .prepare(
      `INSERT INTO crm_voice_settings
         (user_id, caller_id, record_calls, consent_enabled, consent_text, transcribe, language, inbound_enabled, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT (user_id) DO UPDATE SET caller_id = excluded.caller_id, record_calls = excluded.record_calls,
         consent_enabled = excluded.consent_enabled, consent_text = excluded.consent_text,
         transcribe = excluded.transcribe, language = excluded.language,
         inbound_enabled = excluded.inbound_enabled, updated_at = datetime('now')`,
    )
    .run(
      userId,
      s.callerId,
      s.recordCalls ? 1 : 0,
      s.consentEnabled ? 1 : 0,
      s.consentText.slice(0, CONSENT_MAX),
      s.transcribe ? 1 : 0,
      s.language,
      s.inboundEnabled ? 1 : 0,
    );
  return getVoiceSettings(userId);
}

export async function getCall(userId: string, id: string): Promise<CrmCallRow | null> {
  return ((await getDb().prepare('SELECT * FROM crm_calls WHERE id = ? AND user_id = ?').get(id, userId)) as
    | CrmCallRow
    | undefined) ?? null;
}

/** Llamada por id sin workspace: solo para webhooks ya firmados por Twilio. */
export async function getCallById(id: string): Promise<CrmCallRow | null> {
  return ((await getDb().prepare('SELECT * FROM crm_calls WHERE id = ?').get(id)) as CrmCallRow | undefined) ?? null;
}

export async function createOutboundCall(
  userId: string,
  personId: string,
  input: { to: string; from: string; contactId?: string | null; companyId?: string | null; dealId?: string | null; recorded: boolean },
): Promise<CrmCallRow> {
  const id = crypto.randomUUID();
  await getDb()
    .prepare(
      `INSERT INTO crm_calls (id, user_id, person_id, contact_id, company_id, deal_id, direction, to_number, from_number, recorded)
       VALUES (?, ?, ?, ?, ?, ?, 'outbound', ?, ?, ?)`,
    )
    .run(id, userId, personId, input.contactId ?? null, input.companyId ?? null, input.dealId ?? null, input.to, input.from, input.recorded ? 1 : 0);
  return (await getCall(userId, id))!;
}

/**
 * Twilio pidió el TwiML de una saliente: la identidad del cliente tiene que
 * ser la de quien creó la llamada (nadie marca con el id de otro). Guarda el
 * CallSid. null = rechazar.
 */
export async function bindOutboundCall(callId: string, fromIdentity: string, callSid: string): Promise<CrmCallRow | null> {
  const call = await getCallById(callId);
  if (!call || call.direction !== 'outbound' || !call.person_id) return null;
  if (fromIdentity.replace(/^client:/, '') !== voiceIdentity(call.user_id, call.person_id)) return null;
  if (call.call_sid && call.call_sid !== callSid) return null;
  await getDb()
    .prepare("UPDATE crm_calls SET call_sid = ?, status = 'ringing', updated_at = ? WHERE id = ?")
    .run(callSid, dbNow(), call.id);
  return { ...call, call_sid: callSid, status: 'ringing' };
}

/** Personas del workspace (dueño + miembros de sus teams). */
export async function workspacePersonIds(userId: string): Promise<string[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT ? AS id UNION SELECT m.user_id AS id FROM team_members m JOIN teams t ON t.id = m.team_id WHERE t.owner_id = ?`,
    )
    .all(userId, userId)) as Array<{ id: string }>;
  return [...new Set(rows.map((r) => r.id))];
}

/** Contacto del workspace con este teléfono (compara los últimos 8 dígitos). */
export async function contactByPhone(userId: string, phone: string): Promise<{ id: string; company_id: string | null } | null> {
  const digits = phoneDigits(phone).replace('+', '');
  if (digits.length < 6) return null;
  const tail = digits.slice(-8);
  const rows = (await getDb()
    .prepare("SELECT id, company_id, phone FROM crm_contacts WHERE user_id = ? AND phone LIKE ? ORDER BY created_at ASC LIMIT 20")
    .all(userId, `%${tail.slice(-4)}%`)) as Array<{ id: string; company_id: string | null; phone: string }>;
  const hit = rows.find((r) => phoneDigits(r.phone).replace('+', '').endsWith(tail));
  return hit ? { id: hit.id, company_id: hit.company_id } : null;
}

/** Entrante al número de un workspace: crea la llamada y devuelve a quién suena. */
export async function createInboundCall(
  to: string,
  from: string,
  callSid: string,
): Promise<{ call: CrmCallRow; settings: VoiceSettings; clients: string[] } | null> {
  const db = getDb();
  const row = (await db
    .prepare('SELECT * FROM crm_voice_settings WHERE caller_id = ? AND inbound_enabled = 1')
    .get(to)) as CrmVoiceSettingsRow | undefined;
  if (!row) return null;
  const userId = row.user_id;
  const existing = (await db.prepare('SELECT * FROM crm_calls WHERE call_sid = ?').get(callSid)) as CrmCallRow | undefined;
  const contact = await contactByPhone(userId, from);
  let call = existing;
  if (!call) {
    const id = crypto.randomUUID();
    await db
      .prepare(
        `INSERT INTO crm_calls (id, user_id, contact_id, company_id, call_sid, direction, to_number, from_number, status, recorded)
         VALUES (?, ?, ?, ?, ?, 'inbound', ?, ?, 'ringing', ?)`,
      )
      .run(id, userId, contact?.id ?? null, contact?.company_id ?? null, callSid, to, from, row.record_calls);
    call = (await getCall(userId, id))!;
  }
  const people = await workspacePersonIds(userId);
  return { call, settings: fromRow(row), clients: people.map((p) => voiceIdentity(userId, p)) };
}

/** Twilio CallStatus / DialCallStatus → resultado de llamada del CRM. */
export function outcomeForStatus(status: string): string {
  switch (status) {
    case 'completed':
    case 'answered':
      return 'connected';
    case 'busy':
      return 'busy';
    case 'no-answer':
    case 'canceled':
      return 'no_answer';
    case 'failed':
      return 'wrong_number';
    default:
      return '';
  }
}

/**
 * Cierra la llamada una sola vez (Twilio reintenta webhooks y la UI tiene un
 * respaldo): registra la actividad 'call' con duración y resultado.
 */
export async function finishCall(
  callId: string,
  result: { status: string; durationSec: number; answeredBy?: string | null },
  now = new Date(),
): Promise<CrmCallRow | null> {
  const db = getDb();
  const ended = dbNow(now);
  const claimed = await db
    .prepare('UPDATE crm_calls SET status = ?, duration_sec = ?, ended_at = ?, updated_at = ? WHERE id = ? AND ended_at IS NULL')
    .run(result.status, Math.max(0, Math.round(result.durationSec)), ended, ended, callId);
  const call = await getCallById(callId);
  if (!call || !claimed.changes) return call;

  // Entrante: el owner de la actividad es quien atendió (si se sabe).
  const answeredPerson = result.answeredBy ? await personForIdentity(call.user_id, result.answeredBy) : null;
  const ownerId = call.person_id ?? answeredPerson;
  if (answeredPerson && !call.person_id) {
    await db.prepare('UPDATE crm_calls SET person_id = ? WHERE id = ?').run(answeredPerson, call.id);
  }
  const { createActivity } = await import('./crm');
  const durationMin = call.duration_sec ? Math.max(1, Math.ceil(call.duration_sec / 60)) : 0;
  const activity = await createActivity(call.user_id, {
    type: 'call',
    channel: 'browser',
    direction: call.direction,
    subject: formatPhoneDisplay(call.direction === 'inbound' ? call.from_number : call.to_number),
    outcome: outcomeForStatus(result.status),
    durationMin,
    contactId: call.contact_id,
    companyId: call.company_id,
    dealId: call.deal_id,
    ownerId,
  }).catch(() => null);
  if (activity) await db.prepare('UPDATE crm_calls SET activity_id = ? WHERE id = ?').run(activity.id, call.id);
  return getCallById(callId);
}

async function personForIdentity(userId: string, identity: string): Promise<string | null> {
  const clean = identity.replace(/^client:/, '');
  for (const p of await workspacePersonIds(userId)) {
    if (voiceIdentity(userId, p) === clean) return p;
  }
  return null;
}

export async function markAnswered(callId: string, now = new Date()): Promise<void> {
  await getDb()
    .prepare("UPDATE crm_calls SET status = 'in-progress', answered_at = COALESCE(answered_at, ?), updated_at = ? WHERE id = ? AND ended_at IS NULL")
    .run(dbNow(now), dbNow(now), callId);
}

export async function saveRecording(callId: string, recordingSid: string, durationSec: number): Promise<void> {
  await getDb()
    .prepare('UPDATE crm_calls SET recording_sid = ?, recording_duration = ?, updated_at = ? WHERE id = ?')
    .run(recordingSid, Math.max(0, Math.round(durationSec)), dbNow(), callId);
}

/**
 * Pista de Twilio → quién habla. En una saliente desde el navegador la
 * llamada padre es la del cliente: inbound_track es la persona del CRM y
 * outbound_track el contacto. En una entrante es al revés.
 */
export function speakerForTrack(direction: 'outbound' | 'inbound', track: string): 'agent' | 'contact' {
  const inbound = track.startsWith('inbound');
  if (direction === 'outbound') return inbound ? 'agent' : 'contact';
  return inbound ? 'contact' : 'agent';
}

/** Evento de transcripción en tiempo real (<Start><Transcription>). */
export async function handleTranscriptionEvent(
  callId: string,
  p: Record<string, string>,
): Promise<void> {
  const db = getDb();
  const call = await getCallById(callId);
  if (!call) return;
  const event = p.TranscriptionEvent ?? '';
  if (event === 'transcription-started') {
    await db.prepare("UPDATE crm_calls SET transcript_status = 'active', updated_at = ? WHERE id = ?").run(dbNow(), callId);
    return;
  }
  if (event === 'transcription-content') {
    if (p.Final && p.Final !== 'true') return;
    let text = '';
    try {
      text = String((JSON.parse(p.TranscriptionData ?? '{}') as { transcript?: string }).transcript ?? '');
    } catch {
      text = '';
    }
    text = text.replace(/\s+/g, ' ').trim();
    if (!text) return;
    const line = `${speakerForTrack(call.direction, p.Track ?? '')}: ${text}\n`;
    await db
      .prepare(
        "UPDATE crm_calls SET transcript = substr(transcript || ?, 1, ?), transcript_status = 'active', updated_at = ? WHERE id = ?",
      )
      .run(line, TRANSCRIPT_MAX, dbNow(), callId);
    return;
  }
  if (event === 'transcription-stopped' || event === 'transcription-error') {
    await db
      .prepare('UPDATE crm_calls SET transcript_status = ?, updated_at = ? WHERE id = ?')
      .run(event === 'transcription-error' && !call.transcript ? 'failed' : 'done', dbNow(), callId);
  }
}

/** Transcript guardado → líneas { speaker, text }. */
export function parseTranscript(raw: string): Array<{ speaker: 'agent' | 'contact'; text: string }> {
  return raw
    .split('\n')
    .map((l) => /^(agent|contact): (.+)$/.exec(l.trim()))
    .filter((m): m is RegExpExecArray => Boolean(m))
    .map((m) => ({ speaker: m[1] as 'agent' | 'contact', text: m[2] }));
}

/**
 * Con la llamada cerrada y la transcripción completa, resume (una vez). Las
 * rutas lo corren con after(): el webhook de Twilio responde sin esperar a la IA.
 */
export async function summarizeIfReady(callId: string): Promise<void> {
  const call = await getCallById(callId);
  if (!call || !call.ended_at || call.transcript_status !== 'done' || !call.transcript.trim()) return;
  if (call.summary_status !== 'none') return;
  await summarizeCall(call.user_id, call.id).catch(() => null);
}

/** Resumen del modelo falso (e2e): cuántas líneas tuvo la charla (sin repetir la transcripción). */
function fakeVoiceSummary(lines: string): string {
  const n = lines.split('\n').filter(Boolean).length;
  return `Call summary: ${n} lines between the rep and the contact.`;
}

/**
 * Resumen con IA de la transcripción → crm_calls.summary y el cuerpo de la
 * actividad. Errores de IA quedan en summary_status (ai_disabled,
 * quota_exceeded, rate_limited, failed) para que la UI los muestre.
 */
export async function summarizeCall(userId: string, callId: string): Promise<CrmCallRow | null> {
  const db = getDb();
  const call = await getCall(userId, callId);
  if (!call || !call.transcript.trim()) return call;
  const claimed = await db
    .prepare("UPDATE crm_calls SET summary_status = 'running', updated_at = ? WHERE id = ? AND summary_status <> 'running'")
    .run(dbNow(), callId);
  if (!claimed.changes) return call;
  const lines = parseTranscript(call.transcript)
    .map((l) => `${l.speaker === 'agent' ? 'Rep' : 'Contact'}: ${l.text}`)
    .join('\n');
  let summary = '';
  let status = 'done';
  try {
    // crmGenerateText: mismo modelo que el resto de la IA del CRM (con CRM_AI_FAKE, el falso de e2e).
    const { crmGenerateText } = await import('./crm-ai');
    const res = await crmGenerateText({
      workspaceId: userId,
      feature: 'crm_call_summary',
      fake: () => fakeVoiceSummary(lines),
      instructions:
        'You summarize sales calls for a CRM timeline. Write in the language of the transcript. Plain text, no markdown headings. ' +
        'First one or two sentences with what the call was about, then short lines for: decisions, objections, next steps (with owner and date if said). ' +
        'Only use what is in the transcript.',
      prompt: lines.slice(0, 40_000),
      maxOutputTokens: 500,
    });
    summary = res.text.trim().slice(0, 4000);
  } catch (e) {
    const code = (e as { code?: string })?.code;
    status = code === 'ai_disabled' || code === 'quota_exceeded' || code === 'rate_limited' ? code : 'failed';
  }
  await db
    .prepare('UPDATE crm_calls SET summary = ?, summary_status = ?, updated_at = ? WHERE id = ?')
    .run(summary, status, dbNow(), callId);
  if (summary && call.activity_id) {
    const act = (await db.prepare('SELECT body FROM crm_activities WHERE id = ?').get(call.activity_id)) as
      | { body: string }
      | undefined;
    if (act) {
      const body = act.body.trim() ? `${act.body.trim()}\n\n${summary}` : summary;
      await db.prepare('UPDATE crm_activities SET body = ?, updated_at = ? WHERE id = ?').run(body.slice(0, 10_000), dbNow(), call.activity_id);
    }
  }
  return getCall(userId, callId);
}

/** Después de cortar: resultado y nota que eligió la persona → la actividad. */
export async function updateCallActivity(
  userId: string,
  callId: string,
  input: { outcome?: string; note?: string },
): Promise<boolean> {
  const call = await getCall(userId, callId);
  if (!call?.activity_id) return false;
  const db = getDb();
  if (input.outcome !== undefined) {
    await db.prepare('UPDATE crm_activities SET outcome = ?, updated_at = ? WHERE id = ? AND user_id = ?').run(input.outcome.slice(0, 60), dbNow(), call.activity_id, userId);
  }
  if (input.note?.trim()) {
    const act = (await db.prepare('SELECT body FROM crm_activities WHERE id = ?').get(call.activity_id)) as { body: string } | undefined;
    const body = act?.body.trim() ? `${input.note.trim()}\n\n${act.body.trim()}` : input.note.trim();
    await db.prepare('UPDATE crm_activities SET body = ?, updated_at = ? WHERE id = ? AND user_id = ?').run(body.slice(0, 10_000), dbNow(), call.activity_id, userId);
  }
  return true;
}

// ---------- Timeline ----------

export interface CallView {
  id: string;
  direction: 'outbound' | 'inbound';
  status: string;
  durationSec: number | null;
  hasRecording: boolean;
  transcript: Array<{ speaker: 'agent' | 'contact'; text: string }>;
  transcriptStatus: string;
  summary: string;
  summaryStatus: string;
}

export function callView(c: CrmCallRow): CallView {
  return {
    id: c.id,
    direction: c.direction,
    status: c.status,
    durationSec: c.duration_sec,
    hasRecording: Boolean(c.recording_sid),
    transcript: parseTranscript(c.transcript),
    transcriptStatus: c.transcript_status,
    summary: c.summary,
    summaryStatus: c.summary_status,
  };
}

/** Agrega la llamada (grabación, transcripción, resumen) a las actividades 'call' del timeline. */
export async function withCallDetails<T extends { id: string; type: string }>(
  userId: string,
  items: T[],
): Promise<Array<T & { voice?: CallView }>> {
  const ids = items.filter((i) => i.type === 'call').map((i) => i.id);
  if (!ids.length) return items;
  const rows = (await getDb()
    .prepare(`SELECT * FROM crm_calls WHERE user_id = ? AND activity_id IN (${ids.map(() => '?').join(',')})`)
    .all(userId, ...ids)) as CrmCallRow[];
  const byActivity = new Map(rows.map((r) => [r.activity_id!, callView(r)]));
  return items.map((i) => (byActivity.has(i.id) ? { ...i, voice: byActivity.get(i.id) } : i));
}
