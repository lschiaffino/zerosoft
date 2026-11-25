/**
 * Inbox y Lines: la misma persona con dos chats. WhatsApp identifica a cada
 * contacto por su teléfono ("<tel>@s.whatsapp.net") y, desde 2025, también por
 * un id anónimo ("<lid>@lid"). Evolution manda el teléfono aparte
 * (remoteJidAlt, senderPn) cuando lo tiene; cuando no, el chat llega con el lid.
 * Al desvincular y volver a vincular el número, el historial vuelve a llegar
 * entero y el mismo chat puede venir una vez por lid y otra por teléfono.
 *
 * Acá se juntan esos chats: el del lid ("perdedor") pasa al del teléfono
 * ("sobreviviente"), con sus mensajes, carpetas o etiquetas, notas, tickets,
 * tareas y lo que cuelgue del chat; un mensaje que ya está en el sobreviviente
 * (mismo id de WhatsApp) se borra del perdedor. Un mensaje sin repetido nunca se
 * borra. Si todavía no hay chat con el teléfono, el del lid pasa a tener el
 * teléfono como id.
 *
 * Dos señales dicen que un lid y un teléfono son la misma persona:
 * - la libreta (wa_contacts: Evolution mandó el par lid ↔ teléfono);
 * - un mensaje con el mismo id de WhatsApp en los dos chats (el id lo genera
 *   quien lo manda: dos personas distintas nunca comparten uno). También los
 *   propios: el eco de lo que mando llega muchas veces solo con el lid, sin el
 *   teléfono al lado, mientras el mensaje ya está en el chat del teléfono. Una
 *   lista de difusión llega con su propio id ("…@broadcast", que no se guarda),
 *   y un id que aparece en más de un chat por teléfono no cuenta. Los ids
 *   locales ("local-…", cuando el servidor no devolvió uno) nunca cuentan.
 *
 * Todo corre en una sola transacción por tanda (lib/db.ts dbBatch, o
 * client.batch en la migración) sobre la tabla wa_merge_pairs, con un id de
 * corrida: dos corridas a la vez no se pisan, y correrlo dos veces no hace nada
 * la segunda. Server-only.
 */
import type { BatchResult, BatchStatement } from './db';

export type WaApp = 'inbox' | 'lines';

/** Un candidato: el chat del lid y el teléfono que le corresponde (el sobreviviente se busca en la base). */
export interface LidPhone {
  lid: string;
  phone: string;
}

/** Un par ya resuelto (chat del lid → chat del teléfono). */
export interface ChatPair {
  loser: string;
  survivor: string;
  lid: string;
  phone: string;
}

/** Un mensaje visto en un chat: `key` es el id de WhatsApp. */
export interface MessageSighting {
  key: string;
  chatId: string;
  /** El id de WhatsApp del chat ("…@lid" o "…@s.whatsapp.net"). */
  jid: string;
  dm: boolean;
  inbound: boolean;
}

export interface MergeCounts {
  /** Chats del lid que se juntaron con el del teléfono (y se borraron). */
  merged: number;
  /** Chats del lid que pasaron a tener el teléfono como id (no había otro). */
  renamed: number;
  /** Mensajes repetidos que se borraron (estaban en los dos chats). */
  messages: number;
}

const PN = /^(\d{6,16})@s\.whatsapp\.net$/;
const LID = /^(\d{5,24})@lid$/;

