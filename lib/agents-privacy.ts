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
 * Bloqueos: países (header x-vercel-ip-country) en la página pública,
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
// Teléfonos: +54 9 11 5555-5555, (011) 4555-5555, 555-123-4567 (de 8 a 15 dígitos).
const PHONE_RE = /\+?\(?\d[\d\s().-]{6,20}\d/g;
// Documentos con etiqueta: DNI 30.123.456, CPF 123.456.789-09, SSN 123-45-6789, CUIT 20-12345678-9.
const ID_RE = /\b(dni|cpf|cnpj|cuit|cuil|rut|curp|rfc|ssn|passport|pasaporte|passaporte)\s*[:#]?\s*[A-Za-z0-9./-]{5,20}/gi;

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

/** Tapa datos personales en un texto. Pura (exportada para tests). */
export function redactPii(text: string): string {
  if (!text) return text;
  return text
    .replace(EMAIL_RE, '[email]')
    .replace(ID_RE, (_m, label: string) => `${label} [id]`)
    .replace(CARD_RE, (m) => {
      const digits = m.replace(/\D/g, '');
      return digits.length >= 13 && digits.length <= 19 && luhn(digits) ? '[card]' : m;
    })
    .replace(PHONE_RE, (m) => {
      const digits = m.replace(/\D/g, '').length;
      if (digits < 8 || digits > 15) return m;
      // Fechas (2026-10-27, 27/10/2026 14:30) no son teléfonos.
      if (/\d{4}-\d{2}-\d{2}|\d{1,2}[/.]\d{1,2}[/.]\d{2,4}/.test(m)) return m;
      // Muchos dígitos seguidos sin separadores ni "+" suele ser un número de pedido, no un teléfono.
      if (!/[+\s().-]/.test(m) && digits > 11) return m;
      return '[phone]';
    });
}

/** Igual que redactPii pero sobre un JSON guardado (inputs y outputs de herramientas). */
function redactJson(raw: string | null): string | null {
  if (raw == null) return raw;
  return redactPii(raw);
}

/** Tapa los datos personales de una conversación (mensajes, herramientas, identidad, preguntas). */
export async function redactConversation(conv: Pick<AgentConversationRow, 'id' | 'title' | 'chat_conversation_id'>): Promise<void> {
  const db = getDb();
  const messages = (await db.prepare('SELECT id, content FROM agent_messages WHERE conversation_id = ?').all(conv.id)) as Array<{ id: string; content: string }>;
  for (const m of messages) {
    const next = redactPii(m.content);
    if (next !== m.content) await db.prepare('UPDATE agent_messages SET content = ? WHERE id = ?').run(next, m.id);
  }
  const calls = (await db.prepare('SELECT id, input, output FROM agent_tool_calls WHERE conversation_id = ?').all(conv.id)) as Array<{
    id: string;
    input: string;
    output: string | null;
  }>;
  for (const c of calls) {
    const input = redactJson(c.input) ?? c.input;
    const output = redactJson(c.output);
    if (input !== c.input || output !== c.output) await db.prepare('UPDATE agent_tool_calls SET input = ?, output = ? WHERE id = ?').run(input, output, c.id);
  }
  const runs = (await db.prepare('SELECT id, question FROM agent_runs WHERE conversation_id = ? AND question IS NOT NULL').all(conv.id)) as Array<{ id: string; question: string }>;
  for (const r of runs) {
    const next = redactPii(r.question);
    if (next !== r.question) await db.prepare('UPDATE agent_runs SET question = ? WHERE id = ?').run(next, r.id);
  }
  // Chat: los mensajes del hilo del inbox que ya tienen más de una hora.
  if (conv.chat_conversation_id) {
    const cutoff = new Date(Date.now() - PII_IDLE_MS).toISOString();
    const rows = (await db
      .prepare("SELECT id, body FROM chat_messages WHERE conversation_id = ? AND sender_type IN ('visitor', 'bot') AND datetime(created_at) < datetime(?)")
      .all(conv.chat_conversation_id, cutoff)) as Array<{ id: string; body: string }>;
    for (const m of rows) {
      const next = redactPii(m.body ?? '');
      if (next !== m.body) await db.prepare('UPDATE chat_messages SET body = ? WHERE id = ?').run(next, m.id);
    }
  }
  await db
    .prepare("UPDATE agent_conversations SET title = ?, visitor_email = CASE WHEN visitor_email IS NULL THEN NULL ELSE '[email]' END, visitor_name = NULL WHERE id = ?")
    .run(redactPii(conv.title), conv.id);
}

/**
 * Cron: conversaciones de agentes con redacción activa, inactivas hace más de
 * una hora y sin redactar. Claim por fila; devuelve cuántas tapó.
 */
export async function redactIdleConversations(opts: { now?: Date; limit?: number } = {}): Promise<number> {
  const now = opts.now ?? new Date();
  const cutoff = new Date(now.getTime() - PII_IDLE_MS).toISOString();
  const db = getDb();
  const rows = (await db
    .prepare(
      `SELECT c.id, c.title, c.chat_conversation_id, a.settings FROM agent_conversations c JOIN agents a ON a.id = c.agent_id
       WHERE c.redacted_at IS NULL AND c.updated_at < ? AND c.channel != 'playground' AND a.settings LIKE '%"redactPii":true%'
       ORDER BY c.updated_at ASC LIMIT ?`,
    )
    .all(cutoff, Math.min(Math.max(opts.limit ?? 50, 1), 500))) as Array<Pick<AgentConversationRow, 'id' | 'title' | 'chat_conversation_id'> & { settings: string }>;
  let done = 0;
  for (const r of rows) {
    if (!parseSettings(r.settings).redactPii) continue;
    const claimed = await db.prepare('UPDATE agent_conversations SET redacted_at = ? WHERE id = ? AND redacted_at IS NULL').run(now.toISOString(), r.id);
    if (!claimed.changes) continue;
    await redactConversation(r);
    done++;
  }
  return done;
}

// ---------- Bloqueos ----------

export function hashValue(value: string): string {
  return createHash('sha256').update(`agents-block:${value}`).digest('hex').slice(0, 40);
}

export function requestCountry(req: Request): string | null {
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
  const label = (conv.title || '').slice(0, 80);
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
