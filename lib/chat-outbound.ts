/**
 * Chat — mensajes salientes en el widget (los "Chats" y "Surveys" de
 * Intercom Outbound): un mensaje proactivo o una encuesta de 1 a 5 que
 * aparece al visitante según la página (URL que contiene o es igual a), los
 * segundos en la página y la audiencia (todos, nuevos, recurrentes o
 * identificados). Cada visitante lo ve una vez. Si responde un mensaje, la
 * conversación arranca con ese mensaje del equipo. Server-only.
 *
 * La audiencia y la página las evalúa el widget (son de marketing y públicas
 * por naturaleza); el servidor solo entrega los mensajes activos del widget,
 * cuenta vistas una vez por visitante y guarda una respuesta por visitante.
 */
import { getDb } from './db';
import { ChatCollabError } from './chat-collab';

function nowIso(): string {
  return new Date().toISOString();
}

export const OUTBOUND_KINDS = ['chat', 'survey'] as const;
export const OUTBOUND_URL_MATCH = ['any', 'contains', 'equals'] as const;
export const OUTBOUND_AUDIENCES = ['all', 'new', 'returning', 'identified'] as const;
export const OUTBOUND_BODY_MAX = 1000;

export interface ChatOutboundRow {
  id: string;
  widget_id: string;
  name: string;
  kind: (typeof OUTBOUND_KINDS)[number];
  body: string;
  url_match: (typeof OUTBOUND_URL_MATCH)[number];
  url_value: string;
  delay_seconds: number;
  audience: (typeof OUTBOUND_AUDIENCES)[number];
  active: 0 | 1;
  created_by: string | null;
  shown_count: number;
  reply_count: number;
  created_at: string;
  updated_at: string;
}

export interface ChatOutbound extends ChatOutboundRow {
  /** Encuestas: respuestas y promedio. */
  responses: number;
  average: number | null;
}

export interface OutboundInput {
  name?: unknown;
  kind?: unknown;
  body?: unknown;
  urlMatch?: unknown;
  urlValue?: unknown;
  delaySeconds?: unknown;
  audience?: unknown;
  active?: unknown;
}

function pick<T extends string>(v: unknown, list: readonly T[]): T | undefined {
  return typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : undefined;
}

/** Campos válidos (los que vienen); tira ChatCollabError con lo que falla. */
export function cleanOutbound(input: OutboundInput, partial: boolean): Partial<Omit<ChatOutboundRow, 'id' | 'widget_id'>> {
  const out: Partial<Omit<ChatOutboundRow, 'id' | 'widget_id'>> = {};
  if (input.name !== undefined || !partial) {
    const name = typeof input.name === 'string' ? input.name.replace(/\s+/g, ' ').trim().slice(0, 80) : '';
    if (!name) throw new ChatCollabError('missing_name');
    out.name = name;
  }
  if (input.kind !== undefined) {
    const kind = pick(input.kind, OUTBOUND_KINDS);
    if (!kind) throw new ChatCollabError('invalid_input');
    out.kind = kind;
  }
  if (input.body !== undefined) {
    if (typeof input.body !== 'string') throw new ChatCollabError('invalid_input');
    out.body = input.body.trim().slice(0, OUTBOUND_BODY_MAX);
  }
  if (input.urlMatch !== undefined) {
    const m = pick(input.urlMatch, OUTBOUND_URL_MATCH);
    if (!m) throw new ChatCollabError('invalid_input');
    out.url_match = m;
  }
  if (input.urlValue !== undefined) {
    if (typeof input.urlValue !== 'string') throw new ChatCollabError('invalid_input');
    out.url_value = input.urlValue.trim().slice(0, 500);
  }
  if (input.delaySeconds !== undefined) {
    const n = Number(input.delaySeconds);
    if (!Number.isInteger(n) || n < 0 || n > 3600) throw new ChatCollabError('invalid_delay');
    out.delay_seconds = n;
  }
  if (input.audience !== undefined) {
    const a = pick(input.audience, OUTBOUND_AUDIENCES);
    if (!a) throw new ChatCollabError('invalid_input');
    out.audience = a;
  }
  if (input.active !== undefined) {
    if (typeof input.active !== 'boolean') throw new ChatCollabError('invalid_input');
    out.active = input.active ? 1 : 0;
  }
  return out;
}

const SELECT = `SELECT o.*,
  (SELECT COUNT(*) FROM chat_outbound_responses r WHERE r.outbound_id = o.id) AS responses,
  (SELECT AVG(score) FROM chat_outbound_responses r WHERE r.outbound_id = o.id) AS average
  FROM chat_outbound o`;

function toOutbound(r: ChatOutboundRow & { responses: number; average: number | null }): ChatOutbound {
  return { ...r, responses: Number(r.responses ?? 0), average: r.average == null ? null : Number(r.average) };
}

export async function listOutbound(widgetId: string): Promise<ChatOutbound[]> {
  const rows = (await getDb().prepare(`${SELECT} WHERE o.widget_id = ? ORDER BY o.created_at DESC`).all(widgetId)) as Array<
    ChatOutboundRow & { responses: number; average: number | null }
  >;
  return rows.map(toOutbound);
}

export async function getOutbound(id: string): Promise<ChatOutbound | null> {
  const row = (await getDb().prepare(`${SELECT} WHERE o.id = ?`).get(id)) as (ChatOutboundRow & { responses: number; average: number | null }) | undefined;
  return row ? toOutbound(row) : null;
}