export function newRunId(): string {
  return `wmr_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Pares lid ↔ teléfono por mensajes (recibidos o propios) que están en dos
 * chats 1:1 (uno por lid y otro por teléfono). Un chat del lid que aparece con
 * dos teléfonos distintos no se toca (no se sabe cuál es).
 */
export function twinPairs(rows: MessageSighting[]): ChatPair[] {
  const byKey = new Map<string, MessageSighting[]>();
  for (const r of rows) {
    if (!r.key || !r.dm || r.key.startsWith('local-')) continue;
    const list = byKey.get(r.key) ?? [];
    if (!list.some((x) => x.chatId === r.chatId)) list.push(r);
    byKey.set(r.key, list);
  }
  const found = new Map<string, ChatPair>();
  const ambiguous = new Set<string>();
  for (const list of byKey.values()) {
    const lids = list.filter((r) => LID.test(r.jid));
    const pns = list.filter((r) => PN.test(r.jid));
    if (lids.length !== 1 || pns.length !== 1) continue;
    const l = lids[0];
    const p = pns[0];
    const pair: ChatPair = { loser: l.chatId, survivor: p.chatId, lid: LID.exec(l.jid)![1], phone: PN.exec(p.jid)![1] };
    const prev = found.get(l.chatId);
    if (prev && prev.survivor !== pair.survivor) ambiguous.add(l.chatId);
    else found.set(l.chatId, pair);
  }
  return [...found.values()].filter((p) => !ambiguous.has(p.loser));
}

/** Pares lid ↔ teléfono únicos de una lista (un lid con dos teléfonos no cuenta). */
export function uniqueLidPhones(items: Array<{ lid?: string; phone?: string }>): LidPhone[] {
  const byLid = new Map<string, string>();
  const bad = new Set<string>();
  for (const it of items) {
    const lid = String(it.lid ?? '').replace(/\D/g, '');
    const phone = String(it.phone ?? '').replace(/\D/g, '');
    if (!lid || phone.length < 6 || phone.length > 16) continue;
    const prev = byLid.get(lid);
    if (prev && prev !== phone) bad.add(lid);
    else byLid.set(lid, phone);
  }
  return [...byLid].filter(([lid]) => !bad.has(lid)).map(([lid, phone]) => ({ lid, phone }));
}

// ---------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------

export const MERGE_PAIRS_DDL = `CREATE TABLE IF NOT EXISTS wa_merge_pairs (
  run TEXT NOT NULL,
  app TEXT NOT NULL,
  scope TEXT NOT NULL,
  loser TEXT NOT NULL,
  survivor TEXT,
  jid TEXT NOT NULL,
  phone TEXT NOT NULL,
  PRIMARY KEY (run, loser, jid)
)`;

/** Nombres genéricos que Lines le pone a un chat que solo tiene lid (lib/groups.ts LID_CHAT_NAME). */
const LINES_LID_NAMES = ['Contacto de WhatsApp', 'WhatsApp contact', 'Contato do WhatsApp'];

const T = { inbox: { chats: 'inbox_threads', scope: 'account_id', jid: 'external_id' }, lines: { chats: 'groups_chats', scope: 'number_id', jid: 'provider_chat_id' } } as const;

/** Candidatos de la libreta: chats 1:1 por lid cuyo lid ya tiene teléfono. `scope`: una cuenta o número; `lids`: solo esos. */
export function contactPairsInsert(app: WaApp, run: string, opts: { scope?: string; lids?: string[] } = {}): BatchStatement {
  const t = T[app];
  const args: Array<string> = [run, app];
  let where = `l.kind = 'dm' AND l.${t.jid} LIKE '%@lid'`;
  if (opts.scope) {
    where += ` AND l.${t.scope} = ?`;
    args.push(opts.scope);
  }
  if (opts.lids) {
    const jids = opts.lids.slice(0, 500).map((d) => `${d}@lid`);
    where += ` AND l.${t.jid} IN (${jids.map(() => '?').join(',') || "''"})`;
    args.push(...jids);
  }
  return {
    sql: `INSERT OR IGNORE INTO wa_merge_pairs (run, app, scope, loser, survivor, jid, phone)
      SELECT ?, ?, l.${t.scope}, l.id, NULL, c.phone || '@s.whatsapp.net', c.phone
      FROM ${t.chats} l
      JOIN wa_contacts c ON c.app = '${app}' AND c.account_id = l.${t.scope} AND c.lid = substr(l.${t.jid}, 1, length(l.${t.jid}) - 4) AND c.phone <> ''
      WHERE ${where}`,
    args,
  };
}

/**
 * Inbox: candidatos por mensajes repetidos (el mismo id en el chat del lid y
 * en el del teléfono). Usa idx_inbox_messages_owner_ext. Sin `own`, solo los
 * recibidos (como la migración de 20261114); con `own`, también los propios
 * (el eco de lo que mandé que llegó solo con el lid).
 */
export function inboxSharedPairsInsert(run: string, opts: { scope?: string; own?: boolean } = {}): BatchStatement {
  const args: string[] = [run];
  const lmOwn = opts.own ? "lm.external_id NOT LIKE 'local-%'" : 'lm.from_me = 0';
  const smOwn = opts.own ? '1 = 1' : 'sm.from_me = 0';
  let where = "l.kind = 'dm' AND l.external_id LIKE '%@lid'";
  if (opts.scope) {
    where += ' AND l.account_id = ?';
    args.push(opts.scope);
  }
  return {
    sql: `INSERT OR IGNORE INTO wa_merge_pairs (run, app, scope, loser, survivor, jid, phone)
      SELECT ?, 'inbox', l.account_id, l.id, MIN(s.id), MIN(s.external_id), substr(MIN(s.external_id), 1, instr(MIN(s.external_id), '@') - 1)
      FROM inbox_threads l
      JOIN inbox_messages lm ON lm.thread_id = l.id AND ${lmOwn}
      JOIN inbox_messages sm ON sm.owner_id = lm.owner_id AND sm.external_id = lm.external_id AND sm.thread_id <> lm.thread_id AND ${smOwn}
      JOIN inbox_threads s ON s.id = sm.thread_id AND s.account_id = l.account_id AND s.kind = 'dm' AND s.external_id LIKE '%@s.whatsapp.net'
      WHERE ${where}
      GROUP BY l.id
      HAVING COUNT(DISTINCT s.id) = 1`,
    args,
  };
}

/**
 * Inbox: candidatos por citas. Un mensaje del chat por lid que responde a uno
 * guardado en el chat de un teléfono (en un 1:1 solo se cita lo del mismo
 * chat): la misma persona. Solo si todas las citas del chat por lid apuntan a
 * un único chat por teléfono. Para el arreglo de una vez (lib/wa-dedupe-repair.ts).
 */
export function inboxQuotePairsInsert(run: string): BatchStatement {
  return {
    sql: `INSERT OR IGNORE INTO wa_merge_pairs (run, app, scope, loser, survivor, jid, phone)
      SELECT ?, 'inbox', l.account_id, l.id, MIN(s.id), MIN(s.external_id), substr(MIN(s.external_id), 1, instr(MIN(s.external_id), '@') - 1)
      FROM inbox_threads l
      JOIN inbox_messages lm ON lm.thread_id = l.id AND lm.reply_to <> '' AND lm.reply_to NOT LIKE 'local-%'
      JOIN inbox_messages sm ON sm.owner_id = lm.owner_id AND sm.external_id = lm.reply_to AND sm.thread_id <> lm.thread_id
      JOIN inbox_threads s ON s.id = sm.thread_id AND s.account_id = l.account_id AND s.kind = 'dm' AND s.external_id LIKE '%@s.whatsapp.net'
      WHERE l.kind = 'dm' AND l.external_id LIKE '%@lid'
      GROUP BY l.id
      HAVING COUNT(DISTINCT s.id) = 1`,
    args: [run],
  };
}

/** Pares ya conocidos (de una tanda): chat del lid → teléfono (y el sobreviviente si se sabe). */
export function explicitPairsInsert(app: WaApp, run: string, scope: string, pairs: Array<{ loser: string; survivor?: string | null; phone: string }>): BatchStatement[] {
  return pairs.slice(0, 500).map((p) => ({
    sql: 'INSERT OR IGNORE INTO wa_merge_pairs (run, app, scope, loser, survivor, jid, phone) VALUES (?, ?, ?, ?, ?, ?, ?)',
    args: [run, app, scope, p.loser, p.survivor ?? null, `${p.phone}@s.whatsapp.net`, p.phone],
  }));
}

/**
 * mediaFiles: mover también la copia guardada de los archivos de Inbox (inbox_media_files). Lo pide la corrida normal;
 * las migraciones viejas que juntan chats corren antes de que esa tabla exista y no lo piden.
 */
/** ¿Ya corrió la migración de carpetas del equipo? (durante un deploy por partes la tabla puede faltar). */
export const TEAM_FOLDERS_TABLE_SQL = "SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = 'groups_chat_team_folders'";

export interface MergeOptions {
  mediaFiles?: boolean;
  /** Pasar también groups_agent_conversations al chat que queda. Lo pide la corrida normal, como mediaFiles. */
  agentLinks?: boolean;
  /** Pasar también la carpeta de cada persona (groups_chat_folders) al chat que queda. Lo pide la corrida normal, como agentLinks. */
  chatFolders?: boolean;
  /**
   * Pasar también la carpeta del equipo (groups_chat_team_folders). Aparte de chatFolders: durante un deploy la tabla
   * puede no existir todavía, así que quien llama lo pide solo si ya está (TEAM_FOLDERS_TABLE_SQL).
   */
  teamFolders?: boolean;
  /** Inbox: pasar también el vínculo con el CRM (inbox_crm_links). Como teamFolders: solo si la tabla ya existe (INBOX_CRM_LINKS_TABLE_SQL). */
  crmLinks?: boolean;
}

/** ¿Ya existe la tabla de vínculos de Inbox con el CRM? (las limpiezas de migraciones viejas corren antes de crearla). */
export const INBOX_CRM_LINKS_TABLE_SQL = "SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = 'inbox_crm_links'";

/**
 * La corrida: después de los INSERT de candidatos, resuelve el sobreviviente,
 * renombra los que no tienen, junta el resto y limpia. Devuelve las
 * sentencias y en qué posición leer cada cuenta.
 */
export function mergeStatements(app: WaApp, run: string, opts: MergeOptions = {}): { stmts: BatchStatement[]; at: { renamed: number; messages: number; merged: number } } {
  const t = T[app];
  const P = `(SELECT loser FROM wa_merge_pairs WHERE run = '${run.replace(/'/g, '')}' AND survivor IS NOT NULL)`;
  const S = (col: string) => `(SELECT p.survivor FROM wa_merge_pairs p WHERE p.run = '${run.replace(/'/g, '')}' AND p.loser = ${col})`;
  const r = [run];
  const stmts: BatchStatement[] = [];
  const findSurvivor = `UPDATE wa_merge_pairs SET survivor = (SELECT c.id FROM ${t.chats} c WHERE c.${t.scope} = wa_merge_pairs.scope AND c.${t.jid} = wa_merge_pairs.jid AND c.id <> wa_merge_pairs.loser)
     WHERE run = ? AND survivor IS NULL`;
  // Un chat del lid con dos destinos distintos (dos teléfonos para el mismo lid): no se toca.
  stmts.push({
    sql: `DELETE FROM wa_merge_pairs WHERE run = ? AND loser IN (SELECT loser FROM wa_merge_pairs WHERE run = ? GROUP BY loser HAVING COUNT(DISTINCT jid) > 1)`,
    args: [run, run],
  });
  stmts.push({ sql: findSurvivor, args: r });
  // Sin chat con el teléfono: el del lid pasa a tenerlo como id (OR IGNORE: si otro lo tomó a la vez, se junta abajo).
  const renamed = stmts.length;
  if (app === 'inbox') {
    stmts.push({
      sql: `UPDATE OR IGNORE inbox_threads SET
          external_id = (SELECT p.jid FROM wa_merge_pairs p WHERE p.run = ? AND p.loser = inbox_threads.id),
          handle = CASE WHEN handle = '' THEN (SELECT p.phone FROM wa_merge_pairs p WHERE p.run = ? AND p.loser = inbox_threads.id) ELSE handle END
        WHERE id IN (SELECT loser FROM wa_merge_pairs WHERE run = ? AND survivor IS NULL)`,
      args: [run, run, run],
    });
  } else {
    const names = LINES_LID_NAMES.map(() => '?').join(',');
    stmts.push({
      sql: `UPDATE OR IGNORE groups_chats SET
          provider_chat_id = (SELECT p.jid FROM wa_merge_pairs p WHERE p.run = ? AND p.loser = groups_chats.id),
          phone = (SELECT p.phone FROM wa_merge_pairs p WHERE p.run = ? AND p.loser = groups_chats.id),
          name = CASE WHEN name = '' OR name IN (${names}) THEN COALESCE((
            SELECT CASE WHEN c.saved_name <> '' THEN c.saved_name ELSE c.push_name END FROM wa_contacts c
            WHERE c.app = 'lines' AND c.account_id = groups_chats.number_id AND c.lid = substr(groups_chats.provider_chat_id, 1, length(groups_chats.provider_chat_id) - 4)
              AND (c.saved_name <> '' OR c.push_name <> '')), name) ELSE name END
        WHERE id IN (SELECT loser FROM wa_merge_pairs WHERE run = ? AND survivor IS NULL)`,
      args: [run, run, ...LINES_LID_NAMES, run],
    });
  }
  // Los renombrados ya no son perdedores; los que chocaron (otro chat tomó el teléfono a la vez) buscan sobreviviente.
  stmts.push({ sql: `DELETE FROM wa_merge_pairs WHERE run = ? AND survivor IS NULL AND loser IN (SELECT id FROM ${t.chats} WHERE ${t.jid} = wa_merge_pairs.jid)`, args: r });
  stmts.push({ sql: findSurvivor, args: r });
  stmts.push({ sql: 'DELETE FROM wa_merge_pairs WHERE run = ? AND (survivor IS NULL OR survivor = loser)', args: r });
  // Un sobreviviente que es a su vez perdedor (no debería pasar: los perdedores son lids, los sobrevivientes teléfonos).
  stmts.push({ sql: 'DELETE FROM wa_merge_pairs WHERE run = ? AND survivor IN (SELECT loser FROM wa_merge_pairs WHERE run = ?)', args: [run, run] });

  let messages: number;
  if (app === 'inbox') {
    // Lo que la persona marcó en el repetido (destacado, reacciones) pasa al que queda. También la referencia del
    // archivo si la del repetido es mejor: la que trae la clave del archivo (llegó con el historial al volver a
    // vincular) se puede volver a bajar; la vieja, que es solo el id del mensaje, ya no. Si no, al juntar los chats se
    // borraba justo la copia que servía.
    const dup = (col: string) =>
      // Si dos chats perdedores tienen el mismo mensaje, primero la copia que trae la clave del archivo.
      `(SELECT l.${col} FROM inbox_messages l JOIN wa_merge_pairs p ON p.run = ? AND p.loser = l.thread_id AND p.survivor = inbox_messages.thread_id WHERE l.external_id = inbox_messages.external_id ORDER BY (l.media_ref LIKE '%"wire"%') DESC LIMIT 1)`;
    stmts.push({
      sql: `UPDATE inbox_messages SET
          starred_at = COALESCE(starred_at, ${dup('starred_at')}),
          reactions = CASE WHEN reactions = '' THEN COALESCE(${dup('reactions')}, '') ELSE reactions END,
          media_ref = CASE
            WHEN media_type <> '' AND media_ref NOT LIKE '%"wire"%' AND COALESCE(${dup('media_ref')}, '') LIKE '%"wire"%' THEN ${dup('media_ref')}
            WHEN media_type <> '' AND media_ref = '' THEN COALESCE(${dup('media_ref')}, '')
            ELSE media_ref END
        WHERE thread_id IN (SELECT survivor FROM wa_merge_pairs WHERE run = ?)
          AND external_id IN (SELECT l.external_id FROM inbox_messages l WHERE l.thread_id IN ${P} AND (l.starred_at IS NOT NULL OR l.reactions <> '' OR l.media_ref <> ''))`,
      args: [run, run, run, run, run, run],
    });
    // La transcripción hecha sobre el repetido (se guarda por id de mensaje) pasa al que queda. Gana la que está
    // hecha: si el que queda solo tiene un intento fallido (su audio ya no se podía bajar) y el repetido tiene la
    // transcripción, primero se saca el intento fallido.
    stmts.push({
      sql: `DELETE FROM wa_transcripts WHERE scope = 'inbox' AND status <> 'done' AND message_id IN (
            SELECT s.id FROM inbox_messages l
            JOIN wa_merge_pairs p ON p.run = ? AND p.loser = l.thread_id
            JOIN inbox_messages s ON s.thread_id = p.survivor AND s.external_id = l.external_id
            JOIN wa_transcripts lt ON lt.scope = 'inbox' AND lt.message_id = l.id AND lt.owner_id = wa_transcripts.owner_id AND lt.status = 'done')`,
      args: [run],
    });
    stmts.push({
      sql: `UPDATE OR IGNORE wa_transcripts SET message_id = (
            SELECT s.id FROM inbox_messages l
            JOIN wa_merge_pairs p ON p.run = ? AND p.loser = l.thread_id
            JOIN inbox_messages s ON s.thread_id = p.survivor AND s.external_id = l.external_id
            WHERE l.id = wa_transcripts.message_id)
        WHERE scope = 'inbox' AND message_id IN (
            SELECT l.id FROM inbox_messages l
            JOIN wa_merge_pairs p ON p.run = ? AND p.loser = l.thread_id
            JOIN inbox_messages s ON s.thread_id = p.survivor AND s.external_id = l.external_id)`,
      args: [run, run],
    });
    // La copia guardada del archivo (lib/inbox/media-store.ts) también pasa al que queda, si ese no tiene una; la que
    // no pasa queda huérfana y la borra el repaso horario.
    if (opts.mediaFiles) stmts.push({
      sql: `UPDATE OR IGNORE inbox_media_files SET message_id = (
            SELECT s.id FROM inbox_messages l
            JOIN wa_merge_pairs p ON p.run = ? AND p.loser = l.thread_id
            JOIN inbox_messages s ON s.thread_id = p.survivor AND s.external_id = l.external_id
            WHERE l.id = inbox_media_files.message_id)
        WHERE message_id IN (
            SELECT l.id FROM inbox_messages l
            JOIN wa_merge_pairs p ON p.run = ? AND p.loser = l.thread_id
            JOIN inbox_messages s ON s.thread_id = p.survivor AND s.external_id = l.external_id)`,
      args: [run, run],
    });
    // La que no pasó (el que queda ya tenía la suya) se va con el repetido.
    stmts.push({
      sql: `DELETE FROM wa_transcripts WHERE scope = 'inbox' AND message_id IN (
            SELECT l.id FROM inbox_messages l
            JOIN wa_merge_pairs p ON p.run = ? AND p.loser = l.thread_id
            JOIN inbox_messages s ON s.thread_id = p.survivor AND s.external_id = l.external_id)`,
      args: [run],
    });
    messages = stmts.length;
    // Solo los que tienen repetido en el sobreviviente (mismo id de WhatsApp).
    stmts.push({
      sql: `DELETE FROM inbox_messages WHERE thread_id IN ${P} AND EXISTS (
          SELECT 1 FROM inbox_messages s WHERE s.thread_id = ${S('inbox_messages.thread_id')} AND s.external_id = inbox_messages.external_id)`,
      args: [],
    });
    stmts.push({
      sql: `UPDATE inbox_messages SET client_id = NULL WHERE client_id IS NOT NULL AND thread_id IN ${P} AND EXISTS (
          SELECT 1 FROM inbox_messages s WHERE s.thread_id = ${S('inbox_messages.thread_id')} AND s.client_id = inbox_messages.client_id)`,
      args: [],
    });
    stmts.push({ sql: `UPDATE inbox_messages SET thread_id = ${S('inbox_messages.thread_id')} WHERE thread_id IN ${P}`, args: [] });
    stmts.push({ sql: `INSERT OR IGNORE INTO inbox_thread_folders (thread_id, folder_id) SELECT ${S('f.thread_id')}, f.folder_id FROM inbox_thread_folders f WHERE f.thread_id IN ${P}`, args: [] });
    stmts.push({ sql: `UPDATE inbox_scheduled SET thread_id = ${S('inbox_scheduled.thread_id')} WHERE thread_id IN ${P}`, args: [] });
    // El vínculo con el CRM (por chat y workspace): si el que queda ya tiene uno en ese workspace, queda el suyo.
    if (opts.crmLinks) stmts.push({ sql: `UPDATE OR IGNORE inbox_crm_links SET thread_id = ${S('inbox_crm_links.thread_id')} WHERE thread_id IN ${P}`, args: [] });
  } else {
    // En Lines el id de WhatsApp es único por número: el mismo mensaje no puede estar en los dos chats del mismo número.
    messages = stmts.length;
    stmts.push({
      sql: `DELETE FROM groups_messages WHERE chat_id IN ${P} AND provider_message_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM groups_messages s WHERE s.chat_id = ${S('groups_messages.chat_id')} AND s.provider_message_id = groups_messages.provider_message_id)`,
      args: [],
    });
    stmts.push({
      sql: `UPDATE groups_messages SET client_id = NULL WHERE client_id IS NOT NULL AND chat_id IN ${P} AND EXISTS (
          SELECT 1 FROM groups_messages s WHERE s.chat_id = ${S('groups_messages.chat_id')} AND s.client_id = groups_messages.client_id)`,
      args: [],
    });
    stmts.push({ sql: `UPDATE groups_messages SET chat_id = ${S('groups_messages.chat_id')} WHERE chat_id IN ${P}`, args: [] });
    stmts.push({
      sql: `INSERT OR IGNORE INTO groups_members (chat_id, phone, name, role, created_at) SELECT ${S('m.chat_id')}, m.phone, m.name, m.role, m.created_at FROM groups_members m WHERE m.chat_id IN ${P}`,
      args: [],
    });
    stmts.push({ sql: `INSERT OR IGNORE INTO groups_chat_labels (chat_id, label_id) SELECT ${S('x.chat_id')}, x.label_id FROM groups_chat_labels x WHERE x.chat_id IN ${P}`, args: [] });
    // La carpeta de cada persona: si ya tiene el sobreviviente en una, queda esa (clave persona + chat). La tabla es
    // posterior a las migraciones que corren esta limpieza: solo cuando se pide.
    if (opts.chatFolders) stmts.push({
      sql: `INSERT OR IGNORE INTO groups_chat_folders (user_id, person_id, chat_id, folder_id, created_at) SELECT x.user_id, x.person_id, ${S('x.chat_id')}, x.folder_id, x.created_at FROM groups_chat_folders x WHERE x.chat_id IN ${P}`,
      args: [],
    });
    // La carpeta del equipo (una por chat): si el sobreviviente ya está en una, queda esa. Solo si la tabla ya existe.
    if (opts.teamFolders) stmts.push({
      sql: `INSERT OR IGNORE INTO groups_chat_team_folders (user_id, chat_id, folder_id, created_by, created_at) SELECT x.user_id, ${S('x.chat_id')}, x.folder_id, x.created_by, x.created_at FROM groups_chat_team_folders x WHERE x.chat_id IN ${P}`,
      args: [],
    });
    // agentLinks: de qué chat nació cada conversación de Agents (la tabla es posterior a las migraciones que corren esta limpieza).
    for (const table of ['groups_tickets', 'groups_tasks', 'groups_audit', 'groups_notifications', 'groups_import_chats', ...(opts.agentLinks ? ['groups_agent_conversations'] : [])]) {
      stmts.push({ sql: `UPDATE ${table} SET chat_id = ${S(`${table}.chat_id`)} WHERE chat_id IN ${P}`, args: [] });
    }
    // Con clave por chat: si el sobreviviente ya tiene la suya, queda la suya (la del perdedor se va con él).
    for (const table of ['groups_broadcast_recipients', 'groups_hubspot_links', 'groups_hubspot_notes']) {
      stmts.push({ sql: `UPDATE OR IGNORE ${table} SET chat_id = ${S(`${table}.chat_id`)} WHERE chat_id IN ${P}`, args: [] });
    }
    // Envíos recurrentes: la lista de chats es JSON.
    stmts.push({
      sql: `UPDATE groups_recurring SET chat_ids = (
          SELECT REPLACE(groups_recurring.chat_ids, '"' || p.loser || '"', '"' || p.survivor || '"') FROM wa_merge_pairs p
          WHERE p.run = ? AND p.survivor IS NOT NULL AND instr(groups_recurring.chat_ids, '"' || p.loser || '"') > 0 LIMIT 1)
        WHERE EXISTS (SELECT 1 FROM wa_merge_pairs p WHERE p.run = ? AND p.survivor IS NOT NULL AND instr(groups_recurring.chat_ids, '"' || p.loser || '"') > 0)`,
      args: [run, run],
    });
  }
  // Huecos del historial, pedidos de historial y archivado pendiente del chat.
  stmts.push({ sql: `UPDATE wa_history_gaps SET chat_id = ${S('wa_history_gaps.chat_id')} WHERE app = '${app}' AND chat_id IN ${P}`, args: [] });
  for (const table of ['wa_history_fetch', 'wa_archive_push']) {
    stmts.push({ sql: `UPDATE OR IGNORE ${table} SET chat_id = ${S(`${table}.chat_id`)} WHERE app = '${app}' AND chat_id IN ${P}`, args: [] });
    stmts.push({ sql: `DELETE FROM ${table} WHERE app = '${app}' AND chat_id IN ${P}`, args: [] });
  }
  stmts.push(app === 'inbox' ? inboxThreadUpdate(run) : linesChatUpdate(run));
  const merged = stmts.length;
  stmts.push({ sql: `DELETE FROM ${t.chats} WHERE id IN ${P}`, args: [] });
  stmts.push({ sql: 'DELETE FROM wa_merge_pairs WHERE run = ?', args: r });
  return { stmts, at: { renamed, messages, merged } };
}

