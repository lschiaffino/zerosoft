/**
 * Notes: email a nota. Cada persona tiene una dirección secreta
 * notes+<token>@<dominio de entrada> (el mismo dominio y webhook de Resend que
 * Chat). El asunto es el título; `@libreta` y `#etiqueta` al final lo ordenan,
 * como en Evernote. La dirección es la credencial: se puede regenerar. Cada
 * email se reclama por id para que un reintento del webhook no duplique la nota.
 * Server-only.
 */
import { randomBytes } from 'crypto';
import { getDb } from './db';
import { inboundDomain, rejectReason, type InboundAttachment } from './chat-email';
import { emitEventSoon } from './events';
import { rateLimit } from './rate-limit';
import { saveUpload, UploadError, MAX_UPLOAD_SIZE } from './uploads';
import type { DocsBlock } from './docs-types';
import { createNote, listNotebooks, type NoteOwner } from './notes';
import { ensureNotePrefsRow } from './notes-prefs';
import { noteEventPayload } from './notes-types';
import { processNoteFileQueue } from './notes-file-text';

export const NOTES_EMAIL_DAILY = 200;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Asunto → título, libreta y etiquetas. Solo cuentan los `@x` y `#x` del final. Puro. */
export function parseEmailSubject(raw: string): { title: string; notebook: string | null; tags: string[] } {
  const subject = raw.replace(/^\s*((re|fw|fwd|rv|enc)\s*:\s*)+/i, '').trim();
  const words = subject.split(/\s+/);
  const tags: string[] = [];
  let notebook: string | null = null;
  while (words.length) {
    const last = words[words.length - 1];
    if (/^#[^\s#@]+$/.test(last)) tags.unshift(last.slice(1));
    else if (/^@[^\s#@]+$/.test(last) && !notebook) notebook = last.slice(1);
    else break;
    words.pop();
  }
  return { title: words.join(' ').slice(0, 300), notebook, tags: tags.slice(0, 20) };
}

/** Busca el token en los destinatarios. Puro salvo el dominio de entrada. */
export function parseNotesAddress(recipients: string[], domain = inboundDomain()): string | null {
  if (!domain) return null;
  for (const raw of recipients) {
    const m = raw.toLowerCase().match(/notes\+([a-z0-9]{24})@([a-z0-9.-]+)/);
    if (m && m[2] === domain.toLowerCase()) return m[1];
  }
  return null;
}

export function notesEmailAddress(token: string, domain = inboundDomain()): string | null {
  return domain ? `notes+${token}@${domain}` : null;
}

function newToken(): string {
  // 24 caracteres en minúscula y dígitos (hay casillas que pasan todo a minúscula).
  return randomBytes(24).toString('hex').slice(0, 24);
}

export async function getNotesEmail(owner: NoteOwner, opts: { rotate?: boolean } = {}): Promise<{ address: string | null }> {
  await ensureNotePrefsRow(owner);
  const db = getDb();
  const row = (await db.prepare('SELECT email_token FROM note_prefs WHERE workspace_id = ? AND person_id = ?').get(owner.workspaceId, owner.personId)) as { email_token: string | null } | undefined;
  let token = row?.email_token ?? null;
  if (!token || opts.rotate) {
    token = newToken();
    await db.prepare('UPDATE note_prefs SET email_token = ? WHERE workspace_id = ? AND person_id = ?').run(token, owner.workspaceId, owner.personId);
  }
  return { address: notesEmailAddress(token) };
}

export interface NotesInboundEmail {
  emailId: string;
  from: string;
  subject: string;
  text: string;
  headers: Record<string, string>;
  attachments: InboundAttachment[];
}

export type NotesInboundResult = { status: 'created'; noteId: string } | { status: 'skipped'; reason: string };

export function emailBlocks(from: string, text: string): DocsBlock[] {
  const id = () => crypto.randomUUID();
  const blocks: DocsBlock[] = [];
  if (from) blocks.push({ id: id(), type: 'callout', content: esc(from), icon: '✉️' });
  for (const p of text.split(/\n{2,}/).map((x) => x.trim()).filter(Boolean).slice(0, 500)) {
    blocks.push({ id: id(), type: 'paragraph', content: esc(p).replace(/\n/g, '<br>') });
  }
  if (!blocks.length) blocks.push({ id: id(), type: 'paragraph', content: '' });
  return blocks;
}

async function attachmentBlocks(files: InboundAttachment[]): Promise<DocsBlock[]> {
  const out: DocsBlock[] = [];
  for (const f of files.slice(0, 10)) {
    if (f.data.length === 0 || f.data.length > MAX_UPLOAD_SIZE) continue;
    try {
      const url = await saveUpload('docs', f.filename, f.contentType, f.data);
      const type = f.contentType.startsWith('image/') ? 'image' : f.contentType === 'application/pdf' ? 'pdf' : 'file';
      out.push({ id: crypto.randomUUID(), type, content: '', url, name: f.filename, size: f.data.length, mime: f.contentType });
    } catch (err) {
      if (!(err instanceof UploadError)) throw err;
    }
  }
  return out;
}

export async function processNotesInbound(token: string, email: NotesInboundEmail): Promise<NotesInboundResult> {
  const db = getDb();
  const person = (await db.prepare('SELECT workspace_id, person_id FROM note_prefs WHERE email_token = ?').get(token)) as { workspace_id: string; person_id: string } | undefined;
  if (!person) return { status: 'skipped', reason: 'unknown_address' };
  const reject = rejectReason({ emailId: email.emailId, from: email.from, to: [], subject: email.subject, text: email.text, messageId: null, headers: email.headers, authentication: null });
  if (reject) return { status: 'skipped', reason: reject };
  const limited = await rateLimit(`notes-email:${token}`, NOTES_EMAIL_DAILY, 86_400);
  if (!limited.ok) return { status: 'skipped', reason: 'rate_limited' };
  const claim = await db.prepare('INSERT OR IGNORE INTO note_email_received (email_id, created_at) VALUES (?, ?)').run(email.emailId, new Date().toISOString());
  if (claim.changes === 0) return { status: 'skipped', reason: 'duplicate' };
  const owner: NoteOwner = { workspaceId: person.workspace_id, personId: person.person_id };
  const parsed = parseEmailSubject(email.subject);
  const notebooks = parsed.notebook ? await listNotebooks(owner) : [];
  const notebook = parsed.notebook ? notebooks.find((n) => n.name.toLowerCase() === parsed.notebook!.toLowerCase()) : undefined;
  const note = await createNote(owner, {
    title: parsed.title,
    notebook_id: notebook?.id ?? null,
    tags: parsed.tags,
    content: [...emailBlocks(email.from, email.text), ...(await attachmentBlocks(email.attachments))],
  });
  await db.prepare('UPDATE note_email_received SET note_id = ? WHERE email_id = ?').run(note.id, email.emailId);
  await emitEventSoon(owner.workspaceId, 'note.created', noteEventPayload(note, owner.personId));
  await processNoteFileQueue({ noteId: note.id, limit: 5 }).catch(() => undefined);
  return { status: 'created', noteId: note.id };
}
