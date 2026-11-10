/**
 * Inbox: importar lo que hay en la app local "inbox-zero" (WhatsApp por
 * whatsapp-web.js con su base inbox.db). El script
 * scripts/inbox-zero-export.mjs lee esa base en la computadora y arma un JSON
 * (formato "inbox-zero-export" v1); la pantalla de importación lo manda en
 * partes: primero carpetas, programados, borradores, pospuestos y notas;
 * después los mensajes en tandas. Todo es idempotente: importar dos veces no
 * duplica nada. Las contraseñas de Gmail de la app local no se exportan ni se
 * importan (acá Gmail se conecta con Google).
 */
import { createHash } from 'crypto';
import { z } from 'zod';
import { getDb } from '../db';
import { addMessage, findThread, newId, nowIso, upsertThread, type AccountRow, type ThreadRow } from './core';
import { ensureWhatsappAccount, markArchived } from './whatsapp';
import { FOLDER_COLORS, InboxError, LIMITS, normalizeWaJid, waKindOf, waPhoneOf } from './types';

export const EXPORT_FORMAT = 'inbox-zero-export';

const chatId = z.string().min(3).max(200);
const text = (max: number) => z.string().max(max);

export const metaSchema = z.object({
  part: z.literal('meta'),
  format: z.literal(EXPORT_FORMAT),
  // 1: un solo JSON; 2: NDJSON (una parte por línea).
  version: z.union([z.literal(1), z.literal(2)]),
  folders: z
    .array(
      z.object({
        id: z.union([z.number(), z.string()]),
        name: text(200),
        color: text(20).optional().default(''),
        icon: text(16).optional().default(''),
        position: z.number().optional().default(0),
        parentId: z.union([z.number(), z.string(), z.null()]).optional().default(null),
      }),
    )
    .max(LIMITS.folders)
    .default([]),
  chatFolders: z.array(z.object({ chatId, folderId: z.union([z.number(), z.string()]) })).max(20_000).default([]),
  chats: z.array(z.object({ chatId, name: text(300).optional().default(''), isGroup: z.boolean().optional(), archived: z.boolean().optional() })).max(20_000).default([]),
  scheduled: z
    // Un programado de varios mensajes trae todos juntos (separados por \u001e).
    .array(z.object({ chatId, chatName: text(300).optional().default(''), text: text(LIMITS.message * 10), sendAt: z.number(), status: text(20).optional().default('pending') }))
    .max(2000)
    .default([]),
  drafts: z.array(z.object({ chatId, chatName: text(300).optional().default(''), text: text(LIMITS.draft * 4) })).max(5000).default([]),
  snoozes: z.array(z.object({ chatId, until: z.number() })).max(5000).default([]),
  notes: z.array(z.object({ chatId, text: text(LIMITS.notes) })).max(20_000).default([]),
});

export const messagesSchema = z.object({
  part: z.literal('messages'),
  messages: z
    .array(
      z.object({
        id: z.string().min(1).max(300),
        chatId,
        ts: z.number(),
        fromMe: z.boolean(),
        sender: text(200).optional().default(''),
        type: text(40).optional().default('chat'),
        text: text(20_000).optional().default(''),
      }),
    )
    .max(1000),
});

export const importSchema = z.discriminatedUnion('part', [metaSchema, messagesSchema]);
export type ImportPart = z.infer<typeof importSchema>;

export interface ImportResult {
  folders: number;
  chats: number;
  scheduled: number;
  drafts: number;
  snoozes: number;
  notes: number;
  /** Chats que quedaron archivados (como en WhatsApp). */
  archived: number;
  messages: number;
}

const MEDIA: Record<string, string> = { image: 'image', video: 'video', ptt: 'audio', audio: 'audio', document: 'document', sticker: 'sticker' };

/**
 * Id del mensaje como lo guarda WhatsApp (el de la "stanza", el mismo que
 * usa Evolution): whatsapp-web.js lo serializa "false_<chat>_<ID>_<autor>" y
 * WhatsApp Desktop lo exporta como "desk:<ID>". Con el mismo id, lo importado
 * y lo que trae el servidor no se duplican.
 */
