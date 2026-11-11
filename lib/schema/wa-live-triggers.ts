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

/**
 * El chat abierto (migración 394_wa_live_messages): lo que cambia en un mensaje
 * sin mover la lista (las tildes de un mensaje que no es el último, una
 * reacción, una edición, un borrado, el archivo que terminó de bajar, el voto
 * de una encuesta) y una nota interna o un aviso del sistema. Con esto el chat
 * abierto se relee cuando algo cambió en vez de cada pocos segundos.
 *
 * Un mensaje nuevo (entrante o saliente) ya avisa por su chat (arriba), así
 * que no se anota dos veces. Borrar filas no avisa: borrar un chat borra todos
 * sus mensajes y anotaría uno por cada uno.
 */
const LINES_MSG_COLS = ['status', 'body', 'reactions', 'deleted_at', 'edited_at', 'pinned_at', 'media_url', 'error'];
const INBOX_MSG_COLS = ['status', 'body', 'edited', 'revoked_at', 'reactions', 'starred_at'];

const linesMsgNote = `INSERT INTO wa_live_events (app, scope_id, chat_id, number_id) VALUES ('lines', NEW.user_id, NEW.chat_id, NEW.number_id);`;
const inboxMsgNote = `INSERT INTO wa_live_events (app, scope_id, chat_id) VALUES ('inbox', NEW.owner_id, NEW.thread_id);`;
const voteNote = `INSERT INTO wa_live_events (app, scope_id, chat_id, number_id) SELECT 'lines', m.user_id, m.chat_id, m.number_id FROM groups_messages m WHERE m.id = NEW.message_id;`;
/** Solo lo de recién: importar el historial no anota una fila por mensaje viejo. */
const RECENT = `NEW.created_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-10 minutes')`;

export const WA_LIVE_MESSAGE_TRIGGERS: Array<[string, string]> = [
  ['wa_live_lines_msg_upd', `AFTER UPDATE ON groups_messages WHEN ${changed(LINES_MSG_COLS)} BEGIN ${linesMsgNote} END`],
  ['wa_live_lines_msg_note', `AFTER INSERT ON groups_messages WHEN NEW.direction NOT IN ('in', 'out') AND ${RECENT} BEGIN ${linesMsgNote} END`],
  ['wa_live_lines_vote_ins', `AFTER INSERT ON groups_poll_votes BEGIN ${voteNote} END`],
  ['wa_live_lines_vote_upd', `AFTER UPDATE ON groups_poll_votes WHEN OLD.options IS NOT NEW.options BEGIN ${voteNote} END`],
  ['wa_live_inbox_msg_upd', `AFTER UPDATE ON inbox_messages WHEN ${changed(INBOX_MSG_COLS)} BEGIN ${inboxMsgNote} END`],
];
