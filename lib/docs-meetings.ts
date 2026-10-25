/**
 * Docs: notas de reunión con IA (como el bloque /meet de Notion). Cada bloque
 * `meeting` apunta a una fila de docs_meetings con la transcripción (por
 * trozos de audio que manda el navegador, o pegada a mano), el resumen, las
 * decisiones y las tareas, que se pueden mandar a Track (issues) o al CRM
 * (tareas). Los permisos son los de la página que tiene el bloque.
 * Server-only.
 */
import { getDb, type DocsPageRow } from './db';

/** Tope de audio por reunión (4 h). */
export const MEETING_MAX_SECONDS = 4 * 3600;
/** Tope de un trozo de audio (lo que manda el navegador cada minuto). */
export const MEETING_CHUNK_MAX_BYTES = 4 * 1024 * 1024;
export const MEETING_TRANSCRIPT_MAX = 400_000;

export type MeetingStatus = 'idle' | 'recording' | 'ready' | 'error';

export interface MeetingAction {
  text: string;
  owner: string;
  due: string;
  /** Adónde se mandó (issue de Track o tarea del CRM). */
  sent?: { kind: 'track' | 'crm'; id: string; label: string; url: string };
}

export interface MeetingDto {
  id: string;
  pageId: string;
  title: string;
  status: MeetingStatus;
  transcript: string;
  summary: string;
  decisions: string[];
  actions: MeetingAction[];
  durationSec: number;
  error: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

interface MeetingRow {
  id: string;
  workspace_id: string;
  page_id: string;
  title: string;
  status: string;
  transcript: string;
  summary: string;
  decisions: string;
  actions: string;
  duration_sec: number;
  last_error: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

function parseList<T>(raw: string): T[] {
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

function toDto(r: MeetingRow): MeetingDto {
  const status: MeetingStatus = r.status === 'recording' || r.status === 'ready' || r.status === 'error' ? r.status : 'idle';
  return {
    id: r.id,
    pageId: r.page_id,
    title: r.title,
    status,
    transcript: r.transcript,
    summary: r.summary,
    decisions: parseList<string>(r.decisions),
    actions: parseList<MeetingAction>(r.actions),
    durationSec: r.duration_sec,
    error: r.last_error,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function getMeetingRow(id: string): Promise<(MeetingRow & { page: DocsPageRow }) | null> {
  const row = (await getDb().prepare('SELECT * FROM docs_meetings WHERE id = ?').get(id)) as MeetingRow | undefined;
  if (!row) return null;
  const page = (await getDb().prepare('SELECT * FROM docs_pages WHERE id = ?').get(row.page_id)) as DocsPageRow | undefined;
  return page ? { ...row, page } : null;
}

export async function getMeeting(id: string): Promise<MeetingDto | null> {
  const row = (await getDb().prepare('SELECT * FROM docs_meetings WHERE id = ?').get(id)) as MeetingRow | undefined;
  return row ? toDto(row) : null;
}

export async function createMeeting(page: Pick<DocsPageRow, 'id' | 'user_id'>, personId: string, title: string): Promise<MeetingDto> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await getDb()
    .prepare('INSERT INTO docs_meetings (id, workspace_id, page_id, title, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, page.user_id, page.id, title.trim().slice(0, 200), personId, now, now);
  return (await getMeeting(id))!;
}

export async function updateMeeting(id: string, patch: { title?: string; transcript?: string; status?: MeetingStatus }): Promise<MeetingDto | null> {
  const sets: string[] = [];
  const args: Array<string | number> = [];
  if (patch.title !== undefined) {
    sets.push('title = ?');
    args.push(patch.title.trim().slice(0, 200));
  }
  if (patch.transcript !== undefined) {
    sets.push('transcript = ?');
    args.push(patch.transcript.slice(0, MEETING_TRANSCRIPT_MAX));
  }
  if (patch.status !== undefined) {
    sets.push('status = ?');
    args.push(patch.status);
  }
  if (sets.length) {
    sets.push('updated_at = ?');
    args.push(new Date().toISOString());
    await getDb().prepare(`UPDATE docs_meetings SET ${sets.join(', ')} WHERE id = ?`).run(...args, id);
  }
  return getMeeting(id);
}

/** Suma un trozo transcripto (atómico: dos trozos a la vez no se pisan). false si se pasa del tope de audio. */
export async function appendTranscript(id: string, text: string, seconds: number): Promise<boolean> {
  const res = await getDb()
    .prepare(
      `UPDATE docs_meetings SET
         transcript = substr(CASE WHEN transcript = '' THEN ? ELSE transcript || char(10) || ? END, 1, ?),
         duration_sec = duration_sec + ?, status = 'recording', last_error = NULL, updated_at = ?
       WHERE id = ? AND duration_sec + ? <= ?`,
    )
    .run(text, text, MEETING_TRANSCRIPT_MAX, Math.round(seconds), new Date().toISOString(), id, Math.round(seconds), MEETING_MAX_SECONDS);
  return res.changes > 0;
}

/** ¿Queda lugar para otro trozo de `seconds`? */
export async function hasAudioBudget(id: string, seconds: number): Promise<boolean> {
  const row = (await getDb().prepare('SELECT duration_sec FROM docs_meetings WHERE id = ?').get(id)) as { duration_sec: number } | undefined;
  return Boolean(row) && row!.duration_sec + seconds <= MEETING_MAX_SECONDS;
}

export async function saveNotes(id: string, notes: { summary: string; decisions: string[]; actions: Array<{ text: string; owner: string; due: string }> }): Promise<MeetingDto | null> {
  const prev = await getMeeting(id);
  // Las tareas ya mandadas conservan su vínculo si siguen en la lista.
  const sent = new Map((prev?.actions ?? []).filter((a) => a.sent).map((a) => [a.text.toLowerCase(), a.sent]));
  const actions: MeetingAction[] = notes.actions.map((a) => ({ ...a, ...(sent.get(a.text.toLowerCase()) ? { sent: sent.get(a.text.toLowerCase()) } : {}) }));
  await getDb()
    .prepare(`UPDATE docs_meetings SET summary = ?, decisions = ?, actions = ?, status = 'ready', last_error = NULL, updated_at = ? WHERE id = ?`)
    .run(notes.summary, JSON.stringify(notes.decisions), JSON.stringify(actions), new Date().toISOString(), id);
  return getMeeting(id);
}

export async function setMeetingError(id: string, code: string): Promise<void> {
  await getDb().prepare(`UPDATE docs_meetings SET last_error = ?, updated_at = ? WHERE id = ?`).run(code.slice(0, 80), new Date().toISOString(), id);
}

/** Marca tareas como mandadas (índice → destino). */
export async function markActionsSent(id: string, sent: Array<{ index: number; ref: NonNullable<MeetingAction['sent']> }>): Promise<MeetingDto | null> {
  const m = await getMeeting(id);
  if (!m) return null;
  const actions = m.actions.map((a, i) => {
    const hit = sent.find((s) => s.index === i);
    return hit ? { ...a, sent: hit.ref } : a;
  });
  await getDb().prepare('UPDATE docs_meetings SET actions = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(actions), new Date().toISOString(), id);
  return getMeeting(id);
}

/** Borra la transcripción y las notas (como "Delete transcript" en Notion); el bloque queda. */
export async function clearMeeting(id: string): Promise<MeetingDto | null> {
  await getDb()
    .prepare(`UPDATE docs_meetings SET transcript = '', summary = '', decisions = '[]', actions = '[]', duration_sec = 0, status = 'idle', last_error = NULL, updated_at = ? WHERE id = ?`)
    .run(new Date().toISOString(), id);
  return getMeeting(id);
}

/** Resumen como texto HTML-lite para el contenido del bloque (búsqueda, exportar, vista de lectura). */
export function meetingBlockContent(m: Pick<MeetingDto, 'title' | 'summary' | 'decisions' | 'actions'>): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const parts: string[] = [];
  if (m.title) parts.push(`<strong>${esc(m.title)}</strong>`);
  if (m.summary) parts.push(esc(m.summary));
  for (const d of m.decisions) parts.push(`• ${esc(d)}`);
  for (const a of m.actions) parts.push(`☐ ${esc(a.text)}${a.owner ? ` (${esc(a.owner)})` : ''}`);
  return parts.join('<br>').slice(0, 20_000);
}
