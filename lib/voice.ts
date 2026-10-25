/**
 * Voice: datos de dictados y reuniones (tablas de la migración 106_voice).
 * Server-only.
 *
 * - voice_sessions: un dictado o una reunión. Son privados de quien los
 *   grabó (workspace_id + person_id), como las notas de Granola; se
 *   comparten mandándolos a Docs o Notes.
 * - voice_chunks / voice_segments: la transcripción llega por trozos de audio
 *   (~20 s). Cada trozo se reclama con compare-and-set (INSERT OR IGNORE en
 *   voice_chunks) así un reintento del cliente no lo transcribe dos veces.
 * - voice_notes: lo que la persona escribe durante la reunión, la nota
 *   mejorada con IA y el chat sobre la reunión.
 * - voice_dictionary, voice_templates, voice_settings: diccionario personal,
 *   plantillas propias y preferencias de dictado.
 */
import { getDb } from './db';
import { likeContains } from './track-views';
import {
  countWords,
  DEFAULT_VOICE_SETTINGS,
  speakerKey,
  VOICE_CONTEXTS,
  VOICE_DICTIONARY_MAX,
  VOICE_TEMPLATES_MAX,
  VOICE_TONES,
  type VoiceChatMessage,
  type VoiceDictionaryEntry,
  type VoiceDictionaryKind,
  type VoiceEnhanced,
  type VoiceSegment,
  type VoiceSessionDetail,
  type VoiceSessionSummary,
  type VoiceSettings,
  type VoiceSource,
  type VoiceTemplate,
} from './voice-types';
import type { TranscriptPiece } from './voice-transcribe';

export interface VoiceOwner {
  workspaceId: string;
  personId: string;
}

export function voiceOwner(user: { id: string; actingUser?: { id: string } | null }): VoiceOwner {
  return { workspaceId: user.id, personId: user.actingUser?.id ?? user.id };
}

export class VoiceError extends Error {
  constructor(public code: 'not_found' | 'limit_reached' | 'duplicate' | 'invalid_state') {
    super(code);
  }
}

const nowIso = () => new Date().toISOString();

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export interface VoiceSessionRow {
  id: string;
  workspace_id: string;
  person_id: string;
  kind: 'dictation' | 'meeting';
  title: string;
  status: 'recording' | 'processing' | 'done' | 'error';
  capture: string;
  context: string;
  source_app: string;
  raw_text: string;
  text: string;
  language: string;
  duration_ms: number;
  words: number;
  template_key: string;
  speakers: string;
  cal_booking_id: string | null;
  contact_id: string | null;
  crm_activity_id: string | null;
  docs_page_id: string | null;
  note_id: string | null;
  error: string;
  started_at: string;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
}

function toSummary(r: VoiceSessionRow & { match?: string | null }): VoiceSessionSummary {
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    status: r.status,
    capture: r.capture,
    context: r.context,
    sourceApp: r.source_app,
    text: r.kind === 'dictation' ? r.text : '',
    durationMs: Number(r.duration_ms) || 0,
    words: Number(r.words) || 0,
    templateKey: r.template_key,
    calBookingId: r.cal_booking_id,
    contactId: r.contact_id,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    updatedAt: r.updated_at,
    ...(r.match ? { match: r.match } : {}),
  };
}

// ---------- Ajustes ----------

export function normalizeSettings(raw: unknown): VoiceSettings {
  const v = (raw && typeof raw === 'object' ? raw : {}) as Partial<VoiceSettings>;
  const styles = { ...DEFAULT_VOICE_SETTINGS.styles };
  if (v.styles && typeof v.styles === 'object') {
    for (const c of VOICE_CONTEXTS) {
      const tone = (v.styles as Record<string, unknown>)[c];
      if (typeof tone === 'string' && (VOICE_TONES as readonly string[]).includes(tone)) styles[c] = tone as VoiceSettings['styles'][typeof c];
    }
  }
  return {
    styles,
    language: typeof v.language === 'string' && /^(auto|[a-z]{2})$/.test(v.language) ? v.language : DEFAULT_VOICE_SETTINGS.language,
    shortcut: typeof v.shortcut === 'string' && /^[A-Za-z+ ]{3,30}$/.test(v.shortcut) ? v.shortcut : DEFAULT_VOICE_SETTINGS.shortcut,
    showBar: typeof v.showBar === 'boolean' ? v.showBar : DEFAULT_VOICE_SETTINGS.showBar,
    aiCleanup: typeof v.aiCleanup === 'boolean' ? v.aiCleanup : DEFAULT_VOICE_SETTINGS.aiCleanup,
  };
}