export function stanzaIdOf(raw: string): string {
  const web = /^(?:true|false)_[^_]+@[^_]+_([A-Za-z0-9]+)(?:_.*)?$/.exec(raw);
  if (web) return web[1];
  if (raw.startsWith('desk:')) return raw.slice(5);
  return raw;
}

/** Separador de varios mensajes en un programado de la app local. */
// eslint-disable-next-line no-control-regex
const PART_SEP = /\u001e/;

async function threadFor(account: AccountRow, cache: Map<string, ThreadRow>, rawId: string, name = ''): Promise<ThreadRow | null> {
  const id = normalizeWaJid(rawId);
  if (!/@(s\.whatsapp\.net|g\.us|lid)$/.test(id)) return null;
  const hit = cache.get(id);
  if (hit) return hit;
  const t = await upsertThread(account, { externalId: id, kind: waKindOf(id), title: name || undefined, handle: waPhoneOf(id) });
  cache.set(id, t);
  return t;
}

function color(raw: string, i: number): string {
  return /^#[0-9a-f]{6}$/i.test(raw) ? raw.toLowerCase() : FOLDER_COLORS[i % FOLDER_COLORS.length];
}

export async function importPart(owner: string, part: ImportPart, now = new Date()): Promise<ImportResult> {
  const out: ImportResult = { folders: 0, chats: 0, scheduled: 0, drafts: 0, snoozes: 0, notes: 0, archived: 0, messages: 0 };
  const account = await ensureWhatsappAccount(owner);
  const cache = new Map<string, ThreadRow>();
  const db = getDb();
  const nowS = nowIso(now);

  if (part.part === 'messages') {
    for (const m of part.messages) {
      const t = await threadFor(account, cache, m.chatId);
      if (!t) continue;
      const ms = m.ts > 1e12 ? m.ts : m.ts * 1000;
      if (!Number.isFinite(ms) || ms <= 0) continue;
      const added = await addMessage(t, {
        externalId: stanzaIdOf(m.id),
        fromMe: m.fromMe,
        senderName: m.fromMe ? '' : m.sender,
        body: m.text,
        mediaType: MEDIA[m.type] ?? '',
        sentAt: new Date(ms).toISOString(),
        history: true,
      });
      if (added) out.messages++;
    }
    return out;
  }

  // Nombres de chats primero: lo demás crea los chats con nombre.
  for (const c of part.chats) {
    const t = await threadFor(account, cache, c.chatId, c.name);
    if (t) out.chats++;
    // Los archivados entran como archivados: no llenan la bandeja y se ven en "Archivados".
    if (t && c.archived && !t.archived_at) {
      await markArchived(t.id);
      out.archived++;
    }
  }

  // Carpetas: por nombre (reimportar no duplica). Las subcarpetas, después de sus padres.
  const idMap = new Map<string, string>();
  const existing = (await db.prepare('SELECT id, name FROM inbox_folders WHERE owner_id = ?').all(owner)) as Array<{ id: string; name: string }>;
  const byName = new Map(existing.map((f) => [f.name.toLowerCase(), f.id]));
  const pending = [...part.folders].sort((a, b) => a.position - b.position);
  let pos = existing.length;
  for (let pass = 0; pass < 6 && pending.length; pass++) {
    for (let i = 0; i < pending.length; ) {
      const f = pending[i];
      const parentKey = f.parentId === null || f.parentId === undefined ? null : String(f.parentId);
      if (parentKey && !idMap.has(parentKey) && pass < 5) {
        i++;
        continue;
      }
      const name = f.name.trim().slice(0, LIMITS.folderName);
      pending.splice(i, 1);
      if (!name) continue;
      let id = byName.get(name.toLowerCase());
      if (!id) {
        if (existing.length + out.folders >= LIMITS.folders) continue;
        id = newId('ibf');
        await db
          .prepare('INSERT INTO inbox_folders (id, owner_id, name, color, icon, position, parent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(id, owner, name, color(f.color, pos), f.icon.slice(0, 8), pos++, parentKey ? (idMap.get(parentKey) ?? null) : null, nowS, nowS);
        byName.set(name.toLowerCase(), id);
        out.folders++;
      }
      idMap.set(String(f.id), id);
    }
  }
  for (const cf of part.chatFolders) {
    const folder = idMap.get(String(cf.folderId));
    const t = folder ? await threadFor(account, cache, cf.chatId) : null;
    if (folder && t) await db.prepare('INSERT OR IGNORE INTO inbox_thread_folders (thread_id, folder_id) VALUES (?, ?)').run(t.id, folder);
  }

  // Programados que siguen pendientes y en el futuro (lo viejo no se manda solo).
  for (const s of part.scheduled) {
    if (s.status !== 'pending' || !s.text.trim()) continue;
    const at = new Date(s.sendAt > 1e12 ? s.sendAt : s.sendAt * 1000);
    if (!Number.isFinite(at.getTime()) || at.getTime() <= now.getTime() + 60_000) continue;
    const t = await threadFor(account, cache, s.chatId, s.chatName);
    if (!t) continue;
    // Varios mensajes en uno de la app local: acá cada uno es su burbuja, en la misma secuencia.
    const parts = s.text
      .split(PART_SEP)
      .map((p) => p.trim().slice(0, LIMITS.message))
      .filter(Boolean);
    if (!parts.length) continue;
    // La clave sale del contenido: reimportar no duplica.
    const batch = `ibb_iz${createHash('sha256').update(`${t.id}|${at.toISOString()}|${s.text}`).digest('hex').slice(0, 24)}`;
    const dup = await db.prepare('SELECT 1 FROM inbox_scheduled WHERE owner_id = ? AND batch_id = ?').get(owner, batch);
    if (dup) continue;
    for (let i = 0; i < parts.length; i++) {
      await db
        .prepare("INSERT INTO inbox_scheduled (id, owner_id, thread_id, body, send_at, status, batch_id, seq, delay_s, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, 0, ?, ?)")
        .run(newId('ibq'), owner, t.id, parts[i], at.toISOString(), batch, i, nowS, nowS);
    }
    out.scheduled++;
  }

  for (const d of part.drafts) {
    const t = await threadFor(account, cache, d.chatId, d.chatName);
    if (!t || !d.text.trim()) continue;
    const r = await db.prepare("UPDATE inbox_threads SET draft = ? WHERE id = ? AND draft = ''").run(d.text.slice(0, LIMITS.draft), t.id);
    out.drafts += r.changes;
  }

  for (const s of part.snoozes) {
    const at = new Date(s.until > 1e12 ? s.until : s.until * 1000);
    if (!Number.isFinite(at.getTime()) || at.getTime() <= now.getTime()) continue;
    const t = await threadFor(account, cache, s.chatId);
    if (!t) continue;
    await db.prepare('UPDATE inbox_threads SET snoozed_until = ?, done_at = NULL WHERE id = ?').run(at.toISOString(), t.id);
    out.snoozes++;
  }

  for (const n of part.notes) {
    const note = n.text.trim();
    if (!note) continue;
    const t = await threadFor(account, cache, n.chatId);
    if (!t) continue;
    const cur = (await findThread(account.id, t.external_id))?.notes ?? '';
    if (cur.includes(note.slice(0, 200))) continue;
    const next = (cur ? `${cur}\n\n${note}` : note).slice(0, LIMITS.notes);
    await db.prepare('UPDATE inbox_threads SET notes = ? WHERE id = ?').run(next, t.id);
    out.notes++;
  }
  return out;
}

export function parseImport(raw: unknown): ImportPart {
  const r = importSchema.safeParse(raw);
  if (!r.success) throw new InboxError('invalid_file', 400);
  return r.data;
}
