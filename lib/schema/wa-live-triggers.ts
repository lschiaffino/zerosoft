/**
 * Inbox y Lines: triggers que anotan en wa_live_events cada cambio de un chat
 * que mueve la lista (mensaje nuevo, archivar, leído, fijar, posponer…). El
 * stream de lib/wa-live.ts los reparte a las pantallas abiertas, que releen
 * la lista por sus rutas de siempre. Solo ids: nada del contenido.
 *
 * También "escribiendo…" (la columna presence) y la foto y los datos del chat
 * (el asunto de un grupo), solo cuando cambian. Lo que no se ve en la lista
 * (la hora de la presencia, borradores, notas) no avisa.
 */

const changed = (cols: string[]) => cols.map((c) => `OLD.${c} IS NOT NEW.${c}`).join(' OR ');

const INBOX_COLS = ['archived_at', 'last_message_at', 'unread', 'done_at', 'snoozed_until', 'pinned_at', 'muted_until', 'woke_at', 'title', 'preview', 'last_status', 'presence', 'avatar_url', 'info'];
const LINES_COLS = [
  'archived_at',
  'last_message_at',
  'unread_count',
  'marked_unread',
  'pinned_at',
  'hidden_at',
  'status',
  'assigned_to',
  'assigned_team_id',
  'folder_id',
  'name',
  'muted_until',
  'flagged_at',
  'awaiting_since',
  'last_message_preview',
  'presence',
  'picture_url',
];

const inboxNote = (row: 'NEW' | 'OLD') => `INSERT INTO wa_live_events (app, scope_id, chat_id) VALUES ('inbox', ${row}.owner_id, ${row}.id);`;
const linesNote = (row: 'NEW' | 'OLD') => `INSERT INTO wa_live_events (app, scope_id, chat_id, number_id) VALUES ('lines', ${row}.user_id, ${row}.id, ${row}.number_id);`;

export const WA_LIVE_TRIGGERS: Array<[string, string]> = [
  ['wa_live_inbox_ins', `AFTER INSERT ON inbox_threads BEGIN ${inboxNote('NEW')} END`],
  ['wa_live_inbox_upd', `AFTER UPDATE ON inbox_threads WHEN ${changed(INBOX_COLS)} BEGIN ${inboxNote('NEW')} END`],
  ['wa_live_inbox_del', `AFTER DELETE ON inbox_threads BEGIN ${inboxNote('OLD')} END`],
  ['wa_live_lines_ins', `AFTER INSERT ON groups_chats BEGIN ${linesNote('NEW')} END`],
  ['wa_live_lines_upd', `AFTER UPDATE ON groups_chats WHEN ${changed(LINES_COLS)} BEGIN ${linesNote('NEW')} END`],
  ['wa_live_lines_del', `AFTER DELETE ON groups_chats BEGIN ${linesNote('OLD')} END`],
];
