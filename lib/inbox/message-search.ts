/**
 * Inbox: búsqueda en el texto de los mensajes (índice FTS5 inbox_messages_fts,
 * migración 296). Busca en el texto (también las transcripciones de audios
 * importadas), el asunto, el nombre del archivo y quien escribió, siempre
 * dentro de los mensajes de la persona. Filtros como en Gmail y WhatsApp:
 * from:ana, from:me, in:"Familia", has:media|image|video|audio|document|link,
 * before:2026-01-31, after:2025-12-01 y "frases exactas". Server-only.
 */
import { getDb } from '../db';
import { InboxError, type InboxChannel } from './types';

export const HIT_START = '\u0002';
export const HIT_END = '\u0003';

export interface ParsedQuery {
  /** Palabras sueltas (se buscan como prefijo: "contra" encuentra "contrato"). */
  terms: string[];
  /** Frases entre comillas. */
  phrases: string[];
  from?: string;
  in?: string;
  has?: 'media' | 'image' | 'video' | 'audio' | 'document' | 'link';
  before?: string;
  after?: string;
}

const HAS = new Set(['media', 'image', 'video', 'audio', 'document', 'link', 'file', 'photo', 'voice', 'doc']);
const HAS_ALIAS: Record<string, ParsedQuery['has']> = { file: 'media', photo: 'image', voice: 'audio', doc: 'document' };