export async function createOutbound(widgetId: string, userId: string, input: OutboundInput): Promise<ChatOutbound> {
  const v = cleanOutbound(input, false);
  const count = (await getDb().prepare('SELECT COUNT(*) AS c FROM chat_outbound WHERE widget_id = ?').get(widgetId)) as { c: number };
  if (Number(count.c) >= 50) throw new ChatCollabError('too_many_messages');
  const active = v.active === 1 && (v.body ?? '').length > 0 ? 1 : 0;
  const id = crypto.randomUUID();
  const now = nowIso();
  await getDb()
    .prepare(
      `INSERT INTO chat_outbound (id, widget_id, name, kind, body, url_match, url_value, delay_seconds, audience, active, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, widgetId, v.name!, v.kind ?? 'chat', v.body ?? '', v.url_match ?? 'any', v.url_value ?? '', v.delay_seconds ?? 0, v.audience ?? 'all', active, userId, now, now);
  return (await getOutbound(id))!;
}

export async function updateOutbound(id: string, input: OutboundInput): Promise<ChatOutbound | null> {
  const current = await getOutbound(id);
  if (!current) return null;
  const v = cleanOutbound(input, true);
  const body = v.body ?? current.body;
  // Activar sin texto no tiene sentido: el widget no mostraría nada.
  if ((v.active ?? current.active) === 1 && !body) throw new ChatCollabError('missing_body');
  const entries = Object.entries(v);
  if (entries.length > 0) {
    const sets = entries.map(([k]) => `${k} = ?`);
    await getDb()
      .prepare(`UPDATE chat_outbound SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`)
      .run(...entries.map(([, val]) => val as string | number), nowIso(), id);
  }
  return getOutbound(id);
}

export async function deleteOutbound(id: string): Promise<boolean> {
  return (await getDb().prepare('DELETE FROM chat_outbound WHERE id = ?').run(id)).changes > 0;
}

// ---------- Público (widget) ----------

export interface PublicOutbound {
  id: string;
  kind: ChatOutboundRow['kind'];
  body: string;
  urlMatch: ChatOutboundRow['url_match'];
  urlValue: string;
  delaySeconds: number;
  audience: ChatOutboundRow['audience'];
}

export async function listPublicOutbound(widgetId: string): Promise<PublicOutbound[]> {
  const rows = (await getDb()
    .prepare("SELECT * FROM chat_outbound WHERE widget_id = ? AND active = 1 AND body != '' ORDER BY created_at DESC LIMIT 20")
    .all(widgetId)) as ChatOutboundRow[];
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    body: r.body,
    urlMatch: r.url_match,
    urlValue: r.url_value,
    delaySeconds: Number(r.delay_seconds),
    audience: r.audience,
  }));
}

/** El mensaje activo de este widget, o null (lo que el visitante dice que vio no se cree a ciegas). */
export async function getActiveOutbound(widgetId: string, id: string): Promise<ChatOutboundRow | null> {
  const row = (await getDb()
    .prepare('SELECT * FROM chat_outbound WHERE id = ? AND widget_id = ? AND active = 1')
    .get(id, widgetId)) as ChatOutboundRow | undefined;
  return row ?? null;
}

/** Una vista por visitante (compare-and-set con la clave primaria). */
export async function recordOutboundSeen(outboundId: string, visitorKey: string): Promise<boolean> {
  const db = getDb();
  const res = await db
    .prepare('INSERT OR IGNORE INTO chat_outbound_seen (outbound_id, visitor_key, created_at) VALUES (?, ?, ?)')
    .run(outboundId, visitorKey.slice(0, 128), nowIso());
  if (res.changes > 0) await db.prepare('UPDATE chat_outbound SET shown_count = shown_count + 1 WHERE id = ?').run(outboundId);
  return res.changes > 0;
}

export async function recordOutboundReply(outboundId: string): Promise<void> {
  await getDb().prepare('UPDATE chat_outbound SET reply_count = reply_count + 1 WHERE id = ?').run(outboundId);
}

/** Respuesta a una encuesta: una por visitante (la segunda no pisa). */
export async function submitOutboundSurvey(outboundId: string, visitorKey: string, score: number, comment?: string): Promise<boolean> {
  const res = await getDb()
    .prepare(
      'INSERT OR IGNORE INTO chat_outbound_responses (id, outbound_id, visitor_key, score, comment, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(crypto.randomUUID(), outboundId, visitorKey.slice(0, 128), score, comment?.trim().slice(0, 1000) || null, nowIso());
  return res.changes > 0;
}

export async function listOutboundResponses(outboundId: string, limit = 50): Promise<Array<{ score: number; comment: string | null; created_at: string }>> {
  return (await getDb()
    .prepare('SELECT score, comment, created_at FROM chat_outbound_responses WHERE outbound_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(outboundId, limit)) as Array<{ score: number; comment: string | null; created_at: string }>;
}

/** Pura: ¿el mensaje aplica a esta página? (también la usa el widget, copiada en su script). */
export function outboundMatchesUrl(match: ChatOutboundRow['url_match'], value: string, url: string): boolean {
  if (match === 'any' || !value) return true;
  const u = url.split('#')[0].toLowerCase();
  const v = value.trim().toLowerCase();
  if (match === 'equals') return u.replace(/\/$/, '') === v.replace(/\/$/, '');
  return u.includes(v);
}