/** El sobreviviente se queda con lo suyo y completa lo que le falta con lo del perdedor. */
function inboxThreadUpdate(run: string): BatchStatement {
  const newer = '(l.last_message_at IS NOT NULL AND (s.last_message_at IS NULL OR l.last_message_at > s.last_message_at))';
  return {
    sql: `UPDATE inbox_threads AS s SET
        title = CASE WHEN (s.title = '' OR s.title = s.handle) AND l.title <> '' AND l.title <> l.handle AND l.title NOT LIKE '%@lid' THEN l.title ELSE s.title END,
        avatar_url = CASE WHEN s.avatar_url = '' THEN l.avatar_url ELSE s.avatar_url END,
        info = CASE WHEN s.info = '' THEN l.info ELSE s.info END,
        notes = CASE WHEN s.notes = '' THEN l.notes WHEN l.notes = '' OR l.notes = s.notes THEN s.notes ELSE s.notes || char(10) || char(10) || l.notes END,
        draft = CASE WHEN s.draft = '' THEN l.draft ELSE s.draft END,
        summary = CASE WHEN s.summary = '' THEN l.summary ELSE s.summary END,
        unread = s.unread + l.unread,
        pinned_at = COALESCE(s.pinned_at, l.pinned_at),
        follow_up_at = COALESCE(s.follow_up_at, l.follow_up_at),
        muted_until = CASE WHEN l.muted_until IS NOT NULL AND (s.muted_until IS NULL OR l.muted_until > s.muted_until) THEN l.muted_until ELSE s.muted_until END,
        preview = CASE WHEN ${newer} THEN l.preview ELSE s.preview END,
        last_from_me = CASE WHEN ${newer} THEN l.last_from_me ELSE s.last_from_me END,
        last_sender = CASE WHEN ${newer} THEN l.last_sender ELSE s.last_sender END,
        last_kind = CASE WHEN ${newer} THEN l.last_kind ELSE s.last_kind END,
        last_status = CASE WHEN ${newer} THEN l.last_status ELSE s.last_status END,
        last_message_at = CASE WHEN ${newer} THEN l.last_message_at ELSE s.last_message_at END,
        last_inbound_at = CASE WHEN l.last_inbound_at IS NOT NULL AND (s.last_inbound_at IS NULL OR l.last_inbound_at > s.last_inbound_at) THEN l.last_inbound_at ELSE s.last_inbound_at END,
        last_outbound_at = CASE WHEN l.last_outbound_at IS NOT NULL AND (s.last_outbound_at IS NULL OR l.last_outbound_at > s.last_outbound_at) THEN l.last_outbound_at ELSE s.last_outbound_at END,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM inbox_threads AS l JOIN wa_merge_pairs p ON p.run = ? AND p.loser = l.id
      WHERE s.id = p.survivor`,
    args: [run],
  };
}