export async function getVoiceSettings(owner: VoiceOwner): Promise<VoiceSettings> {
  const row = (await getDb()
    .prepare('SELECT settings FROM voice_settings WHERE workspace_id = ? AND person_id = ?')
    .get(owner.workspaceId, owner.personId)) as { settings: string } | undefined;
  return normalizeSettings(parseJson(row?.settings, {}));
}

export async function saveVoiceSettings(owner: VoiceOwner, patch: Partial<VoiceSettings>): Promise<VoiceSettings> {
  const current = await getVoiceSettings(owner);
  const next = normalizeSettings({ ...current, ...patch, styles: { ...current.styles, ...(patch.styles ?? {}) } });
  await getDb()
    .prepare(
      `INSERT INTO voice_settings (workspace_id, person_id, settings, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(workspace_id, person_id) DO UPDATE SET settings = excluded.settings, updated_at = excluded.updated_at`,
    )
    .run(owner.workspaceId, owner.personId, JSON.stringify(next), nowIso());
  return next;
}

// ---------- Sesiones ----------

export interface ListSessionsOptions {
  kind?: 'dictation' | 'meeting';
  q?: string | null;
  limit?: number;
  offset?: number;
}

/** Lista propia, más nueva primero. Con `q`, busca en título, texto, notas y transcripción. */
export async function listSessions(owner: VoiceOwner, opts: ListSessionsOptions = {}): Promise<VoiceSessionSummary[]> {
  const where = ['s.workspace_id = ?', 's.person_id = ?'];
  const args: Array<string | number> = [owner.workspaceId, owner.personId];
  if (opts.kind) {
    where.push('s.kind = ?');
    args.push(opts.kind);
  }
  const q = opts.q?.trim();
  let matchSql = 'NULL';
  const matchArgs: string[] = [];
  if (q) {
    const like = likeContains(q.slice(0, 200));
    where.push(`(s.title LIKE ? ESCAPE '\\' OR s.text LIKE ? ESCAPE '\\'
      OR EXISTS (SELECT 1 FROM voice_notes n WHERE n.session_id = s.id AND n.my_notes LIKE ? ESCAPE '\\')
      OR EXISTS (SELECT 1 FROM voice_segments g WHERE g.session_id = s.id AND g.text LIKE ? ESCAPE '\\'))`);
    args.push(like, like, like, like);
    matchSql = `(SELECT g.text FROM voice_segments g WHERE g.session_id = s.id AND g.text LIKE ? ESCAPE '\\' ORDER BY g.start_ms LIMIT 1)`;
    matchArgs.push(like);
  }
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 500);
  const offset = Math.max(opts.offset ?? 0, 0);
  const rows = (await getDb()
    .prepare(
      `SELECT s.*, ${matchSql} AS match FROM voice_sessions s WHERE ${where.join(' AND ')}
       ORDER BY s.started_at DESC LIMIT ? OFFSET ?`,
    )
    .all(...matchArgs, ...args, limit, offset)) as Array<VoiceSessionRow & { match: string | null }>;
  return rows.map(toSummary);
}

export async function getSessionRow(owner: VoiceOwner, id: string): Promise<VoiceSessionRow | null> {
  const row = (await getDb()
    .prepare('SELECT * FROM voice_sessions WHERE id = ? AND workspace_id = ? AND person_id = ?')
    .get(id, owner.workspaceId, owner.personId)) as VoiceSessionRow | undefined;
  return row ?? null;
}

export async function listSegments(sessionId: string): Promise<VoiceSegment[]> {
  const rows = (await getDb()
    .prepare('SELECT * FROM voice_segments WHERE session_id = ? ORDER BY start_ms ASC, source ASC, idx ASC')
    .all(sessionId)) as Array<{ id: string; source: VoiceSource; seq: number; speaker: string; start_ms: number; end_ms: number; text: string }>;
  return rows.map((r) => ({
    id: r.id,
    source: r.source,
    seq: Number(r.seq),
    speaker: r.speaker,
    startMs: Number(r.start_ms),
    endMs: Number(r.end_ms),
    text: r.text,
  }));
}

