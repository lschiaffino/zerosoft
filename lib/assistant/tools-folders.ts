/**
 * Carpetas desde un JSON (Inbox y Lines) para el asistente.
 *
 * La persona pega o adjunta un JSON exportado de otra bandeja ("creá las
 * carpetas, subcarpetas y asigná los chats"). El flujo:
 * 1. propose_folders_from_json lee el JSON de la charla (el último mensaje o
 *    adjunto que tenga uno; el modelo no lo copia), lo normaliza
 *    (folders-json.ts), busca cada chat entre los de la persona y arma el
 *    plan: carpetas nuevas y reusadas, chats por carpeta, los que no
 *    encontró con los más parecidos. Nada se escribe: queda una tarjeta con
 *    Confirmar / Cancelar.
 * 2. Al confirmar, execute crea lo que falta y asigna en tandas. Es
 *    idempotente (carpeta por ruta, INSERT OR IGNORE, mover a la misma
 *    carpeta no cambia nada): repetirlo después de un error solo hace lo que
 *    faltó.
 *
 * Privacidad: Inbox es personal (las carpetas y chats de la persona real de
 * la sesión, nunca los de otro). Lines respeta el acceso por línea y por
 * etiqueta (chatAccessSql) y, con teléfonos ocultos, el plan solo muestra
 * nombres. Al modelo le llegan nombres de chats y carpetas, nunca mensajes.
 */
import { z } from 'zod';
import { createTranslator } from 'next-intl';
import { getDb } from '../db';
import { userCanUseApp } from '../workspace';
import { delegatedIdentity } from '../mcp/identity';
import { addThreadsToFolder, threadFor, upsertInboxFolders } from '../inbox/import';
import { ensureWhatsappAccount } from '../inbox/whatsapp';
import { flattenTree, MAX_FOLDER_DEPTH } from '../inbox/folder-tree';
import { LIMITS as INBOX_LIMITS, waPhoneOf } from '../inbox/types';
import { chatAccessSql, canSeeNumber, groupsViewer, type GroupsViewer } from '../groups-access';
import { createFolder as createLineFolder, listFolders as listLineFolders, moveChatsToFolder } from '../groups-lines';
import { GroupsError } from '../groups';
import enMessages from '../../messages/en/assistant.json';
import esMessages from '../../messages/es/assistant.json';
import ptMessages from '../../messages/pt/assistant.json';
import { getAttachments, readAttachmentBytes } from './files';
import { listMessages, type AttachmentPart } from './store';
import {
  buildFoldersPlan,
  existingPaths,
  FoldersJsonError,
  matchChat,
  buildChatIndex,
  normalizeFoldersJson,
  parseLooseJson,
  pathKey,
  pathLabel,
  type ChatCandidate,
  type ExistingFolder,
  type FoldersPlan,
  type NormalizedFolders,
} from './folders-json';
import { readTool, writeTool, type AssistantTool, type PreparedAction, type ToolCtx } from './registry';

/** Carpetas de Lines: las mismas 300 del workspace que deja crear la app. */
const LINES_MAX_FOLDERS = 300;
/** Cuántos renglones se listan por sección de la tarjeta (el resto, "y N más"). */
const LIST_MAX = 40;

const MESSAGES = { en: enMessages, es: esMessages, pt: ptMessages } as const;

function translator(locale: string) {
  const loc = (locale in MESSAGES ? locale : 'en') as keyof typeof MESSAGES;
  return createTranslator({ locale: loc, messages: MESSAGES[loc] as never, namespace: 'folders' as never }) as unknown as (key: string, values?: Record<string, string | number>) => string;
}

// ---------------------------------------------------------------------------
// De dónde sale el JSON
// ---------------------------------------------------------------------------

interface JsonSource {
  data: NormalizedFolders;
  /** "message" o el nombre del adjunto. */
  source: string;
}

function tryNormalize(text: string): NormalizedFolders | FoldersJsonError | null {
  try {
    const raw = parseLooseJson(text);
    if (raw === null || typeof raw !== 'object') return null;
    return normalizeFoldersJson(raw);
  } catch (err) {
    if (err instanceof FoldersJsonError) return err;
    throw err;
  }
}

async function attachmentText(ctx: ToolCtx, id: string): Promise<{ name: string; text: string } | null> {
  const [row] = await getAttachments({ workspaceId: ctx.workspaceId, personId: ctx.personId }, [id]);
  if (!row) return null;
  if (!/json|text|csv/.test(row.mime) && !/\.(json|txt|md)$/i.test(row.name)) return null;
  // El texto guardado se corta en 30.000 caracteres: el JSON completo sale del archivo.
  const bytes = await readAttachmentBytes(row).catch(() => null);
  const text = bytes ? bytes.toString('utf8') : (row.text ?? '');
  return text ? { name: row.name, text } : null;
}

