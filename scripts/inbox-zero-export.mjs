#!/usr/bin/env node
/**
 * Exporta lo que guarda la app local "inbox-zero" (y, si querés, todo el
 * historial de WhatsApp Desktop de esta Mac) para importarlo en Inbox
 * (zerosoft › Inbox › Ajustes › Importar). Solo lee: abre las bases en modo
 * lectura y escribe un archivo.
 *
 * Uso (Node 22.13 o más nuevo, sin dependencias):
 *   node scripts/inbox-zero-export.mjs <carpeta de inbox-zero> [--desktop[=ChatStorage.sqlite]] [--out inbox-zero-export.ndjson] [--days 0] [--no-messages]
 *
 * --out: .ndjson (por defecto) escribe una parte por línea y sirve para
 *   archivos grandes (se sube directo y se importa en tandas, se retoma si se
 *   corta). .json escribe el formato viejo, todo en un objeto.
 * --desktop: suma los mensajes de WhatsApp Desktop (ChatStorage.sqlite), que
 *   tiene la historia completa. Sin ruta usa la de macOS.
 * --days: solo los mensajes de los últimos N días (0 = todos, por defecto).
 *
 * Qué lleva:
 * - carpetas (wa_tags, con color, ícono, orden y subcarpetas) y qué chats hay en cada una (wa_chat_tags);
 * - mensajes programados pendientes (wa_scheduled; los de varios mensajes, separados), borradores (wa_drafts) y pospuestos activos (wa_snooze);
 * - memorias y fichas de cada persona (wa_memories, wa_profiles) como notas del chat;
 * - nombres de los chats (borradores, programados, el índice de búsqueda wa-cache/search.db y Desktop);
 * - mensajes guardados (wa_saved, wa_hist y Desktop), con la transcripción de los audios.
 *   Cada mensaje va con el id de WhatsApp: lo que ya trajo el servidor no se duplica.
 *
 * Qué no lleva: las contraseñas de Gmail (mail_accounts) ni archivos adjuntos.
 */
import { DatabaseSync } from 'node:sqlite';
import { closeSync, existsSync, openSync, writeSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith('--'));
const flag = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : def;
};
if (!dir) {
  console.error('Uso: node scripts/inbox-zero-export.mjs <carpeta de inbox-zero> [--desktop[=ruta]] [--out archivo.ndjson] [--days 0] [--no-messages]');
  process.exit(1);
}
const dbPath = join(resolve(dir), 'inbox.db');
if (!existsSync(dbPath)) {
  console.error(`No encuentro ${dbPath}`);
  process.exit(1);
}
const out = flag('--out', 'inbox-zero-export.ndjson');
const ndjson = !out.toLowerCase().endsWith('.json');
const days = Number(flag('--days', '0'));
const withMessages = !args.includes('--no-messages');
const desktopArg = args.find((a) => a === '--desktop' || a.startsWith('--desktop='));
const desktopPath = desktopArg
  ? desktopArg.includes('=')
    ? resolve(desktopArg.slice('--desktop='.length))
    : join(homedir(), 'Library/Group Containers/group.net.whatsapp.WhatsApp.shared/ChatStorage.sqlite')
  : null;
if (desktopPath && !existsSync(desktopPath)) {
  console.error(`No encuentro la base de WhatsApp Desktop en ${desktopPath}`);
  process.exit(1);
}
const sinceSec = days > 0 ? Math.floor(Date.now() / 1000) - days * 86400 : 0;

const db = new DatabaseSync(dbPath, { readOnly: true });
const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name));
const all = (table, sql) => (tables.has(table) ? db.prepare(sql).all() : []);
const columns = (table) => (tables.has(table) ? new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name)) : new Set());

const names = new Map();
const nameOf = (id, name) => {
  if (id && name && !names.has(id)) names.set(id, String(name));
};