function isoDay(raw: string, end = false): string | undefined {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(raw);
  if (!m) return undefined;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + (end ? 1 : 0)));
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/** Separa los filtros (clave:valor, con comillas si tiene espacios) del texto. */
export function parseSearch(raw: string): ParsedQuery {
  const out: ParsedQuery = { terms: [], phrases: [] };
  const re = /(\w+):"([^"]*)"|(\w+):(\S+)|"([^"]+)"|(\S+)/g;
  let m: RegExpExecArray | null;
  const q = raw.slice(0, 300);
  while ((m = re.exec(q))) {
    const key = (m[1] ?? m[3] ?? '').toLowerCase();
    const val = (m[2] ?? m[4] ?? '').trim();
    if (key) {
      if (key === 'from' && val) out.from = val;
      else if ((key === 'in' || key === 'chat') && val) out.in = val;
      else if (key === 'has' && HAS.has(val.toLowerCase())) out.has = HAS_ALIAS[val.toLowerCase()] ?? (val.toLowerCase() as ParsedQuery['has']);
      else if (key === 'before') out.before = isoDay(val);
      else if (key === 'after') out.after = isoDay(val);
      else out.terms.push(...words(`${key} ${val}`));
      continue;
    }
    if (m[5]) {
      const p = words(m[5]).join(' ');
      if (p) out.phrases.push(p);
    } else if (m[6]) out.terms.push(...words(m[6]));
  }
  return out;
}

/** Palabras como las ve el índice (letras y números), sin signos que FTS5 trate como sintaxis. */
function words(s: string): string[] {
  return s
    .split(/[^\p{L}\p{N}]+/u)
    .map((w) => w.trim())
    .filter(Boolean)
    .slice(0, 12);
}

/** Expresión MATCH de FTS5: todas las palabras (la última y cada una como prefijo) y las frases exactas. */
export function ftsExpression(p: ParsedQuery): string {
  const parts = [...p.phrases.map((ph) => `"${ph.replace(/"/g, '""')}"`), ...p.terms.map((t) => `"${t.replace(/"/g, '""')}"*`)];
  return parts.join(' AND ');
}

export interface MessageHit {
  id: string;
  threadId: string;
  threadTitle: string;
  channel: InboxChannel;
  kind: string;
  fromMe: boolean;
  senderName: string;
  sentAt: string;
  mediaType: string;
  mediaName: string;
  /** Texto alrededor de lo encontrado, con lo encontrado entre HIT_START y HIT_END. */
  snippet: string;
}

let ftsReady: boolean | null = null;

async function hasFts(): Promise<boolean> {
  if (ftsReady !== null) return ftsReady;
  try {
    await getDb().prepare("SELECT rowid FROM inbox_messages_fts WHERE inbox_messages_fts MATCH '\"x\"' LIMIT 1").all();
    ftsReady = true;
  } catch {
    ftsReady = false;
  }
  return ftsReady;
}

function like(s: string): string {
  return `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Recorta un texto alrededor de la primera palabra encontrada y la marca (búsqueda sin FTS5). */
export function markSnippet(text: string, needles: string[], width = 70): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const low = fold(clean);
  let at = -1;
  let len = 0;
  for (const n of needles) {
    const i = low.indexOf(fold(n));
    if (i >= 0 && (at < 0 || i < at)) {
      at = i;
      len = n.length;
    }
  }
  if (at < 0) return clean.slice(0, width * 2);
  const start = Math.max(0, at - width);
  const end = Math.min(clean.length, at + len + width);
  return `${start > 0 ? '…' : ''}${clean.slice(start, at)}${HIT_START}${clean.slice(at, at + len)}${HIT_END}${clean.slice(at + len, end)}${end < clean.length ? '…' : ''}`;
}

/**
 * Mensajes que coinciden, del más nuevo al más viejo. `before` pagina (fecha
 * del último resultado de la página anterior).
 */
export async function searchMessages(owner: string, raw: string, opts: { limit?: number; before?: string } = {}): Promise<{ hits: MessageHit[]; more: boolean }> {
  const p = parseSearch(raw);
  const limit = Math.min(Math.max(opts.limit ?? 30, 1), 100);
  const text = p.terms.length > 0 || p.phrases.length > 0;
  if (!text && !p.from && !p.in && !p.has && !p.before && !p.after) return { hits: [], more: false };
  const where: string[] = ['m.owner_id = ?', 'm.hidden_at IS NULL'];
  const args: Array<string | number> = [owner];
  if (p.from) {
    if (/^(me|yo|eu)$/i.test(p.from)) where.push('m.from_me = 1');
    else {
      where.push("m.from_me = 0 AND (m.sender_name LIKE ? ESCAPE '\\' OR m.sender_handle LIKE ? ESCAPE '\\' OR (t.kind <> 'group' AND (t.title LIKE ? ESCAPE '\\' OR t.handle LIKE ? ESCAPE '\\')))");
      const l = like(p.from);
      args.push(l, l, l, l);
    }
  }
  if (p.in) {
    where.push("(t.title LIKE ? ESCAPE '\\' OR t.handle LIKE ? ESCAPE '\\')");
    args.push(like(p.in), like(p.in));
  }
  if (p.has === 'media') where.push("m.media_type <> ''");
  else if (p.has === 'link') where.push("(m.body LIKE '%http://%' OR m.body LIKE '%https://%' OR m.body LIKE '%www.%')");
  else if (p.has) {
    where.push('m.media_type = ?');
    args.push(p.has);
  }
  if (p.before) {
    where.push('m.sent_at < ?');
    args.push(p.before);
  }
  if (p.after) {
    where.push('m.sent_at >= ?');
    args.push(p.after);
  }
  const page = opts.before && !Number.isNaN(Date.parse(opts.before)) ? new Date(opts.before).toISOString() : null;
  if (page) {
    where.push('m.sent_at < ?');
    args.push(page);
  }
  const cols = 'm.id, m.thread_id, m.from_me, m.sender_name, m.sent_at, m.media_type, m.media_name, m.body, m.subject, t.title, t.handle, t.channel, t.kind, t.account_id';
  type Row = { id: string; thread_id: string; from_me: number; sender_name: string; sent_at: string; media_type: string; media_name: string; body: string; subject: string; title: string; handle: string; channel: InboxChannel; kind: string; account_id: string; snip?: string };
  let rows: Row[];
  const db = getDb();
  if (text && (await hasFts())) {
    const expr = ftsExpression(p);
    try {
      rows = (await db
        .prepare(
          `SELECT ${cols}, snippet(inbox_messages_fts, -1, '${HIT_START}', '${HIT_END}', '…', 16) AS snip
           FROM inbox_messages_fts f JOIN inbox_messages m ON m.rowid = f.rowid JOIN inbox_threads t ON t.id = m.thread_id
           WHERE inbox_messages_fts MATCH ? AND ${where.join(' AND ')} ORDER BY m.sent_at DESC LIMIT ?`,
        )
        .all(expr, ...args, limit + 1)) as Row[];
    } catch {
      throw new InboxError('invalid_search', 400);
    }
  } else {
    if (text) {
      for (const w of [...p.phrases, ...p.terms]) {
        where.push("(m.body LIKE ? ESCAPE '\\' OR m.subject LIKE ? ESCAPE '\\' OR m.media_name LIKE ? ESCAPE '\\')");
        args.push(like(w), like(w), like(w));
      }
    }
    rows = (await db
      .prepare(`SELECT ${cols} FROM inbox_messages m JOIN inbox_threads t ON t.id = m.thread_id WHERE ${where.join(' AND ')} ORDER BY m.sent_at DESC LIMIT ?`)
      .all(...args, limit + 1)) as Row[];
  }
  const needles = [...p.phrases, ...p.terms];
  // Audios transcriptos desde la conversación (wa_transcripts): pocos por persona, alcanza con LIKE.
  if (text) {
    const tw = [...where];
    const ta: Array<string | number> = [...args];
    for (const w of needles) {
      tw.push("x.text LIKE ? ESCAPE '\\'");
      ta.push(like(w));
    }
    const extra = (await db
      .prepare(
        `SELECT ${cols}, x.text AS transcript FROM wa_transcripts x JOIN inbox_messages m ON m.id = x.message_id JOIN inbox_threads t ON t.id = m.thread_id
         WHERE x.scope = 'inbox' AND x.owner_id = m.owner_id AND x.status = 'done' AND ${tw.join(' AND ')} ORDER BY m.sent_at DESC LIMIT ?`,
      )
      .all(...ta, limit + 1)
      .catch(() => [])) as Array<Row & { transcript: string }>;
    if (extra.length) {
      const seen = new Set(rows.map((r) => r.id));
      for (const e of extra) if (!seen.has(e.id)) rows.push({ ...e, snip: `🎤 ${markSnippet(e.transcript, needles)}` });
      rows.sort((a, b) => b.sent_at.localeCompare(a.sent_at));
    }
  }
  const hits = rows.slice(0, limit).map((r) => ({
    id: r.id,
    threadId: r.thread_id,
    threadTitle: r.title || r.handle,
    channel: r.channel,
    kind: r.kind,
    fromMe: !!r.from_me,
    senderName: r.sender_name,
    sentAt: r.sent_at,
    mediaType: r.media_type,
    mediaName: r.media_name,
    snippet: (r.snip && r.snip.includes(HIT_START) ? r.snip : markSnippet(r.body || r.subject || r.media_name, needles)).slice(0, 400),
  }));
  // "@<dígitos>" (teléfono o lid) → "@Nombre" en los fragmentos de WhatsApp.
  const shown = rows.slice(0, limit);
  if (hits.some((h, i) => shown[i].channel === 'whatsapp' && h.snippet.includes('@'))) {
    const { resolveTextMentions } = await import('../wa-contacts');
    const texts = await resolveTextMentions(
      'inbox',
      hits.map((h, i) => ({ accountId: shown[i].channel === 'whatsapp' ? shown[i].account_id : '', text: h.snippet })),
    ).catch(() => hits.map((h) => h.snippet));
    hits.forEach((h, i) => (h.snippet = texts[i]));
  }
  return { hits, more: rows.length > limit };
}

/** Chats con mensajes que coinciden (para la lista de chats al buscar). */
export async function threadIdsMatching(owner: string, raw: string, limit = 300): Promise<string[] | null> {
  const p = parseSearch(raw);
  if (!p.terms.length && !p.phrases.length) return [];
  if (!(await hasFts())) return null;
  try {
    const rows = (await getDb()
      .prepare(
        `SELECT DISTINCT m.thread_id FROM inbox_messages_fts f JOIN inbox_messages m ON m.rowid = f.rowid
         WHERE inbox_messages_fts MATCH ? AND m.owner_id = ? AND m.hidden_at IS NULL LIMIT ?`,
      )
      .all(ftsExpression(p), owner, limit)) as Array<{ thread_id: string }>;
    return rows.map((r) => r.thread_id);
  } catch {
    return [];
  }
}