function linesChatUpdate(run: string): BatchStatement {
  const names = LINES_LID_NAMES.map((n) => `'${n}'`).join(',');
  const newer = '(l.last_message_at IS NOT NULL AND (s.last_message_at IS NULL OR l.last_message_at > s.last_message_at))';
  return {
    sql: `UPDATE groups_chats AS s SET
        name = CASE WHEN (s.name = '' OR s.name IN (${names})) AND l.name <> '' AND l.name NOT IN (${names}) THEN l.name ELSE s.name END,
        description = CASE WHEN s.description = '' THEN l.description ELSE s.description END,
        picture_url = CASE WHEN s.picture_url = '' THEN l.picture_url ELSE s.picture_url END,
        assigned_to = COALESCE(s.assigned_to, l.assigned_to),
        assigned_team_id = COALESCE(s.assigned_team_id, l.assigned_team_id),
        folder_id = COALESCE(s.folder_id, l.folder_id),
        crm_contact_id = COALESCE(s.crm_contact_id, l.crm_contact_id),
        crm_company_id = COALESCE(s.crm_company_id, l.crm_company_id),
        agent_id = COALESCE(s.agent_id, l.agent_id),
        agent_conversation_id = COALESCE(s.agent_conversation_id, l.agent_conversation_id),
        properties = CASE WHEN json_valid(s.properties) AND json_valid(l.properties) THEN json_patch(l.properties, s.properties) ELSE s.properties END,
        unread_count = s.unread_count + l.unread_count,
        marked_unread = MAX(s.marked_unread, l.marked_unread),
        pinned_at = COALESCE(s.pinned_at, l.pinned_at),
        flagged_at = COALESCE(s.flagged_at, l.flagged_at),
        awaiting_since = CASE WHEN s.awaiting_since IS NULL THEN l.awaiting_since WHEN l.awaiting_since IS NULL THEN s.awaiting_since ELSE MIN(s.awaiting_since, l.awaiting_since) END,
        muted_until = CASE WHEN l.muted_until IS NOT NULL AND (s.muted_until IS NULL OR l.muted_until > s.muted_until) THEN l.muted_until ELSE s.muted_until END,
        hidden_at = CASE WHEN s.hidden_at IS NULL OR l.hidden_at IS NULL THEN NULL ELSE s.hidden_at END,
        status = CASE WHEN s.status = 'open' OR l.status = 'open' THEN 'open' ELSE s.status END,
        last_message_preview = CASE WHEN ${newer} THEN l.last_message_preview ELSE s.last_message_preview END,
        last_message_at = CASE WHEN ${newer} THEN l.last_message_at ELSE s.last_message_at END,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM groups_chats AS l JOIN wa_merge_pairs p ON p.run = ? AND p.loser = l.id
      WHERE s.id = p.survivor`,
    args: [run],
  };
}