// wa_tags: icon y parent_id llegaron después (ALTER TABLE): en bases viejas no están.
const tagCols = columns('wa_tags');
const folders = all('wa_tags', 'SELECT * FROM wa_tags ORDER BY position, id').map((t) => ({
  id: t.id,
  name: String(t.name ?? ''),
  color: String(t.color ?? ''),
  icon: tagCols.has('icon') ? String(t.icon ?? '') : '',
  position: Number(t.position ?? 0),
  parentId: tagCols.has('parent_id') ? (t.parent_id ?? null) : null,
}));
const chatFolders = all('wa_chat_tags', 'SELECT chat_id, tag_id FROM wa_chat_tags').map((r) => ({ chatId: r.chat_id, folderId: r.tag_id }));

// El texto de un programado de varios mensajes lleva el separador \u001e: Inbox lo parte en burbujas.
const scheduled = all('wa_scheduled', "SELECT * FROM wa_scheduled WHERE status = 'pending'").map((s) => {
  nameOf(s.chat_id, s.chat_name);
  return { chatId: s.chat_id, chatName: String(s.chat_name ?? ''), text: String(s.text ?? '').slice(0, 80000), sendAt: Number(s.send_at), status: 'pending' };
});
const drafts = all('wa_drafts', 'SELECT * FROM wa_drafts').map((d) => {
  nameOf(d.chat_id, d.chat_name);
  return { chatId: d.chat_id, chatName: String(d.chat_name ?? ''), text: String(d.text ?? '').slice(0, 32000) };
});
const snoozes = all('wa_snooze', 'SELECT chat_id, until FROM wa_snooze WHERE woke = 0').map((s) => ({ chatId: s.chat_id, until: Number(s.until) }));

const notesBy = new Map();
const addNote = (chatId, text) => {
  const t = String(text ?? '').trim();
  if (!t) return;
  notesBy.set(chatId, [...(notesBy.get(chatId) ?? []), t]);
};
for (const p of all('wa_profiles', 'SELECT chat_id, summary FROM wa_profiles')) addNote(p.chat_id, p.summary);
for (const m of all('wa_memories', 'SELECT chat_id, text FROM wa_memories ORDER BY created_at')) addNote(m.chat_id, m.text);
const notes = [...notesBy].map(([chatId, list]) => ({ chatId, text: list.join('\n\n').slice(0, 20000) }));

// Nombres del índice de búsqueda (jids de WhatsApp Desktop, mismo formato de teléfono).
const searchDb = join(resolve(dir), 'wa-cache', 'search.db');
if (existsSync(searchDb)) {
  try {
    const s = new DatabaseSync(searchDb, { readOnly: true });
    for (const r of s.prepare('SELECT jid, name FROM chat_names').all()) nameOf(String(r.jid).replace(/@s\.whatsapp\.net$/, '@c.us'), r.name);
    s.close();
  } catch {
    /* sin índice */
  }
}

// WhatsApp Desktop (Core Data): fechas en segundos desde 2001, tipos numéricos.
const APPLE_EPOCH = 978307200;
const DESK_TYPE = { 0: 'chat', 1: 'image', 2: 'video', 3: 'ptt', 4: 'vcard', 5: 'location', 7: 'chat', 8: 'document', 11: 'video', 15: 'sticker' };
let desk = null;
/** Chats archivados (WhatsApp Desktop: ZWACHATSESSION.ZARCHIVED = 1; el nombre del chat y su jid en el mismo formato de los mensajes). */
const archivedIds = new Set();
if (desktopPath) {
  desk = new DatabaseSync(desktopPath, { readOnly: true });
  try {
    for (const r of desk.prepare('SELECT ZCONTACTJID jid FROM ZWACHATSESSION WHERE ZARCHIVED = 1 AND ZCONTACTJID IS NOT NULL').all()) {
      const jid = String(r.jid);
      if (/@(s\.whatsapp\.net|g\.us)$/.test(jid)) archivedIds.add(jid.replace(/@s\.whatsapp\.net$/, '@c.us'));
    }
  } catch {
    /* otra versión de Desktop: sin columna de archivados */
  }
  try {
    for (const r of desk.prepare('SELECT ZCONTACTJID jid, ZPARTNERNAME name FROM ZWACHATSESSION WHERE ZCONTACTJID IS NOT NULL').all()) {
      if (/@(s\.whatsapp\.net|g\.us)$/.test(String(r.jid))) nameOf(String(r.jid).replace(/@s\.whatsapp\.net$/, '@c.us'), r.name);
    }
  } catch {
    /* otra versión de Desktop: sin nombres */
  }
}

