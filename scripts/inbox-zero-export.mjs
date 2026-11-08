#!/usr/bin/env node
/**
 * Exporta lo que guarda la app local "inbox-zero" para importarlo en Inbox
 * (zerosoft › Inbox › Ajustes › Importar). Solo lee: abre las bases en modo
 * lectura y escribe un JSON.
 *
 * Uso (Node 22.13 o más nuevo, sin dependencias):
 *   node scripts/inbox-zero-export.mjs <carpeta de inbox-zero> [--out inbox-zero-export.json] [--days 365] [--no-messages]
 *
 * Qué lleva:
 * - carpetas (wa_tags, con color, ícono, orden y subcarpetas) y qué chats hay en cada una (wa_chat_tags);
 * - mensajes programados pendientes (wa_scheduled), borradores (wa_drafts) y pospuestos activos (wa_snooze);
 * - memorias y fichas de cada persona (wa_memories, wa_profiles) como notas del chat;
 * - nombres de los chats (borradores, programados y el índice de búsqueda wa-cache/search.db);
 * - mensajes guardados (wa_saved y wa_hist) de los últimos --days días, con la transcripción de los audios.
 *
 * Qué no lleva: las contraseñas de Gmail (mail_accounts) ni archivos adjuntos.
 */
import { DatabaseSync } from 'node:sqlite';
import { existsSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith('--'));
const flag = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
if (!dir) {
  console.error('Uso: node scripts/inbox-zero-export.mjs <carpeta de inbox-zero> [--out archivo.json] [--days 365] [--no-messages]');
  process.exit(1);
}
const dbPath = join(resolve(dir), 'inbox.db');
if (!existsSync(dbPath)) {
  console.error(`No encuentro ${dbPath}`);
  process.exit(1);
}
const out = flag('--out', 'inbox-zero-export.json');
const days = Number(flag('--days', '365'));
const withMessages = !args.includes('--no-messages');

const db = new DatabaseSync(dbPath, { readOnly: true });
const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name));
const all = (table, sql) => (tables.has(table) ? db.prepare(sql).all() : []);

const names = new Map();
const nameOf = (id, name) => {
  if (id && name && !names.has(id)) names.set(id, String(name));
};

const folders = all('wa_tags', 'SELECT * FROM wa_tags ORDER BY position, id').map((t) => ({
  id: t.id,
  name: String(t.name ?? ''),
  color: String(t.color ?? ''),
  icon: String(t.icon ?? ''),
  position: Number(t.position ?? 0),
  parentId: t.parent_id ?? null,
}));
const chatFolders = all('wa_chat_tags', 'SELECT chat_id, tag_id FROM wa_chat_tags').map((r) => ({ chatId: r.chat_id, folderId: r.tag_id }));

const scheduled = all('wa_scheduled', "SELECT * FROM wa_scheduled WHERE status = 'pending'").map((s) => {
  nameOf(s.chat_id, s.chat_name);
  return { chatId: s.chat_id, chatName: String(s.chat_name ?? ''), text: String(s.text ?? ''), sendAt: Number(s.send_at), status: 'pending' };
});
const drafts = all('wa_drafts', 'SELECT * FROM wa_drafts').map((d) => {
  nameOf(d.chat_id, d.chat_name);
  return { chatId: d.chat_id, chatName: String(d.chat_name ?? ''), text: String(d.text ?? '') };
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

let messages = [];
if (withMessages) {
  const since = Math.floor(Date.now() / 1000) - days * 86400;
  const transcripts = new Map(all('wa_transcripts', 'SELECT msg_id, text FROM wa_transcripts').map((r) => [r.msg_id, String(r.text ?? '')]));
  const seen = new Set();
  const push = (r) => {
    if (seen.has(r.id)) return;
    seen.add(r.id);
    const tr = transcripts.get(r.id);
    messages.push({
      id: String(r.id),
      chatId: String(r.chat_id),
      ts: Number(r.ts),
      fromMe: Boolean(r.from_me),
      sender: String(r.sender ?? ''),
      type: String(r.type ?? 'chat'),
      text: String(r.text ?? '') + (tr ? `${r.text ? '\n' : ''}🎤 ${tr}` : ''),
    });
    if (!r.from_me && r.sender && !String(r.chat_id).endsWith('@g.us')) nameOf(r.chat_id, r.sender);
  };
  for (const r of tables.has('wa_saved') ? db.prepare('SELECT msg_id AS id, chat_id, ts, from_me, sender, type, text FROM wa_saved WHERE ts >= ?').all(since) : []) push(r);
  for (const r of tables.has('wa_hist') ? db.prepare('SELECT id, chat_id, ts, from_me, sender, type, text FROM wa_hist WHERE ts >= ?').all(since) : []) push(r);
  messages.sort((a, b) => a.ts - b.ts);
}

const chatIds = new Set([...chatFolders.map((c) => c.chatId), ...scheduled.map((s) => s.chatId), ...drafts.map((d) => d.chatId), ...snoozes.map((s) => s.chatId), ...notes.map((n) => n.chatId), ...messages.map((m) => m.chatId), ...names.keys()]);
const chats = [...chatIds].map((id) => ({ chatId: id, name: names.get(id) ?? '', isGroup: id.endsWith('@g.us') }));

const data = { format: 'inbox-zero-export', version: 1, exportedAt: new Date().toISOString(), folders, chatFolders, chats, scheduled, drafts, snoozes, notes, messages };
writeFileSync(out, JSON.stringify(data));
db.close();
console.log(
  `Listo: ${out}\n  ${folders.length} carpetas, ${chats.length} chats, ${scheduled.length} programados, ${drafts.length} borradores, ${snoozes.length} pospuestos, ${notes.length} notas, ${messages.length} mensajes`,
);