/** Cuentas de una corrida a partir de los resultados del batch (inserts de candidatos primero). */
export function countsOf(results: Array<Pick<BatchResult, 'changes'>>, offset: number, at: { renamed: number; messages: number; merged: number }): MergeCounts {
  return {
    renamed: results[offset + at.renamed]?.changes ?? 0,
    messages: results[offset + at.messages]?.changes ?? 0,
    merged: results[offset + at.merged]?.changes ?? 0,
  };
}

/**
 * Una corrida completa con el ejecutor que haya (dbBatch en la app,
 * client.batch en la migración): candidatos, resolución y limpieza en una
 * sola transacción.
 */
export async function runMerge(
  app: WaApp,
  inserts: (run: string) => BatchStatement[],
  batch: (stmts: BatchStatement[]) => Promise<Array<Pick<BatchResult, 'changes'>>>,
  opts: MergeOptions = {},
): Promise<MergeCounts> {
  const run = newRunId();
  const head = inserts(run);
  if (!head.length) return { merged: 0, renamed: 0, messages: 0 };
  const { stmts, at } = mergeStatements(app, run, opts);
  const res = await batch([{ sql: MERGE_PAIRS_DDL, args: [] }, ...head, ...stmts]);
  return countsOf(res, 1 + head.length, at);
}