/** Mensajes de todas las fuentes, sin repetir (por id de WhatsApp), del más viejo al más nuevo dentro de cada fuente. */
function* messageRows() {
  if (!withMessages) return;
  const transcripts = new Map(all('wa_transcripts', 'SELECT msg_id, text FROM wa_transcripts').map((r) => [r.msg_id, String(r.text ?? '')]));
  const seen = new Set();
  const stanza = (id) => {
    const web = /^(?:true|false)_[^_]+@[^_]+_([A-Za-z0-9]+)(?:_.*)?$/.exec(id);
    return web ? web[1] : id;
  };
  const row = (r) => {
    const id = String(r.id);
    const key = stanza(id);
    if (seen.has(key)) return null;
    seen.add(key);
    const tr = transcripts.get(id);
    if (!r.from_me && r.sender && !String(r.chat_id).endsWith('@g.us')) nameOf(String(r.chat_id), r.sender);
    return {
      id,
      chatId: String(r.chat_id),
      ts: Number(r.ts),
      fromMe: Boolean(r.from_me),
      sender: String(r.sender ?? '').slice(0, 200),
      type: String(r.type ?? 'chat').slice(0, 40),
      text: (String(r.text ?? '') + (tr ? `${r.text ? '\n' : ''}🎤 ${tr}` : '')).slice(0, 20000),
    };
  };
  for (const table of ['wa_saved', 'wa_hist']) {
    if (!tables.has(table)) continue;
    const idCol = table === 'wa_saved' ? 'msg_id' : 'id';
    for (const r of db.prepare(`SELECT ${idCol} AS id, chat_id, ts, from_me, sender, type, text FROM ${table} WHERE ts >= ? ORDER BY ts`).iterate(sinceSec)) {
      const m = row(r);
      if (m) yield m;
    }
  }
  if (desk) {
    const sql = `SELECT m.Z_PK pk, m.ZSTANZAID st, m.ZISFROMME fm, m.ZMESSAGEDATE dt, m.ZMESSAGETYPE ty, m.ZTEXT text, c.ZCONTACTJID jid,
        coalesce(gm.ZCONTACTNAME, gm.ZFIRSTNAME, m.ZPUSHNAME) sender, mi.ZTITLE title
      FROM ZWAMESSAGE m JOIN ZWACHATSESSION c ON c.Z_PK = m.ZCHATSESSION
      LEFT JOIN ZWAGROUPMEMBER gm ON gm.Z_PK = m.ZGROUPMEMBER
      LEFT JOIN ZWAMEDIAITEM mi ON mi.Z_PK = m.ZMEDIAITEM
      WHERE m.ZMESSAGETYPE NOT IN (6, 10, 14) AND (m.ZTEXT IS NOT NULL OR m.ZMESSAGETYPE IN (1,2,3,4,5,8,11,15)) AND m.ZMESSAGEDATE >= ?
      ORDER BY m.ZMESSAGEDATE`;
    for (const r of desk.prepare(sql).iterate(sinceSec ? sinceSec - APPLE_EPOCH : -1e12)) {
      const jid = String(r.jid ?? '');
      if (!/@(s\.whatsapp\.net|g\.us|lid)$/.test(jid)) continue;
      const type = DESK_TYPE[r.ty] ?? 'chat';
      const text = r.text ? String(r.text) : type === 'location' ? '📍 Ubicación' : type === 'vcard' ? '👤 Contacto' : type === 'document' && r.title ? String(r.title) : '';
      const m = row({ id: r.st ? String(r.st) : `desk:${r.pk}`, chat_id: jid.replace(/@s\.whatsapp\.net$/, '@c.us'), ts: Math.round(Number(r.dt) + APPLE_EPOCH), from_me: r.fm, sender: r.fm ? '' : r.sender, type, text });
      if (m) yield m;
    }
  }
}