/**
 * El JSON a usar: el que pasó el modelo (corto), el adjunto que nombró o, si
 * no, el más nuevo de la charla (adjuntos primero, después el texto de cada
 * mensaje de la persona, del último al primero).
 */
export async function readFoldersJson(ctx: ToolCtx, input: { json?: string; attachment?: string }): Promise<JsonSource | { error: string; hint?: string }> {
  let firstError: FoldersJsonError | null = null;
  const consider = (text: string, source: string): JsonSource | null => {
    const r = tryNormalize(text);
    if (r instanceof FoldersJsonError) {
      firstError ??= r;
      return null;
    }
    return r ? { data: r, source } : null;
  };
  if (input.attachment) {
    const a = await attachmentText(ctx, input.attachment);
    if (!a) return { error: 'attachment_not_found' };
    const hit = consider(a.text, a.name);
    if (hit) return hit;
  } else if (input.json?.trim()) {
    const hit = consider(input.json, 'message');
    if (hit) return hit;
  }
  if (!input.attachment && ctx.conversationId) {
    const rows = (await listMessages(ctx.conversationId, 40)).filter((m) => m.role === 'user').reverse();
    for (const m of rows) {
      const atts = m.parts.filter((p): p is AttachmentPart => p.type === 'attachment').reverse();
      for (const att of atts) {
        const a = await attachmentText(ctx, att.id);
        const hit = a ? consider(a.text, a.name) : null;
        if (hit) return hit;
      }
      if (/[[{]/.test(m.content)) {
        const hit = consider(m.content, 'message');
        if (hit) return hit;
      }
    }
  }
  const err = firstError as FoldersJsonError | null;
  if (err) return { error: err.code, hint: err.hint ?? HINTS[err.code] };
  return { error: 'no_json_found', hint: HINTS.no_json_found };
}

const HINTS: Record<string, string> = {
  no_json_found: 'No JSON with folders in this chat. Ask the person to paste it or attach the .json file.',
  no_folders:
    'The JSON has no folders this tool understands. Ask the person which key holds the folders and which the chats. Accepted: a tree [{ name, chats, subfolders }], a map { "Folder": { "Sub": ["chat"] } }, paths { "A/B": [...] }, rows [{ chat, folder: "A/B" }], folders with ids { folders: [{ id, name, parentId }], chats: [{ name, folderId }] } or an inbox-zero export.',
  invalid_json: 'The JSON does not parse. Ask the person to paste it again (whole, without cutting).',
  too_large: 'The JSON is too large. Ask the person to split it.',
};

// ---------------------------------------------------------------------------
// Lo que hay
// ---------------------------------------------------------------------------

interface Snapshot {
  existing: ExistingFolder[];
  chats: ChatCandidate[];
  room: number;
  /** Lines con teléfonos ocultos: el plan muestra solo nombres. */
  mask: boolean;
}

async function inboxSnapshot(owner: string): Promise<Snapshot> {
  const db = getDb();
  const folders = (await db.prepare('SELECT id, name, parent_id FROM inbox_folders WHERE owner_id = ? ORDER BY position, created_at').all(owner)) as Array<{
    id: string;
    name: string;
    parent_id: string | null;
  }>;
  const rows = (await db
    .prepare(
      `SELECT t.id, t.channel, t.kind, t.title, t.handle, t.external_id,
         (SELECT group_concat(folder_id) FROM inbox_thread_folders f WHERE f.thread_id = t.id) AS folder_ids
       FROM inbox_threads t WHERE t.owner_id = ? ORDER BY t.last_message_at DESC LIMIT 20000`,
    )
    .all(owner)) as Array<{ id: string; channel: string; kind: string; title: string; handle: string; external_id: string; folder_ids: string | null }>;
  return {
    existing: folders.map((f) => ({ id: f.id, name: f.name, parentId: f.parent_id })),
    chats: rows.map((r) => {
      const wa = r.channel === 'whatsapp';
      const phone = wa ? r.handle.replace(/\D+/g, '') || waPhoneOf(r.external_id) : '';
      return {
        id: r.id,
        name: r.title || r.handle,
        ...(phone ? { phone } : {}),
        ...(wa ? { jid: r.external_id } : {}),
        ...(!wa && r.handle.includes('@') ? { email: r.handle.toLowerCase() } : {}),
        folderIds: r.folder_ids ? String(r.folder_ids).split(',') : [],
      };
    }),
    room: Math.max(0, INBOX_LIMITS.folders - folders.length),
    mask: false,
  };
}

async function lineFolderRows(ws: string): Promise<ExistingFolder[]> {
  const rows = (await getDb().prepare('SELECT id, name, parent_id FROM groups_folders WHERE user_id = ? ORDER BY position, id').all(ws)) as Array<{
    id: string;
    name: string;
    parent_id: string | null;
  }>;
  return rows.map((r) => ({ id: r.id, name: r.name, parentId: r.parent_id }));
}

async function linesSnapshot(ws: string, viewer: GroupsViewer, lineId: string | null): Promise<Snapshot> {
  const access = chatAccessSql(viewer, 'c');
  const rows = (await getDb()
    .prepare(
      `SELECT c.id, c.name, c.phone, c.provider_chat_id, c.folder_id FROM groups_chats c
       WHERE c.user_id = ? AND c.hidden_at IS NULL${lineId ? ' AND c.number_id = ?' : ''}${access ? ` AND ${access.sql}` : ''}
       ORDER BY c.last_message_at DESC LIMIT 20000`,
    )
    .all(ws, ...(lineId ? [lineId] : []), ...(access?.args ?? []))) as Array<{ id: string; name: string; phone: string; provider_chat_id: string; folder_id: string | null }>;
  const existing = await lineFolderRows(ws);
  return {
    existing,
    chats: rows.map((r) => ({
      id: r.id,
      name: r.name || (viewer.mask ? '' : r.phone),
      ...(r.phone ? { phone: r.phone.replace(/\D+/g, '') } : {}),
      ...(/@/.test(r.provider_chat_id) ? { jid: r.provider_chat_id } : {}),
      folderIds: r.folder_id ? [r.folder_id] : [],
    })),
    room: Math.max(0, LINES_MAX_FOLDERS - existing.length),
    mask: viewer.mask,
  };
}

/** La línea por id, nombre o teléfono, si la persona la ve. */
async function resolveLine(viewer: GroupsViewer, ref: string | undefined): Promise<{ id: string | null } | { error: string; hint?: unknown }> {
  if (!ref?.trim()) return { id: null };
  const rows = (await getDb().prepare('SELECT id, name, phone FROM groups_numbers WHERE user_id = ?').all(viewer.ws)) as Array<{ id: string; name: string; phone: string }>;
  const q = ref.trim().toLowerCase();
  const digits = q.replace(/\D+/g, '');
  const hit = rows.filter((r) => r.id === ref || r.name.toLowerCase() === q || (digits.length >= 7 && r.phone.replace(/\D+/g, '').endsWith(digits)));
  const visible: typeof rows = [];
  for (const r of hit) if (await canSeeNumber(viewer, r.id)) visible.push(r);
  if (visible.length === 1) return { id: visible[0].id };
  return { error: visible.length ? 'ambiguous_line' : 'line_not_found' };
}

// ---------------------------------------------------------------------------
// Tarjeta
// ---------------------------------------------------------------------------

function listOf(t: ReturnType<typeof translator>, rows: string[]): string {
  const shown = rows.slice(0, LIST_MAX);
  const rest = rows.length - shown.length;
  return [...shown, ...(rest > 0 ? [t('more', { count: rest })] : [])].join('\n');
}

export interface PlanExtras {
  newChats: Array<{ jid: string; name: string; path: string[] }>;
  source: string;
}

/** Orden de lectura: cada carpeta seguida de sus subcarpetas. */
function byPath(a: { path: string[] }, b: { path: string[] }): number {
  for (let i = 0; i < Math.min(a.path.length, b.path.length); i++) {
    const c = a.path[i].localeCompare(b.path[i], undefined, { sensitivity: 'base', numeric: true });
    if (c) return c;
  }
  return a.path.length - b.path.length;
}

/** Plan → resumen y renglones de la tarjeta (en el idioma de la persona). */
export function planCard(plan: FoldersPlan, extras: PlanExtras, locale: string): Pick<PreparedAction, 'summary' | 'details'> & { working: string } {
  const t = translator(locale);
  const app = t(`app.${plan.target}`);
  const assign = plan.assign + extras.newChats.length;
  const summary = plan.toCreate && assign ? t('summaryBoth', { create: plan.toCreate, assign, app }) : plan.toCreate ? t('summaryCreate', { create: plan.toCreate, app }) : assign ? t('summaryAssign', { assign, app }) : t('summaryMove', { app });
  const details: PreparedAction['details'] = [];
  const created = plan.folders.filter((f) => !f.existingId && !f.tooDeep).sort(byPath);
  const reused = plan.folders.filter((f) => f.existingId).sort(byPath);
  const perFolder = (rows: typeof created) => rows.map((f) => t('perFolder', { path: pathLabel(f.path), count: f.add.length + extras.newChats.filter((n) => pathKey(n.path) === pathKey(f.path)).length }));
  if (created.length) details.push({ label: t('create', { count: created.length }), after: listOf(t, perFolder(created)) });
  if (reused.length) details.push({ label: t('reuse', { count: reused.length }), after: listOf(t, perFolder(reused)) });
  details.push({ label: t('chats'), after: t('chatsValue', { assign, already: plan.alreadyAssigned }) });
  if (extras.newChats.length) details.push({ label: t('newChats', { count: extras.newChats.length }), after: t('newChatsValue', { names: listOf(t, extras.newChats.map((n) => n.name)).replace(/\n/g, ', ') }) });
  const newKeys = new Set(extras.newChats.map((n) => `${pathKey(n.path)}|${n.jid}`));
  const unmatched = plan.unmatched.filter((u) => !(u.ref?.jid && u.path && newKeys.has(`${pathKey(u.path)}|${u.ref.jid}`)));
  if (unmatched.length) {
    details.push({
      label: t('unmatched', { count: unmatched.length }),
      after: listOf(
        t,
        unmatched.map((u) => (u.candidates.length ? t('closest', { chat: u.chat, folder: u.folder, names: u.candidates.join(', ') }) : t('noCandidates', { chat: u.chat, folder: u.folder }))),
      ),
    });
  }
  if (plan.ambiguous.length) {
    details.push({ label: t('ambiguous', { count: plan.ambiguous.length }), after: listOf(t, plan.ambiguous.map((a) => t('ambiguousRow', { chat: a.chat, folder: a.folder, names: a.candidates.join(', ') }))) });
  }
  if (plan.conflicts.length) {
    details.push({ label: t('conflicts', { count: plan.conflicts.length }), after: listOf(t, plan.conflicts.map((c) => t('conflictRow', { chat: c.chat, folders: c.folder }))) });
  }
  if (plan.moves.length) {
    details.push({
      label: t('moves', { count: plan.moves.length }),
      after: `${listOf(t, plan.moves.map((m) => t('moveRow', { chat: m.chat, from: m.from, to: m.to })))}\n${plan.removeFromOthers ? t('movesDone') : t('movesKept')}`,
    });
  }
  if (plan.removals.length) details.push({ label: t('removals'), after: t('removalsValue', { count: plan.removals.length }) });
  if (plan.tooDeep.length) details.push({ label: t('tooDeep', { count: plan.tooDeep.length }), after: t('tooDeepValue', { paths: plan.tooDeep.slice(0, LIST_MAX).join(', '), max: MAX_FOLDER_DEPTH }) });
  if (plan.overLimit.length) details.push({ label: t('overLimit', { count: plan.overLimit.length }), after: listOf(t, plan.overLimit) });
  if (plan.skipped.length) details.push({ label: t('skipped', { count: plan.skipped.length }), after: listOf(t, plan.skipped) });
  details.push({ label: t('source'), after: extras.source === 'message' ? t('sourceMessage') : extras.source });
  return { summary, details, working: t('working', { create: plan.toCreate }) };
}

/** Lo que vuelve al modelo: números y los problemas (para preguntar), sin ids. */
function modelView(plan: FoldersPlan, extras: PlanExtras) {
  return {
    target: plan.target,
    shapes: plan.shapes,
    foldersToCreate: plan.folders
      .filter((f) => !f.existingId && !f.tooDeep)
      .sort(byPath)
      .map((f) => ({ path: pathLabel(f.path), chats: f.add.length })),
    foldersReused: plan.folders
      .filter((f) => f.existingId)
      .sort(byPath)
      .map((f) => ({ path: pathLabel(f.path), chats: f.add.length, already: f.already })),
    chatsToAssign: plan.assign,
    alreadyAssigned: plan.alreadyAssigned,
    newChats: extras.newChats.length,
    notFound: plan.unmatched.slice(0, 30).map((u) => ({ chat: u.chat, folder: u.folder, closest: u.candidates })),
    notFoundTotal: plan.unmatched.length,
    ambiguous: plan.ambiguous.slice(0, 30),
    conflicts: plan.conflicts.slice(0, 30).map((c) => ({ chat: c.chat, folders: c.folder })),
    inAnotherFolder: plan.moves.length,
    willMove: plan.removeFromOthers,
    removals: plan.removals.length,
    notCreated: [...plan.tooDeep, ...plan.overLimit],
    notUnderstood: plan.skipped.length,
  };
}

// ---------------------------------------------------------------------------
// Ejecutar
// ---------------------------------------------------------------------------

const stored = z.object({
  target: z.enum(['inbox', 'lines']),
  lineId: z.string().nullable().optional(),
  removeFromOthers: z.boolean().default(false),
  folders: z.array(z.object({ path: z.array(z.string()).min(1), color: z.string().optional(), add: z.array(z.string()) })),
  removals: z.array(z.object({ chatId: z.string(), folderId: z.string() })).default([]),
  newChats: z.array(z.object({ jid: z.string(), name: z.string(), path: z.array(z.string()) })).default([]),
});
type Stored = z.infer<typeof stored>;

interface Outcome {
  created: number;
  reused: number;
  added: number;
  already: number;
  moved: number;
  removed: number;
  newChats: number;
  hidden: number;
  failed: string[];
}

async function applyInbox(owner: string, s: Stored): Promise<Outcome> {
  const out: Outcome = { created: 0, reused: 0, added: 0, already: 0, moved: 0, removed: 0, newChats: 0, hidden: 0, failed: [] };
  const ups = await upsertInboxFolders(
    owner,
    s.folders.map((f) => ({ key: pathKey(f.path), name: f.path[f.path.length - 1], parentKey: f.path.length > 1 ? pathKey(f.path.slice(0, -1)) : null, color: f.color })),
    new Date(),
    { maxDepth: MAX_FOLDER_DEPTH },
  );
  out.created = ups.created;
  out.reused = ups.reused;
  for (const k of ups.skipped) out.failed.push(`${s.folders.find((f) => pathKey(f.path) === k)?.path.join(' / ') ?? k} (limit)`);
  // Chats nuevos (con su JID): como el importador, quedan en Inbox sin mensajes.
  const extra = new Map<string, string[]>();
  if (s.newChats.length) {
    try {
      const account = await ensureWhatsappAccount(owner);
      const cache = new Map();
      for (const n of s.newChats) {
        const t = await threadFor(account, cache, n.jid, n.name);
        if (!t) continue;
        out.newChats++;
        const k = pathKey(n.path);
        extra.set(k, [...(extra.get(k) ?? []), t.id]);
      }
    } catch (err) {
      out.failed.push(`new chats (${String(err instanceof Error ? err.message : err).slice(0, 60)})`);
    }
  }
  for (const f of s.folders) {
    const id = ups.ids.get(pathKey(f.path));
    const ids = [...f.add, ...(extra.get(pathKey(f.path)) ?? [])];
    if (!id || !ids.length) continue;
    try {
      const r = await addThreadsToFolder(owner, id, ids);
      out.added += r.added;
      out.already += r.already;
      out.hidden += r.missing;
    } catch (err) {
      out.failed.push(`${f.path.join(' / ')} (${String(err instanceof Error ? err.message : err).slice(0, 60)})`);
    }
  }
  if (s.removeFromOthers && s.removals.length) {
    const db = getDb();
    for (const r of s.removals) {
      try {
        const res = await db
          .prepare(
            'DELETE FROM inbox_thread_folders WHERE thread_id = ? AND folder_id = ? AND folder_id IN (SELECT id FROM inbox_folders WHERE owner_id = ?) AND thread_id IN (SELECT id FROM inbox_threads WHERE owner_id = ?)',
          )
          .run(r.chatId, r.folderId, owner, owner);
        out.removed += res.changes;
      } catch {
        out.failed.push('remove from other folders');
        break;
      }
    }
  }
  return out;
}

async function applyLines(ws: string, me: string, viewer: GroupsViewer, s: Stored): Promise<Outcome> {
  const out: Outcome = { created: 0, reused: 0, added: 0, already: 0, moved: 0, removed: 0, newChats: 0, hidden: 0, failed: [] };
  const ids = new Map<string, string>();
  const failedKeys = new Set<string>();
  const sorted = [...s.folders].sort((a, b) => a.path.length - b.path.length);
  for (const f of sorted) {
    const key = pathKey(f.path);
    const parentKey = f.path.length > 1 ? pathKey(f.path.slice(0, -1)) : null;
    if (parentKey && failedKeys.has(parentKey)) {
      failedKeys.add(key);
      continue;
    }
    // Se mira de nuevo antes de cada una: otra persona pudo crearla mientras tanto.
    const known = existingPaths(await lineFolderRows(ws)).get(key);
    if (known) {
      ids.set(key, known);
      out.reused++;
      continue;
    }
    try {
      const made = await createLineFolder(ws, me, { name: f.path[f.path.length - 1], parentId: parentKey ? (ids.get(parentKey) ?? null) : null });
      ids.set(key, made.id);
      out.created++;
    } catch (err) {
      const code = err instanceof GroupsError ? err.code : 'error';
      const again = existingPaths(await lineFolderRows(ws)).get(key);
      if (code === 'duplicate_folder' && again) {
        ids.set(key, again);
        out.reused++;
      } else {
        failedKeys.add(key);
        out.failed.push(`${f.path.join(' / ')} (${code})`);
      }
    }
  }
  const db = getDb();
  for (const f of s.folders) {
    const folderId = ids.get(pathKey(f.path));
    if (!folderId || !f.add.length) continue;
    for (let i = 0; i < f.add.length; i += 200) {
      const chunk = f.add.slice(i, i + 200);
      try {
        // Lo que cambió desde el plan: los que ya están acá no cuentan y, sin permiso para mover, los que entraron a otra carpeta se quedan.
        const now = (await db
          .prepare(`SELECT id, folder_id FROM groups_chats WHERE user_id = ? AND id IN (${chunk.map(() => '?').join(',')})`)
          .all(ws, ...chunk)) as Array<{ id: string; folder_id: string | null }>;
        const here = now.filter((c) => c.folder_id === folderId).length;
        const elsewhere = now.filter((c) => c.folder_id && c.folder_id !== folderId);
        const move = now.filter((c) => c.folder_id !== folderId && (!c.folder_id || s.removeFromOthers)).map((c) => c.id);
        out.already += here;
        if (!s.removeFromOthers) out.failed.push(...(elsewhere.length ? [`${elsewhere.length} chats moved meanwhile (kept)`] : []));
        if (!move.length) continue;
        const r = await moveChatsToFolder(ws, viewer, move, folderId);
        out.added += r.updated;
        out.hidden += r.failed;
        if (s.removeFromOthers) out.moved += elsewhere.length;
      } catch (err) {
        out.failed.push(`${f.path.join(' / ')} (${err instanceof GroupsError ? err.code : 'error'})`);
      }
    }
  }
  return out;
}

function resultMessage(o: Outcome, locale: string): string {
  const t = translator(locale);
  return [
    t('result', { created: o.created, reused: o.reused, added: o.added, already: o.already }),
    o.moved ? t('resultMoved', { count: o.moved }) : '',
    o.removed ? t('resultRemoved', { count: o.removed }) : '',
    o.newChats ? t('resultNew', { count: o.newChats }) : '',
    o.hidden ? t('resultHidden', { count: o.hidden }) : '',
    o.failed.length ? t('resultFailed', { list: [...new Set(o.failed)].slice(0, 8).join('; ') }) : '',
  ]
    .filter(Boolean)
    .join(' ');
}

// ---------------------------------------------------------------------------
// Herramientas
// ---------------------------------------------------------------------------

/** Ruta legible de cada carpeta ("Clientes / VIP"). */
function folderPaths(rows: ExistingFolder[]): Map<string, string> {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out = new Map<string, string>();
  const label = (f: ExistingFolder, depth = 0): string => {
    const hit = out.get(f.id);
    if (hit) return hit;
    const p = f.parentId ? byId.get(f.parentId) : undefined;
    const s = p && depth < 8 ? `${label(p, depth + 1)} / ${f.name}` : f.name;
    out.set(f.id, s);
    return s;
  };
  for (const r of rows) label(r);
  return out;
}

const proposeInput = z.object({
  target: z.enum(['inbox', 'lines']).describe('inbox = the person\'s own Inbox (default). lines = the shared Lines folders of the workspace.'),
  attachment: z.string().max(64).optional().describe('Id of an attached .json file (att_...). Omit to use the latest JSON in this chat.'),
  json: z.string().max(20_000).optional().describe('Only for a short JSON the person typed in a different way. Normally omit: the tool reads the JSON from the chat itself.'),
  line: z.string().max(100).optional().describe('Lines only: match chats of this line (id, name or phone).'),
  removeFromOtherFolders: z
    .boolean()
    .optional()
    .describe('Only if the person explicitly asked to move chats out of folders they are in now. Default false: chats already in another folder stay there.'),
  createMissingChats: z
    .boolean()
    .optional()
    .describe('Inbox only, and only if the person asked: chats of the JSON with a WhatsApp id or phone that are not in Inbox are added as new (empty) chats.'),
});

/**
 * JID de WhatsApp para un chat nuevo a partir de un teléfono. Solo con código
 * de país (11 a 15 dígitos): un número local crearía un chat que nunca recibe
 * nada. En Argentina WhatsApp usa el 9 de los celulares (54 9 11…).
 */
export function newChatJid(phone: string | undefined): string | null {
  let d = (phone ?? '').replace(/\D+/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length < 11 || d.length > 15) return null;
  if (/^54(?!9)\d{10}$/.test(d)) d = `549${d.slice(2)}`;
  return `${d}@s.whatsapp.net`;
}

export const folderTools: AssistantTool[] = [
  readTool({
    name: 'inbox_folders',
    // Inbox está siempre (personal): no depende de las apps del workspace.
    app: null,
    description: "The person's own Inbox folders and subfolders (path and number of chats in each), plus how many chats they have. Personal: never another person's.",
    input: z.object({}),
    run: async (ctx) => {
      // Como las rutas de Inbox: nunca con un token delegado (API key, MCP).
      if (delegatedIdentity()) return { error: 'not_available_here' };
      const db = getDb();
      const rows = (await db.prepare('SELECT id, name, parent_id FROM inbox_folders WHERE owner_id = ? ORDER BY position, created_at').all(ctx.personId)) as Array<{
        id: string;
        name: string;
        parent_id: string | null;
      }>;
      const counts = (await db
        .prepare('SELECT tf.folder_id AS id, COUNT(*) AS n FROM inbox_thread_folders tf JOIN inbox_folders f ON f.id = tf.folder_id WHERE f.owner_id = ? GROUP BY tf.folder_id')
        .all(ctx.personId)) as Array<{ id: string; n: number }>;
      const total = (await db.prepare('SELECT COUNT(*) AS n FROM inbox_threads WHERE owner_id = ?').get(ctx.personId)) as { n: number } | undefined;
      const n = new Map(counts.map((c) => [c.id, Number(c.n)]));
      const paths = folderPaths(rows.map((r) => ({ id: r.id, name: r.name, parentId: r.parent_id })));
      const ordered = flattenTree(rows.map((r, i) => ({ id: r.id, parentId: r.parent_id, position: i }))).map((x) => x.folder.id);
      return { folders: ordered.map((id) => ({ path: paths.get(id), chats: n.get(id) ?? 0, href: `/app/inbox/f/${id}` })), totalChats: Number(total?.n ?? 0), href: '/app/inbox' };
    },
  }),
  readTool({
    name: 'inbox_find_chats',
    // Inbox está siempre (personal): no depende de las apps del workspace.
    app: null,
    description: "Find chats in the person's own Inbox by name, phone or email (no messages). Use to resolve a chat the folder plan could not match.",
    input: z.object({ query: z.string().trim().min(1).max(120) }),
    run: async (ctx, { query }) => {
      if (delegatedIdentity()) return { error: 'not_available_here' };
      const snap = await inboxSnapshot(ctx.personId);
      const idx = buildChatIndex(snap.chats);
      const paths = folderPaths(snap.existing);
      const ref = /@/.test(query) ? { label: query, email: query.toLowerCase() } : /^[+\d\s().-]{7,}$/.test(query) ? { label: query, phone: query.replace(/\D+/g, '') } : { label: query, name: query };
      const m = matchChat(ref, idx);
      const list = m.status === 'matched' ? snap.chats.filter((c) => c.id === m.id) : m.status === 'ambiguous' ? m.candidates : m.closest;
      return { chats: list.slice(0, 10).map((c) => ({ name: c.name, phone: c.phone ?? null, email: c.email ?? null, folders: c.folderIds.map((f) => paths.get(f) ?? f) })), exact: m.status === 'matched' };
    },
  }),
  readTool({
    name: 'lines_folders',
    app: 'groups',
    description: 'Folders and subfolders of Lines (shared by the workspace), with the number of chats in each that the person can see.',
    input: z.object({}),
    run: async (ctx) => {
      const viewer = await groupsViewer(ctx.workspaceId, ctx.personId, ctx.user.role);
      const res = await listLineFolders(ctx.workspaceId, viewer);
      const paths = folderPaths(res.folders.map((f) => ({ id: f.id, name: f.name, parentId: f.parentId })));
      return { folders: flattenTree(res.folders).map(({ folder: f }) => ({ path: paths.get(f.id), chats: f.chats })), unfiled: res.unfiled.chats, href: '/app/lines/inbox' };
    },
  }),
  writeTool({
    name: 'propose_folders_from_json',
    app: null,
    description:
      'Plan creating folders and subfolders from a JSON the person pasted or attached (exported from another inbox) and putting their chats in them, in Inbox (default) or Lines. It reads the JSON from this chat by itself: do NOT copy the JSON into the call. Accepts trees, maps, "A/B" paths, rows and inbox-zero exports, with chats by name, phone, WhatsApp id or email. Nothing changes until the person clicks Confirm on the plan card; repeating it after a partial failure only does what is missing. If it returns an error with a hint, ask the person what the hint says.',
    input: proposeInput,
    prepare: async (ctx, input) => {
      const target = input.target ?? 'inbox';
      // Cada destino exige su app (la herramienta es de la plataforma porque sirve a las dos).
      if (!userCanUseApp(ctx.user, target === 'inbox' ? 'inbox' : 'groups')) return { error: 'app_not_available' };
      if (target === 'inbox' && delegatedIdentity()) return { error: 'not_available_here' };
      const src = await readFoldersJson(ctx, input);
      if ('error' in src) return src;
      let snap: Snapshot;
      let lineId: string | null = null;
      if (target === 'inbox') snap = await inboxSnapshot(ctx.personId);
      else {
        const viewer = await groupsViewer(ctx.workspaceId, ctx.personId, ctx.user.role);
        const line = await resolveLine(viewer, input.line);
        if ('error' in line) return line;
        lineId = line.id;
        snap = await linesSnapshot(ctx.workspaceId, viewer, lineId);
      }
      const plan = buildFoldersPlan({
        target,
        normalized: src.data,
        existing: snap.existing,
        chats: snap.chats,
        removeFromOthers: Boolean(input.removeFromOtherFolders),
        maxDepth: MAX_FOLDER_DEPTH,
        room: snap.room,
      });
      // Chats nuevos: solo Inbox, con id de WhatsApp o teléfono completo.
      const newChats: PlanExtras['newChats'] = [];
      let notYet: string | null = null;
      if (input.createMissingChats) {
        if (target === 'lines') {
          notYet =
            'Creating chats in Lines is not available yet: Lines chats come from the connected WhatsApp line and appear when someone writes or the line syncs. Needed: the chat has to exist on the line. Tell the person; the rest of the plan is ready.';
        } else {
          const seen = new Set<string>();
          for (const u of plan.unmatched) {
            const jid = u.ref?.jid ?? newChatJid(u.ref?.phone);
            if (!jid || !u.path || /@(lid|broadcast|newsletter)$/.test(jid)) continue;
            const k = `${pathKey(u.path)}|${jid}`;
            if (seen.has(k)) continue;
            seen.add(k);
            newChats.push({ jid, name: u.ref?.name ?? u.chat, path: u.path });
          }
        }
      }
      const changes = plan.toCreate + plan.assign + newChats.length + (plan.removeFromOthers ? plan.removals.length : 0);
      const extras: PlanExtras = { newChats, source: src.source };
      if (!changes) {
        return { error: 'nothing_to_do', hint: { ...modelView(plan, extras), note: 'Everything in the JSON is already in place (or could not be matched). Tell the person; nothing to confirm.', ...(notYet ? { notYet } : {}) } };
      }
      const card = planCard(plan, extras, ctx.locale);
      const input2: Stored = {
        target,
        lineId,
        removeFromOthers: plan.removeFromOthers,
        folders: plan.folders.filter((f) => !f.tooDeep).map((f) => ({ path: f.path, ...(f.color ? { color: f.color } : {}), add: f.add })),
        removals: plan.removeFromOthers ? plan.removals : [],
        newChats: newChats.map((n) => ({ ...n, jid: n.jid })),
      };
      return {
        summary: card.summary,
        details: card.details,
        working: card.working,
        // Mover chats de otra carpeta (o sacarlos) es destructivo: la tarjeta va en rojo, con botones (sin tipear).
        destructive: plan.removeFromOthers && (plan.moves.length > 0 || plan.removals.length > 0),
        confirmText: null,
        input: input2 as unknown as Record<string, unknown>,
        forModel: { ...modelView(plan, extras), ...(notYet ? { notYet } : {}) },
      };
    },
    execute: async (ctx, raw) => {
      const parsed = stored.safeParse(raw);
      if (!parsed.success) return { ok: false, error: 'invalid_plan' };
      const s = parsed.data;
      if (!userCanUseApp(ctx.user, s.target === 'inbox' ? 'inbox' : 'groups')) return { ok: false, error: 'forbidden' };
      if (s.target === 'inbox' && delegatedIdentity()) return { ok: false, error: 'forbidden' };
      let o: Outcome;
      if (s.target === 'inbox') o = await applyInbox(ctx.personId, s);
      else {
        const viewer = await groupsViewer(ctx.workspaceId, ctx.personId, ctx.user.role);
        if (s.lineId && !(await canSeeNumber(viewer, s.lineId))) return { ok: false, error: 'forbidden' };
        o = await applyLines(ctx.workspaceId, ctx.personId, viewer, s);
      }
      const did = o.created + o.added + o.moved + o.removed + o.newChats > 0 || o.reused + o.already > 0;
      return {
        ok: o.failed.length === 0 || did,
        partial: o.failed.length > 0,
        message: resultMessage(o, ctx.locale),
        ...(o.failed.length && !did ? { error: resultMessage(o, ctx.locale) } : {}),
        href: s.target === 'inbox' ? '/app/inbox' : '/app/lines/inbox',
      };
    },
  }),
];
