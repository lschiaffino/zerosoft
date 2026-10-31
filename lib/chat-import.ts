/**
 * Chat — importar conversaciones desde Intercom o Crisp, con el JSON de sus
 * APIs públicas (Intercom: GET /conversations/{id}; Crisp: conversación con
 * sus mensajes). El parser es puro; lo importado no dispara reglas, bot ni
 * webhooks. Importar el mismo archivo dos veces no duplica (external_id).
 */
import { getDb } from './db';

export interface ImportedMessage {
  sender: 'visitor' | 'user';
  body: string;
  at: string;
}

export interface ImportedConversation {
  externalId: string;
  source: 'intercom' | 'crisp';
  email: string | null;
  name: string | null;
  subject: string | null;
  open: boolean;
  createdAt: string;
  messages: ImportedMessage[];
}

const asObj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const asStr = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Timestamp en segundos o milisegundos → ISO. */
function iso(v: unknown): string {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return new Date().toISOString();
  return new Date(n < 1e12 ? n * 1000 : n).toISOString();
}

/** Intercom manda HTML en los cuerpos. */
export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

function parseIntercom(raw: Record<string, unknown>): ImportedConversation | null {
  const id = asStr(raw.id) ?? (raw.id != null ? String(raw.id) : null);
  if (!id) return null;
  const source = asObj(raw.source);
  const author = asObj(source.author);
  const messages: ImportedMessage[] = [];
  const first = asStr(source.body);
  const senderOf = (type: unknown): 'visitor' | 'user' => (type === 'user' || type === 'lead' || type === 'contact' ? 'visitor' : 'user');
  if (first) messages.push({ sender: senderOf(author.type), body: stripHtml(first), at: iso(raw.created_at) });
  const parts = asObj(raw.conversation_parts).conversation_parts;
  for (const part of Array.isArray(parts) ? parts : []) {
    const p = asObj(part);
    const body = asStr(p.body);
    // Asignaciones y cambios de estado vienen como partes sin cuerpo; las notas no pasan.
    if (!body || p.part_type === 'note') continue;
    messages.push({ sender: senderOf(asObj(p.author).type), body: stripHtml(body), at: iso(p.created_at) });
  }
  const contact = asObj(Array.isArray(asObj(raw.contacts).contacts) ? (asObj(raw.contacts).contacts as unknown[])[0] : undefined);
  const visitorAuthor = senderOf(author.type) === 'visitor' ? author : contact;
  return {
    externalId: `intercom:${id}`,
    source: 'intercom',
    email: asStr(visitorAuthor.email) ?? asStr(contact.email),
    name: asStr(visitorAuthor.name) ?? asStr(contact.name),
    subject: asStr(source.subject) ? stripHtml(asStr(source.subject)!) : asStr(raw.title),
    open: raw.state === 'open' || raw.open === true,
    createdAt: iso(raw.created_at),
    messages: messages.filter((m) => m.body),
  };
}

function parseCrisp(raw: Record<string, unknown>): ImportedConversation | null {
  const id = asStr(raw.session_id);
  if (!id) return null;
  const meta = asObj(raw.meta);
  const messages: ImportedMessage[] = [];
  for (const m of Array.isArray(raw.messages) ? raw.messages : []) {
    const x = asObj(m);
    if (x.type !== 'text' && x.type !== undefined) continue;
    const body = asStr(x.content);
    if (!body) continue;
    messages.push({ sender: x.from === 'user' ? 'visitor' : 'user', body, at: iso(x.timestamp) });
  }
  return {
    externalId: `crisp:${id}`,
    source: 'crisp',
    email: asStr(meta.email),
    name: asStr(meta.nickname),
    subject: asStr(meta.subject),
    open: raw.state === 'pending' || raw.state === 'unresolved',
    createdAt: iso(raw.created_at),
    messages,
  };
}

/** Acepta un array, { conversations: [...] }, { data: [...] } o una sola conversación. */
export function parseImport(raw: unknown): ImportedConversation[] {
  const o = asObj(raw);
  const list: unknown[] = Array.isArray(raw) ? raw : Array.isArray(o.conversations) ? o.conversations : Array.isArray(o.data) ? o.data : [raw];
  const out: ImportedConversation[] = [];
  for (const item of list) {
    const x = asObj(item);
    const parsed = x.session_id ? parseCrisp(x) : x.id != null && (x.source || x.conversation_parts) ? parseIntercom(x) : null;
    if (parsed && parsed.messages.length > 0) out.push(parsed);
  }
  return out;
}

export const IMPORT_MAX_CONVERSATIONS = 2000;

/** Guarda en el widget. Devuelve cuántas entraron y cuántas ya estaban. */
export async function importConversations(widgetId: string, conversations: ImportedConversation[]): Promise<{ imported: number; skipped: number; messages: number }> {
  const db = getDb();
  let imported = 0;
  let skipped = 0;
  let messages = 0;
  for (const c of conversations.slice(0, IMPORT_MAX_CONVERSATIONS)) {
    // El visitante importado usa una clave reservada: nadie la puede usar desde el widget.
    const key = `mail.import.${c.externalId}`;
    const exists = await db.prepare('SELECT id FROM chat_visitors WHERE widget_id = ? AND external_id = ?').get(widgetId, key);
    if (exists) {
      skipped += 1;
      continue;
    }
    const visitorId = crypto.randomUUID();
    const conversationId = crypto.randomUUID();
    const last = c.messages[c.messages.length - 1]?.at ?? c.createdAt;
    await db
      .prepare('INSERT INTO chat_visitors (id, widget_id, external_id, email, name, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(visitorId, widgetId, key, c.email?.toLowerCase() ?? null, c.name, c.createdAt);
    await db
      .prepare('INSERT INTO chat_conversations (id, widget_id, visitor_id, status, subject, resolved_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(conversationId, widgetId, visitorId, c.open ? 'open' : 'resolved', c.subject, c.open ? null : last, c.createdAt, last);
    for (const m of c.messages) {
      await db
        .prepare('INSERT INTO chat_messages (id, conversation_id, sender_type, body, read_at, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(crypto.randomUUID(), conversationId, m.sender, m.body.slice(0, 20000), m.at, m.at);
      messages += 1;
    }
    await db.prepare('INSERT OR IGNORE INTO chat_conversation_tags (conversation_id, tag) VALUES (?, ?)').run(conversationId, `import-${c.source}`);
    imported += 1;
  }
  return { imported, skipped, messages };
}