export async function getSessionDetail(owner: VoiceOwner, id: string): Promise<VoiceSessionDetail | null> {
  const row = await getSessionRow(owner, id);
  if (!row) return null;
  const [segments, notes] = await Promise.all([
    listSegments(id),
    getDb().prepare('SELECT * FROM voice_notes WHERE session_id = ?').get(id) as Promise<
      { my_notes: string; enhanced: string | null; enhanced_at: string | null; chat: string } | undefined
    >,
  ]);
  return {
    ...toSummary(row),
    text: row.text,
    rawText: row.raw_text,
    language: row.language,
    speakers: parseJson<Record<string, string>>(row.speakers, {}),
    crmActivityId: row.crm_activity_id,
    docsPageId: row.docs_page_id,
    noteId: row.note_id,
    error: row.error,
    segments,
    myNotes: notes?.my_notes ?? '',
    enhanced: parseJson<VoiceEnhanced | null>(notes?.enhanced, null),
    enhancedAt: notes?.enhanced_at ?? null,
    chat: parseJson<VoiceChatMessage[]>(notes?.chat, []),
  };
}

export interface CreateSessionInput {
  kind: 'dictation' | 'meeting';
  title?: string;
  status?: VoiceSessionRow['status'];
  capture?: string;
  context?: string;
  sourceApp?: string;
  rawText?: string;
  text?: string;
  language?: string;
  durationMs?: number;
  templateKey?: string;
  calBookingId?: string | null;
  contactId?: string | null;
}