/**
 * Cuántos chats por lid quedan (y cuántos tienen teléfono en la libreta) y cuántos mensajes de un chat por lid
 * tienen copia en el del teléfono. Para el log de la limpieza: se leen en un batch 'write' (contra la base
 * principal, no una réplica que puede venir atrasada).
 */
export const DEDUPE_COUNTS: Array<[string, string]> = [
  ['inboxLidChats', "SELECT COUNT(*) AS n FROM inbox_threads WHERE kind = 'dm' AND external_id LIKE '%@lid'"],
  [
    'inboxLidChatsWithPhone',
    `SELECT COUNT(*) AS n FROM inbox_threads l JOIN wa_contacts c ON c.app = 'inbox' AND c.account_id = l.account_id
       AND c.lid = substr(l.external_id, 1, length(l.external_id) - 4) AND c.phone <> ''
     WHERE l.kind = 'dm' AND l.external_id LIKE '%@lid'`,
  ],
  [
    'inboxDupMessages',
    `SELECT COUNT(*) AS n FROM inbox_threads l JOIN inbox_messages lm ON lm.thread_id = l.id
     WHERE l.kind = 'dm' AND l.external_id LIKE '%@lid' AND EXISTS (
       SELECT 1 FROM inbox_messages sm JOIN inbox_threads s ON s.id = sm.thread_id
       WHERE sm.owner_id = lm.owner_id AND sm.external_id = lm.external_id AND s.account_id = l.account_id AND s.kind = 'dm' AND s.external_id LIKE '%@s.whatsapp.net')`,
  ],
  ['linesLidChats', "SELECT COUNT(*) AS n FROM groups_chats WHERE kind = 'dm' AND provider_chat_id LIKE '%@lid'"],
  [
    'linesLidChatsWithPhone',
    `SELECT COUNT(*) AS n FROM groups_chats l JOIN wa_contacts c ON c.app = 'lines' AND c.account_id = l.number_id
       AND c.lid = substr(l.provider_chat_id, 1, length(l.provider_chat_id) - 4) AND c.phone <> ''
     WHERE l.kind = 'dm' AND l.provider_chat_id LIKE '%@lid'`,
  ],
];
