/**
 * Agents — privacidad y bloqueos.
 *
 * Redacción de datos personales: con settings.redactPii, cuando una
 * conversación queda inactiva (una hora sin mensajes) se tapan emails,
 * teléfonos, tarjetas (con Luhn) y números de documento en sus mensajes,
 * en las llamadas a herramientas, en la identidad guardada y en las preguntas
 * de agent_runs. No se hace antes porque el agente necesita el email del
 * visitante para agendar o guardarlo en el CRM durante la charla. El cron
 * reclama cada conversación (compare-and-set sobre redacted_at).
 *
 * Bloqueos: países (header x-vercel-ip-country, solo en Vercel) en la página pública,
 * visitantes bloqueados desde Conversaciones (token del navegador o visitante
 * de Chat, como hash) y palabras de spam (lib/agents.ts las corta antes del modelo).
 * Server-only.
 */
import { createHash } from 'node:crypto';
import { getDb } from './db';
import type { AgentConversationRow, AgentRow } from './db';
import { parseSettings } from './agents-config';

export const PII_IDLE_MS = 60 * 60_000;

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// Secuencias de 13 a 19 dígitos (con espacios o guiones): candidatas a tarjeta.
const CARD_RE = /\b(?:\d[ -]?){12,18}\d\b/g;
// Candidatos a teléfono: +54 9 11 5555-5555, (011) 4555-5555, 555-123-4567.
const PHONE_RE = /\+?\(?\d[\d\s().-]{6,20}\d/g;
// Documentos con etiqueta: DNI 30.123.456, CPF 123.456.789-09, SSN 123-45-6789, CUIT 20-12345678-9.
const ID_RE = /\b(dni|cpf|cnpj|cuit|cuil|rut|curp|rfc|ssn|passport|pasaporte|passaporte)\s*[:#]?\s*[A-Za-z0-9./-]{5,20}/gi;
// Un número sin formato es teléfono solo si viene después de una de estas palabras.
const PHONE_WORD_RE = /(tel|tel[eé]fono|telefone|phone|cel|celular|m[oó]vil|mobile|whats ?app|wa|fone|ll[aá]mame|call me)\W{0,6}$/i;

function luhn(digits: string): boolean {
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

/** Datos del propio negocio (contacto de soporte en las instrucciones) que no se tapan. */
export interface PiiKeep {
  emails: Set<string>;
  phones: Set<string>;
}

const EMPTY_KEEP: PiiKeep = { emails: new Set(), phones: new Set() };

/** Emails y teléfonos que el dueño escribió en la configuración del agente. */
export function businessContacts(texts: string[]): PiiKeep {
  const keep: PiiKeep = { emails: new Set(), phones: new Set() };
  for (const t of texts) {
    for (const m of t.matchAll(EMAIL_RE)) keep.emails.add(m[0].toLowerCase());
    for (const m of t.matchAll(PHONE_RE)) {
      const d = m[0].replace(/\D/g, '');
      if (d.length >= 8) keep.phones.add(d);
    }
  }
  return keep;
}

function looksLikePhone(m: string, before: string): boolean {
  const trimmed = m.trim();
  const digits = trimmed.replace(/\D/g, '').length;
  if (digits < 8 || digits > 15) return false;
  // Fechas (2026-10-27, 27/10/2026), decimales y coordenadas (-34.603722),
  // miles (1.234.567): números, no teléfonos.
  if (/\d{4}-\d{2}-\d{2}|\d{1,2}[/.]\d{1,2}[/.]\d{2,4}/.test(trimmed)) return false;
  if (/^\d+\.\d+$/.test(trimmed) || /^\d{1,3}(\.\d{3})+$/.test(trimmed)) return false;
  // Dígitos seguidos sin "+" ni separadores (pedidos, timestamps, ids): solo con "tel:", "WhatsApp", etc.
  if (!/[+\s()-]/.test(trimmed)) return PHONE_WORD_RE.test(before.slice(-24));
  return true;
}

/** Tapa datos personales en un texto. Pura (exportada para tests). */
export function redactPii(text: string, keep: PiiKeep = EMPTY_KEEP): string {
  if (!text) return text;
  return text
    .replace(EMAIL_RE, (m) => (keep.emails.has(m.toLowerCase()) ? m : '[email]'))
    .replace(ID_RE, (_m, label: string) => `${label} [id]`)
    .replace(CARD_RE, (m) => {
      const digits = m.replace(/\D/g, '');
      return digits.length >= 13 && digits.length <= 19 && luhn(digits) ? '[card]' : m;
    })
    .replace(PHONE_RE, (m, offset: number, whole: string) => {
      if (keep.phones.has(m.replace(/\D/g, ''))) return m;
      return looksLikePhone(m, whole.slice(0, offset)) ? '[phone]' : m;
    });
}

/** Recorre un valor y tapa solo los strings (números y estructura quedan iguales). */
export function redactPiiDeep<T>(value: T, keep: PiiKeep = EMPTY_KEEP, depth = 0): T {
  if (depth > 40) return value;
  if (typeof value === 'string') return redactPii(value, keep) as T;
  if (Array.isArray(value)) return value.map((v) => redactPiiDeep(v, keep, depth + 1)) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = redactPiiDeep(v, keep, depth + 1);
    return out as T;
  }
  return value;
}

/** Un JSON guardado: se parsea y se tapan sus strings; si no es JSON, se trata como texto. */
export function redactJsonText(raw: string | null, keep: PiiKeep = EMPTY_KEEP): string | null {
  if (raw == null || raw === '') return raw;
  try {
    return JSON.stringify(redactPiiDeep(JSON.parse(raw) as unknown, keep));
  } catch {
    return redactPii(raw, keep);
  }
}

/** Datos del negocio de la configuración del agente (instrucciones, bienvenida, derivación). */
export function agentBusinessContacts(agent: Pick<AgentRow, 'instructions' | 'welcome_message' | 'handoff' | 'settings'>): PiiKeep {
  let handoff = '';
  try {
    handoff = String((JSON.parse(agent.handoff || '{}') as { message?: unknown }).message ?? '');
  } catch {
    handoff = '';
  }
  const ch = parseSettings(agent.settings).channelInstructions;
  return businessContacts([agent.instructions, agent.welcome_message, handoff, ch.chat, ch.public, ch.api]);
}

/**
 * Tapa los datos personales de una conversación: mensajes, llamadas a
 * herramientas y aprobaciones (dentro del JSON), preguntas guardadas,
 * identidad, título, puntaje, nota de revisión, memorias que salieron de ella
 * y, en Chat, los mensajes del hilo con más de una hora.
 */
export async function redactConversation(
  conv: Pick<AgentConversationRow, 'id' | 'title' | 'chat_conversation_id'> & { score?: string | null; review_note?: string },
  keep: PiiKeep = EMPTY_KEEP,
  now = new Date(),
): Promise<void> {
  const db = getDb();
  const messages = (await db.prepare('SELECT id, content FROM agent_messages WHERE conversation_id = ?').all(conv.id)) as Array<{ id: string; content: string }>;
  for (const m of messages) {
    const next = redactPii(m.content, keep);
    if (next !== m.content) await db.prepare('UPDATE agent_messages SET content = ? WHERE id = ?').run(next, m.id);
  }
  const calls = (await db.prepare('SELECT id, input, output FROM agent_tool_calls WHERE conversation_id = ?').all(conv.id)) as Array<{
    id: string;
    input: string;
    output: string | null;
  }>;
  for (const c of calls) {
    const input = redactJsonText(c.input, keep) ?? c.input;
    const output = redactJsonText(c.output, keep);
    if (input !== c.input || output !== c.output) await db.prepare('UPDATE agent_tool_calls SET input = ?, output = ? WHERE id = ?').run(input, output, c.id);
  }
  const actions = (await db.prepare('SELECT id, input, result FROM agent_pending_actions WHERE conversation_id = ?').all(conv.id)) as Array<{
    id: string;
    input: string;
    result: string | null;
  }>;
  for (const a of actions) {
    const input = redactJsonText(a.input, keep) ?? a.input;
    const result = redactJsonText(a.result, keep);
    if (input !== a.input || result !== a.result) await db.prepare('UPDATE agent_pending_actions SET input = ?, result = ? WHERE id = ?').run(input, result, a.id);
  }
  const runs = (await db.prepare('SELECT id, question FROM agent_runs WHERE conversation_id = ? AND question IS NOT NULL').all(conv.id)) as Array<{ id: string; question: string }>;
  for (const r of runs) {
    const next = redactPii(r.question, keep);
    if (next !== r.question) await db.prepare('UPDATE agent_runs SET question = ? WHERE id = ?').run(next, r.id);
  }
  const memories = (await db.prepare('SELECT id, fact FROM agent_memories WHERE conversation_id = ?').all(conv.id)) as Array<{ id: string; fact: string }>;
  for (const m of memories) {
    const next = redactPii(m.fact, keep);
    if (next !== m.fact) await db.prepare('UPDATE agent_memories SET fact = ? WHERE id = ?').run(next, m.id);
  }
  // Chat: los mensajes del hilo del inbox que ya tienen más de una hora.
  if (conv.chat_conversation_id) {
    const cutoff = new Date(now.getTime() - PII_IDLE_MS).toISOString();
    const rows = (await db
      .prepare("SELECT id, body FROM chat_messages WHERE conversation_id = ? AND sender_type IN ('visitor', 'bot') AND datetime(created_at) < datetime(?)")
      .all(conv.chat_conversation_id, cutoff)) as Array<{ id: string; body: string }>;
    for (const m of rows) {
      const next = redactPii(m.body ?? '', keep);
      if (next !== m.body) await db.prepare('UPDATE chat_messages SET body = ? WHERE id = ?').run(next, m.id);
    }
  }
  await db
    .prepare(
      "UPDATE agent_conversations SET title = ?, score = ?, review_note = ?, visitor_email = CASE WHEN visitor_email IS NULL THEN NULL ELSE '[email]' END, visitor_name = NULL WHERE id = ?",
    )
    .run(redactPii(conv.title, keep), redactJsonText(conv.score ?? null, keep), redactPii(conv.review_note ?? '', keep), conv.id);
}

/**
 * Cron: conversaciones de agentes con redacción activa que tienen algo nuevo
 * sin tapar: inactivas hace más de una hora y sin redactar o con mensajes
 * después de la última redacción (se retomó la charla), o, en Chat, con
 * mensajes del hilo del inbox de hace más de una hora posteriores a la última
 * redacción (después de derivar, la charla sigue con el equipo y el agente no
 * se entera). Claim por fila (compare-and-set sobre redacted_at); devuelve
 * cuántas tapó.
 */
export async function redactIdleConversations(opts: { now?: Date; limit?: number } = {}): Promise<number> {
  const now = opts.now ?? new Date();
  const cutoff = new Date(now.getTime() - PII_IDLE_MS).toISOString();
  const db = getDb();
  const rows = (await db
    .prepare(
      `SELECT c.id, c.title, c.chat_conversation_id, c.score, c.review_note, c.updated_at, c.redacted_at,
              a.settings, a.instructions, a.welcome_message, a.handoff
       FROM agent_conversations c JOIN agents a ON a.id = c.agent_id
       WHERE c.channel != 'playground' AND a.settings LIKE '%"redactPii":true%'
         AND (
           ((c.redacted_at IS NULL OR c.redacted_at < c.updated_at) AND c.updated_at < ?)
           OR (c.chat_conversation_id IS NOT NULL AND EXISTS (
             SELECT 1 FROM chat_messages m WHERE m.conversation_id = c.chat_conversation_id
               AND m.sender_type IN ('visitor', 'bot')
               AND datetime(m.created_at) < datetime(?)
               AND (c.redacted_at IS NULL OR datetime(m.created_at) > datetime(c.redacted_at))
           ))
         )
       ORDER BY c.updated_at ASC LIMIT ?`,
    )
    .all(cutoff, cutoff, Math.min(Math.max(opts.limit ?? 50, 1), 500))) as Array<
    Pick<AgentConversationRow, 'id' | 'title' | 'chat_conversation_id' | 'score' | 'updated_at' | 'redacted_at'> &
      Pick<AgentRow, 'settings' | 'instructions' | 'welcome_message' | 'handoff'> & { review_note: string }
  >;
  let done = 0;
  for (const r of rows) {
    if (!parseSettings(r.settings).redactPii) continue;
    // Claim: solo si nadie la redactó desde que la leímos. La marca es el corte
    // (hace una hora): los mensajes del inbox más nuevos se tapan en otro pase.
    const claimed = await db
      .prepare('UPDATE agent_conversations SET redacted_at = ? WHERE id = ? AND redacted_at IS ?')
      .run(cutoff, r.id, r.redacted_at ?? null);
    if (!claimed.changes) continue;
    await redactConversation(r, agentBusinessContacts(r), now);
    done++;
  }
  return done;
}

// ---------- Bloqueos ----------

export function hashValue(value: string): string {
  return createHash('sha256').update(`agents-block:${value}`).digest('hex').slice(0, 40);
}

/**
 * País del visitante. Solo se confía en el header que pone Vercel (en otro
 * hosting lo podría mandar el propio visitante): fuera de Vercel, null.
 */
export function requestCountry(req: Request): string | null {
  if (process.env.VERCEL !== '1') return null;
  const c = req.headers.get('x-vercel-ip-country')?.trim().toUpperCase();
  return c && /^[A-Z]{2}$/.test(c) ? c : null;
}

export async function isVisitorBlocked(
  agent: Pick<AgentRow, 'id' | 'settings'>,
  who: { visitorKey?: string | null; country?: string | null },
): Promise<boolean> {
  const settings = parseSettings(agent.settings);
  if (who.country && settings.blockedCountries.includes(who.country.toUpperCase())) return true;
  const hashes: Array<[string, string]> = [];
  if (who.visitorKey) hashes.push(['key', hashValue(`key:${who.visitorKey}`)]);
  for (const [kind, h] of hashes) {
    const hit = await getDb().prepare('SELECT 1 AS x FROM agent_blocked_visitors WHERE agent_id = ? AND kind = ? AND value_hash = ?').get(agent.id, kind, h);
    if (hit) return true;
  }
  return false;
}

/** Visitante de una conversación de Chat bloqueado (por el visitante de Chat). */
export async function isChatVisitorBlocked(agentId: string, chatVisitorId: string): Promise<boolean> {
  const hit = await getDb()
    .prepare("SELECT 1 AS x FROM agent_blocked_visitors WHERE agent_id = ? AND kind = 'chat' AND value_hash = ?")
    .get(agentId, hashValue(`chat:${chatVisitorId}`));
  return Boolean(hit);
}

export interface AgentBlockedVisitorDto {
  id: string;
  kind: string;
  label: string;
  createdAt: string;
}

/**
 * Bloquea al visitante de una conversación: en la página pública su token
 * (como hash); en Chat, el visitante del widget.
 */
export async function blockConversationVisitor(
  workspaceId: string,
  agentId: string,
  conv: AgentConversationRow,
  createdBy: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const db = getDb();
  const entries: Array<[string, string]> = [];
  if (conv.channel === 'public' && conv.visitor_key) entries.push(['key', hashValue(`key:${conv.visitor_key}`)]);
  if (conv.chat_conversation_id) {
    const chat = (await db.prepare('SELECT visitor_id FROM chat_conversations WHERE id = ?').get(conv.chat_conversation_id)) as { visitor_id: string } | undefined;
    if (chat) entries.push(['chat', hashValue(`chat:${chat.visitor_id}`)]);
  }
  if (entries.length === 0) return { ok: false, error: 'cannot_block' };
  // La etiqueta sale del título (primer mensaje): sin datos personales.
  const label = redactPii(conv.title || '').slice(0, 80);
  for (const [kind, h] of entries) {
    await db
      .prepare('INSERT OR IGNORE INTO agent_blocked_visitors (id, agent_id, user_id, kind, value_hash, label, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(crypto.randomUUID(), agentId, workspaceId, kind, h, label, createdBy, new Date().toISOString());
  }
  return { ok: true };
}

export async function listBlockedVisitors(workspaceId: string, agentId: string): Promise<AgentBlockedVisitorDto[]> {
  const rows = (await getDb()
    .prepare('SELECT id, kind, label, created_at FROM agent_blocked_visitors WHERE agent_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 200')
    .all(agentId, workspaceId)) as Array<{ id: string; kind: string; label: string; created_at: string }>;
  return rows.map((r) => ({ id: r.id, kind: r.kind, label: r.label, createdAt: r.created_at }));
}

export async function unblockVisitor(workspaceId: string, agentId: string, id: string): Promise<boolean> {
  const res = await getDb().prepare('DELETE FROM agent_blocked_visitors WHERE id = ? AND agent_id = ? AND user_id = ?').run(id, agentId, workspaceId);
  return res.changes > 0;
}
