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
import { FOLDER_COLORS, foldText, InboxError, LIMITS, normalizeWaJid, waKindOf, waPhoneOf } from './types';

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

export async function threadFor(account: AccountRow, cache: Map<string, ThreadRow>, rawId: string, name = ''): Promise<ThreadRow | null> {
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

export interface FolderUpsert {
  /** Id de la carpeta en el archivo (o su ruta): lo usan los hijos en parentKey. */
  key: string;
  name: string;
  parentKey: string | null;
  color?: string;
  icon?: string;
  position?: number;
}

export interface FolderUpsertResult {
  /** key → id de la carpeta (creada o la que ya estaba). */
  ids: Map<string, string>;
  created: number;
  reused: number;
  /** Keys que no se crearon: el tope de carpetas o más hondo de lo permitido (con maxDepth). */
  skipped: string[];
}

/**
 * Crea las carpetas de Inbox que falten (padres antes que hijos) y reusa las
 * que ya están con el mismo nombre en el mismo padre (sin distinguir
 * mayúsculas ni tildes): correrlo dos veces no duplica nada. Lo usan el
 * importador y el asistente (carpetas desde un JSON).
 */
export async function upsertInboxFolders(owner: string, list: FolderUpsert[], now = new Date(), opts: { maxDepth?: number } = {}): Promise<FolderUpsertResult> {
  const db = getDb();
  const nowS = nowIso(now);
  const res: FolderUpsertResult = { ids: new Map(), created: 0, reused: 0, skipped: [] };
  const existing = (await db.prepare('SELECT id, name, parent_id FROM inbox_folders WHERE owner_id = ? ORDER BY position, created_at').all(owner)) as Array<{
    id: string;
    name: string;
    parent_id: string | null;
  }>;
  const keyOf = (parentId: string | null, name: string) => `${parentId ?? ''}|${foldText(name.trim().replace(/\s+/g, ' '))}`;
  const byKey = new Map<string, string>();
  for (const f of existing) if (!byKey.has(keyOf(f.parent_id, f.name))) byKey.set(keyOf(f.parent_id, f.name), f.id);
  const depth = new Map<string, number>();
  const parentOf = new Map(existing.map((f) => [f.id, f.parent_id]));
  const depthOfId = (id: string): number => {
    const hit = depth.get(id);
    if (hit !== undefined) return hit;
    let d = 0;
    let p = parentOf.get(id) ?? null;
    const seen = new Set([id]);
    while (p && !seen.has(p)) {
      seen.add(p);
      d++;
      p = parentOf.get(p) ?? null;
    }
    depth.set(id, d);
    return d;
  };
  let total = existing.length;
  let pos = existing.length;
  const pending = [...list].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  for (let pass = 0; pass < 6 && pending.length; pass++) {
    for (let i = 0; i < pending.length; ) {
      const f = pending[i];
      const parentKey = f.parentKey;
      if (parentKey && !res.ids.has(parentKey) && !res.skipped.includes(parentKey) && pass < 5) {
        i++;
        continue;
      }
      pending.splice(i, 1);
      const name = f.name.trim().replace(/\s+/g, ' ').slice(0, LIMITS.folderName);
      if (!name) continue;
      if (parentKey && res.skipped.includes(parentKey)) {
        res.skipped.push(f.key);
        continue;
      }
      const parentId = parentKey ? (res.ids.get(parentKey) ?? null) : null;
      if (opts.maxDepth !== undefined && parentId && depthOfId(parentId) + 1 > opts.maxDepth) {
        res.skipped.push(f.key);
        continue;
      }
      let id = byKey.get(keyOf(parentId, name));
      if (id) res.reused++;
      else {
        if (total >= LIMITS.folders) {
          res.skipped.push(f.key);
          continue;
        }
        id = newId('ibf');
        await db
          .prepare('INSERT INTO inbox_folders (id, owner_id, name, color, icon, position, parent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(id, owner, name, color(f.color ?? '', pos), (f.icon ?? '').slice(0, 8), pos++, parentId, nowS, nowS);
        byKey.set(keyOf(parentId, name), id);
        parentOf.set(id, parentId);
        total++;
        res.created++;
      }
      res.ids.set(f.key, id);
    }
  }
  return res;
}

/** Suma chats (de esta persona) a una carpeta. Los que ya estaban no cambian. Devuelve cuántos se sumaron. */
export async function addThreadsToFolder(owner: string, folderId: string, threadIds: string[]): Promise<number> {
  const db = getDb();
  let added = 0;
  const ids = [...new Set(threadIds)];
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const r = await db
      .prepare(
        `INSERT OR IGNORE INTO inbox_thread_folders (thread_id, folder_id)
         SELECT t.id, f.id FROM inbox_threads t JOIN inbox_folders f ON f.id = ? AND f.owner_id = t.owner_id
         WHERE t.owner_id = ? AND t.id IN (${chunk.map(() => '?').join(', ')})`,
      )
      .run(folderId, owner, ...chunk);
    added += r.changes;
  }
  return added;
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

  // Carpetas: por ruta (reimportar no duplica). Las subcarpetas, después de sus padres.
  const folders = await upsertInboxFolders(
    owner,
    part.folders.map((f) => ({
      key: String(f.id),
      name: f.name,
      parentKey: f.parentId === null || f.parentId === undefined ? null : String(f.parentId),
      color: f.color,
      icon: f.icon,
      position: f.position,
    })),
    now,
  );
  out.folders = folders.created;
  for (const cf of part.chatFolders) {
    const folder = folders.ids.get(String(cf.folderId));
    const t = folder ? await threadFor(account, cache, cf.chatId) : null;
    if (folder && t) await addThreadsToFolder(owner, folder, [t.id]);
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