export async function createSession(owner: VoiceOwner, input: CreateSessionInput): Promise<VoiceSessionRow> {
  const id = crypto.randomUUID();
  const now = nowIso();
  const text = input.text ?? '';
  const done = (input.status ?? (input.kind === 'meeting' ? 'recording' : 'done')) === 'done';
  await getDb()
    .prepare(
      `INSERT INTO voice_sessions (id, workspace_id, person_id, kind, title, status, capture, context, source_app, raw_text, text,
         language, duration_ms, words, template_key, cal_booking_id, contact_id, started_at, ended_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      owner.workspaceId,
      owner.personId,
      input.kind,
      (input.title ?? '').trim().slice(0, 200),
      input.status ?? (input.kind === 'meeting' ? 'recording' : 'done'),
      input.capture ?? 'mic',
      input.context ?? '',
      (input.sourceApp ?? '').slice(0, 200),
      input.rawText ?? '',
      text,
      input.language ?? '',
      Math.max(0, Math.round(input.durationMs ?? 0)),
      countWords(text),
      input.templateKey ?? 'general',
      input.calBookingId ?? null,
      input.contactId ?? null,
      now,
      done ? now : null,
      now,
      now,
    );
  if (input.kind === 'meeting') {
    await getDb().prepare('INSERT OR IGNORE INTO voice_notes (session_id, updated_at) VALUES (?, ?)').run(id, now);
  }
  return (await getSessionRow(owner, id)) as VoiceSessionRow;
}

export interface UpdateSessionInput {
  title?: string;
  status?: VoiceSessionRow['status'];
  text?: string;
  templateKey?: string;
  calBookingId?: string | null;
  contactId?: string | null;
  crmActivityId?: string | null;
  docsPageId?: string | null;
  noteId?: string | null;
  speakers?: Record<string, string>;
  durationMs?: number;
  language?: string;
  error?: string;
}

export async function updateSession(owner: VoiceOwner, id: string, patch: UpdateSessionInput): Promise<VoiceSessionRow | null> {
  const row = await getSessionRow(owner, id);
  if (!row) return null;
  const sets: string[] = [];
  const args: Array<string | number | null> = [];
  const set = (col: string, v: string | number | null) => {
    sets.push(`${col} = ?`);
    args.push(v);
  };
  if (patch.title !== undefined) set('title', patch.title.trim().slice(0, 200));
  if (patch.status !== undefined) {
    set('status', patch.status);
    if (patch.status === 'done' && !row.ended_at) set('ended_at', nowIso());
  }
  if (patch.text !== undefined) {
    set('text', patch.text);
    set('words', countWords(patch.text));
  }
  if (patch.templateKey !== undefined) set('template_key', patch.templateKey);
  if (patch.calBookingId !== undefined) set('cal_booking_id', patch.calBookingId);
  if (patch.contactId !== undefined) set('contact_id', patch.contactId);
  if (patch.crmActivityId !== undefined) set('crm_activity_id', patch.crmActivityId);
  if (patch.docsPageId !== undefined) set('docs_page_id', patch.docsPageId);
  if (patch.noteId !== undefined) set('note_id', patch.noteId);
  if (patch.speakers !== undefined) set('speakers', JSON.stringify(patch.speakers));
  if (patch.durationMs !== undefined) set('duration_ms', Math.max(0, Math.round(patch.durationMs)));
  if (patch.language !== undefined) set('language', patch.language);
  if (patch.error !== undefined) set('error', patch.error.slice(0, 200));
  if (!sets.length) return row;
  set('updated_at', nowIso());
  await getDb()
    .prepare(`UPDATE voice_sessions SET ${sets.join(', ')} WHERE id = ? AND workspace_id = ? AND person_id = ?`)
    .run(...args, id, owner.workspaceId, owner.personId);
  return getSessionRow(owner, id);
}

export async function deleteSession(owner: VoiceOwner, id: string): Promise<boolean> {
  const res = await getDb()
    .prepare('DELETE FROM voice_sessions WHERE id = ? AND workspace_id = ? AND person_id = ?')
    .run(id, owner.workspaceId, owner.personId);
  return res.changes > 0;
}

// ---------- Trozos y transcripción ----------

/** Reclama un trozo (compare-and-set). false = ya se procesó o se está procesando. */
export async function claimChunk(sessionId: string, source: VoiceSource, seq: number): Promise<boolean> {
  const res = await getDb()
    .prepare('INSERT OR IGNORE INTO voice_chunks (session_id, source, seq, status, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(sessionId, source, seq, 'processing', nowIso());
  return res.changes > 0;
}

/** Libera un trozo que falló, para que el cliente pueda reintentarlo. */
export async function releaseChunk(sessionId: string, source: VoiceSource, seq: number): Promise<void> {
  await getDb().prepare('DELETE FROM voice_chunks WHERE session_id = ? AND source = ? AND seq = ?').run(sessionId, source, seq);
}

export async function saveChunkSegments(args: {
  sessionId: string;
  source: VoiceSource;
  seq: number;
  offsetMs: number;
  durationMs: number;
  pieces: TranscriptPiece[];
}): Promise<VoiceSegment[]> {
  const db = getDb();
  const now = nowIso();
  const out: VoiceSegment[] = [];
  let i = 0;
  for (const p of args.pieces) {
    const text = p.text.trim();
    if (!text) continue;
    const id = crypto.randomUUID();
    const seg: VoiceSegment = {
      id,
      source: args.source,
      seq: args.seq,
      speaker: p.speaker,
      startMs: args.offsetMs + p.startMs,
      endMs: args.offsetMs + Math.max(p.endMs, p.startMs),
      text: text.slice(0, 8000),
    };
    await db
      .prepare(
        'INSERT INTO voice_segments (id, session_id, source, seq, idx, speaker, start_ms, end_ms, text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(id, args.sessionId, seg.source, seg.seq, i, seg.speaker, seg.startMs, seg.endMs, seg.text, now);
    out.push(seg);
    i += 1;
  }
  await db
    .prepare("UPDATE voice_chunks SET status = 'done', duration_ms = ? WHERE session_id = ? AND source = ? AND seq = ?")
    .run(Math.round(args.durationMs), args.sessionId, args.source, args.seq);
  // La duración de la reunión es el final del último trozo recibido.
  await db
    .prepare('UPDATE voice_sessions SET duration_ms = MAX(duration_ms, ?), updated_at = ? WHERE id = ?')
    .run(Math.round(args.offsetMs + args.durationMs), now, args.sessionId);
  return out;
}

/** Transcripción como texto ("[mm:ss] Nombre: texto"), para la IA y para exportar. */
export function transcriptAsText(
  segments: VoiceSegment[],
  speakers: Record<string, string>,
  labels: { me: string; them: string; speaker?: string },
  opts: { timestamps?: boolean; max?: number } = {},
): string {
  const lines: string[] = [];
  for (const s of segments) {
    const name = speakerName(s, speakers, labels);
    const ts = opts.timestamps === false ? '' : `[${mmss(s.startMs)}] `;
    lines.push(`${ts}${name}: ${s.text}`);
  }
  const text = lines.join('\n');
  const max = opts.max ?? 120_000;
  return text.length > max ? `${text.slice(0, max / 2)}\n…\n${text.slice(-max / 2)}` : text;
}

export function speakerName(
  s: Pick<VoiceSegment, 'source' | 'speaker'>,
  speakers: Record<string, string>,
  labels: { me: string; them: string; speaker?: string },
): string {
  const key = speakerKey(s.source, s.speaker);
  if (speakers[key]) return speakers[key];
  if (s.source === 'me') return labels.me;
  // Pista mezclada (solo micrófono o archivo): "Participante N"; audio de la pestaña o del sistema: "Ellos N".
  const base = s.source === 'mixed' ? (labels.speaker ?? labels.them) : labels.them;
  return s.speaker ? `${base} ${Number(s.speaker) + 1 || s.speaker}` : base;
}

function mmss(ms: number): string {
  const t = Math.floor(ms / 1000);
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

// ---------- Notas ----------

export async function saveMyNotes(sessionId: string, text: string): Promise<void> {
  const now = nowIso();
  await getDb()
    .prepare(
      `INSERT INTO voice_notes (session_id, my_notes, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET my_notes = excluded.my_notes, updated_at = excluded.updated_at`,
    )
    .run(sessionId, text, now);
  await getDb().prepare('UPDATE voice_sessions SET updated_at = ? WHERE id = ?').run(now, sessionId);
}

export async function saveEnhanced(sessionId: string, enhanced: VoiceEnhanced): Promise<string> {
  const now = nowIso();
  await getDb()
    .prepare(
      `INSERT INTO voice_notes (session_id, enhanced, enhanced_at, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET enhanced = excluded.enhanced, enhanced_at = excluded.enhanced_at, updated_at = excluded.updated_at`,
    )
    .run(sessionId, JSON.stringify(enhanced), now, now);
  return now;
}

export async function saveChat(sessionId: string, chat: VoiceChatMessage[]): Promise<void> {
  await getDb()
    .prepare(
      `INSERT INTO voice_notes (session_id, chat, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET chat = excluded.chat, updated_at = excluded.updated_at`,
    )
    .run(sessionId, JSON.stringify(chat.slice(-60)), nowIso());
}

// ---------- Diccionario ----------

export async function listDictionary(owner: VoiceOwner): Promise<VoiceDictionaryEntry[]> {
  const rows = (await getDb()
    .prepare('SELECT id, kind, phrase, replacement FROM voice_dictionary WHERE workspace_id = ? AND person_id = ? ORDER BY kind, phrase COLLATE NOCASE')
    .all(owner.workspaceId, owner.personId)) as VoiceDictionaryEntry[];
  return rows;
}

export async function addDictionaryEntry(
  owner: VoiceOwner,
  input: { kind: VoiceDictionaryKind; phrase: string; replacement?: string },
): Promise<VoiceDictionaryEntry> {
  const db = getDb();
  const count = (await db
    .prepare('SELECT COUNT(*) AS n FROM voice_dictionary WHERE workspace_id = ? AND person_id = ?')
    .get(owner.workspaceId, owner.personId)) as { n: number };
  if (Number(count.n) >= VOICE_DICTIONARY_MAX) throw new VoiceError('limit_reached');
  const id = crypto.randomUUID();
  const phrase = input.phrase.trim().slice(0, 100);
  const replacement = input.kind === 'word' ? '' : (input.replacement ?? '').trim().slice(0, 2000);
  const res = await db
    .prepare(
      'INSERT OR IGNORE INTO voice_dictionary (id, workspace_id, person_id, kind, phrase, replacement, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(id, owner.workspaceId, owner.personId, input.kind, phrase, replacement, nowIso());
  if (!res.changes) throw new VoiceError('duplicate');
  return { id, kind: input.kind, phrase, replacement };
}

export async function deleteDictionaryEntry(owner: VoiceOwner, id: string): Promise<boolean> {
  const res = await getDb()
    .prepare('DELETE FROM voice_dictionary WHERE id = ? AND workspace_id = ? AND person_id = ?')
    .run(id, owner.workspaceId, owner.personId);
  return res.changes > 0;
}

// ---------- Plantillas propias ----------

export async function listCustomTemplates(owner: VoiceOwner): Promise<VoiceTemplate[]> {
  const rows = (await getDb()
    .prepare('SELECT id, name, instructions FROM voice_templates WHERE workspace_id = ? AND person_id = ? ORDER BY name COLLATE NOCASE')
    .all(owner.workspaceId, owner.personId)) as Array<{ id: string; name: string; instructions: string }>;
  return rows.map((r) => ({ ...r, builtin: false }));
}

export async function getCustomTemplate(owner: VoiceOwner, id: string): Promise<VoiceTemplate | null> {
  const r = (await getDb()
    .prepare('SELECT id, name, instructions FROM voice_templates WHERE id = ? AND workspace_id = ? AND person_id = ?')
    .get(id, owner.workspaceId, owner.personId)) as { id: string; name: string; instructions: string } | undefined;
  return r ? { ...r, builtin: false } : null;
}

export async function createCustomTemplate(owner: VoiceOwner, input: { name: string; instructions: string }): Promise<VoiceTemplate> {
  const db = getDb();
  const count = (await db
    .prepare('SELECT COUNT(*) AS n FROM voice_templates WHERE workspace_id = ? AND person_id = ?')
    .get(owner.workspaceId, owner.personId)) as { n: number };
  if (Number(count.n) >= VOICE_TEMPLATES_MAX) throw new VoiceError('limit_reached');
  const id = crypto.randomUUID();
  const now = nowIso();
  const name = input.name.trim().slice(0, 100);
  const instructions = input.instructions.trim().slice(0, 4000);
  await db
    .prepare('INSERT INTO voice_templates (id, workspace_id, person_id, name, instructions, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, owner.workspaceId, owner.personId, name, instructions, now, now);
  return { id, name, instructions, builtin: false };
}

export async function updateCustomTemplate(
  owner: VoiceOwner,
  id: string,
  input: { name?: string; instructions?: string },
): Promise<VoiceTemplate | null> {
  const t = await getCustomTemplate(owner, id);
  if (!t) return null;
  const name = input.name !== undefined ? input.name.trim().slice(0, 100) : t.name;
  const instructions = input.instructions !== undefined ? input.instructions.trim().slice(0, 4000) : t.instructions;
  await getDb()
    .prepare('UPDATE voice_templates SET name = ?, instructions = ?, updated_at = ? WHERE id = ? AND workspace_id = ? AND person_id = ?')
    .run(name, instructions, nowIso(), id, owner.workspaceId, owner.personId);
  return { id, name, instructions, builtin: false };
}

export async function deleteCustomTemplate(owner: VoiceOwner, id: string): Promise<boolean> {
  const res = await getDb()
    .prepare('DELETE FROM voice_templates WHERE id = ? AND workspace_id = ? AND person_id = ?')
    .run(id, owner.workspaceId, owner.personId);
  return res.changes > 0;
}

// ---------- Uso ----------

export interface DictationStats {
  dictationsWeek: number;
  wordsWeek: number;
  wordsTotal: number;
  minutesTotal: number;
}

export async function dictationStats(owner: VoiceOwner, now = new Date()): Promise<DictationStats> {
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const row = (await getDb()
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN started_at >= ? THEN 1 ELSE 0 END), 0) AS dw,
         COALESCE(SUM(CASE WHEN started_at >= ? THEN words ELSE 0 END), 0) AS ww,
         COALESCE(SUM(words), 0) AS wt,
         COALESCE(SUM(duration_ms), 0) AS ms
       FROM voice_sessions WHERE workspace_id = ? AND person_id = ? AND kind = 'dictation'`,
    )
    .get(weekAgo, weekAgo, owner.workspaceId, owner.personId)) as { dw: number; ww: number; wt: number; ms: number };
  return {
    dictationsWeek: Number(row.dw),
    wordsWeek: Number(row.ww),
    wordsTotal: Number(row.wt),
    minutesTotal: Math.round(Number(row.ms) / 60_000),
  };
}