/** Chats con mensajes (sin leer los mensajes): para que la línea de meta los lleve con nombre. */
function chatIdsWithMessages() {
  const ids = new Set();
  if (!withMessages) return ids;
  for (const table of ['wa_saved', 'wa_hist']) {
    if (tables.has(table)) for (const r of db.prepare(`SELECT DISTINCT chat_id FROM ${table} WHERE ts >= ?`).all(sinceSec)) ids.add(String(r.chat_id));
  }
  if (desk) {
    try {
      for (const r of desk.prepare('SELECT DISTINCT c.ZCONTACTJID jid FROM ZWACHATSESSION c WHERE c.ZCONTACTJID IS NOT NULL').all()) {
        const jid = String(r.jid);
        if (/@(s\.whatsapp\.net|g\.us)$/.test(jid)) ids.add(jid.replace(/@s\.whatsapp\.net$/, '@c.us'));
      }
    } catch {
      /* otra versión de Desktop */
    }
  }
  return ids;
}

const chatIds = new Set([
  ...archivedIds,
  ...chatFolders.map((c) => c.chatId),
  ...scheduled.map((s) => s.chatId),
  ...drafts.map((d) => d.chatId),
  ...snoozes.map((s) => s.chatId),
  ...notes.map((n) => n.chatId),
  ...chatIdsWithMessages(),
  ...names.keys(),
]);
const chats = () =>
  [...chatIds].slice(0, 20000).map((id) => ({ chatId: id, name: (names.get(id) ?? '').slice(0, 300), isGroup: id.endsWith('@g.us'), ...(archivedIds.has(id) ? { archived: true } : {}) }));
const meta = { format: 'inbox-zero-export', exportedAt: new Date().toISOString(), folders, chatFolders, chats: chats(), scheduled, drafts, snoozes, notes };

let total = 0;
if (ndjson) {
  // Una parte por línea: primero todo menos los mensajes, después tandas de hasta 500 mensajes y ~1 MB.
  const fd = openSync(out, 'w');
  const line = (obj) => writeSync(fd, `${JSON.stringify(obj)}\n`);
  line({ part: 'meta', version: 2, ...meta });
  let batch = [];
  let bytes = 0;
  const flush = () => {
    if (!batch.length) return;
    line({ part: 'messages', messages: batch });
    batch = [];
    bytes = 0;
  };
  for (const m of messageRows()) {
    const size = Buffer.byteLength(JSON.stringify(m));
    if (batch.length >= 500 || bytes + size > 1024 * 1024) flush();
    batch.push(m);
    bytes += size;
    total++;
  }
  flush();
  closeSync(fd);
} else {
  const messages = [...messageRows()];
  total = messages.length;
  const fd = openSync(out, 'w');
  writeSync(fd, JSON.stringify({ ...meta, version: 1, chats: chats(), messages }));
  closeSync(fd);
}
db.close();
desk?.close();
console.log(
  `Listo: ${out}\n  ${folders.length} carpetas, ${chatIds.size} chats, ${scheduled.length} programados, ${drafts.length} borradores, ${snoozes.length} pospuestos, ${notes.length} notas, ${total} mensajes${desktopPath ? ' (con WhatsApp Desktop)' : ''}`,
);
