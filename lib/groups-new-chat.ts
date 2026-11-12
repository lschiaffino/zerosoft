/**
 * Lines, "Chat nuevo": buscar a quién escribirle en una línea y abrir (o
 * crear) el chat 1:1 con un teléfono. Server-only.
 *
 * - Acceso: la ruta ya comprobó que la persona ve la línea (lineGuard). Acá se
 *   aplica el resto: quien solo ve sus chats (acceso por etiqueta, invitados)
 *   busca entre esos chats y no en la libreta de la línea; con los teléfonos
 *   ocultos, la búsqueda es por nombre y el teléfono sale enmascarado.
 * - El chat nuevo nace fuera de la lista (hidden_at), como en WhatsApp: entra
 *   cuando sale o llega el primer mensaje (touchChat). No dispara el evento de
 *   "chat nuevo" ni manda nada a WhatsApp.
 * - Un mismo contacto puede tener el chat guardado con su teléfono
 *   ("@s.whatsapp.net", "@c.us", o solo dígitos en la Cloud API) o con su lid
 *   ("@lid"): se busca en todos antes de crear.
 */
import { getDb } from './db';
import { GroupsError, getNumberRow, providerFor, upsertChat, type ChatRow, type NumberRow } from './groups';
import { canSeeChat, chatAccessSql, maskPhone, type GroupsViewer } from './groups-access';
import { parseNewChatPhone } from './groups-new-chat-shared';
import { displayName, lookupContacts } from './wa-contacts';

export const NEW_CHAT_SEARCH_LIMIT = 20;
const CHAT_ROWS = 12;

export interface NewChatResult {
  /** Clave de la fila. */
  key: string;
  /** Chat que ya existe en la línea: se abre directo. */
  chatId?: string;
  /** Contacto de la libreta sin chat a la vista: se abre con POST { contactId }. */
  contactId?: string;
  name: string;
  /** Teléfono para mostrar ("+549…", o enmascarado para quien no los ve). */
  phoneLabel: string;
  /** Dígitos del teléfono; vacío para quien tiene los teléfonos ocultos. */
  phone: string;
  pictureUrl: string;
}

const likeArg = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/**
 * A quién escribirle desde una línea: chats 1:1 que la persona ve y contactos
 * de la libreta de esa línea, por nombre o teléfono. Sin texto, los chats más
 * recientes. Hasta 20 filas; las dos consultas quedan dentro de la línea.
 */
export async function searchNewChat(viewer: GroupsViewer, numberId: string, rawQuery: string): Promise<NewChatResult[]> {
  const db = getDb();
  const q = String(rawQuery ?? '').trim().slice(0, 80);
  const digits = /^\+?[\d\s().-]+$/.test(q) ? q.replace(/\D/g, '') : '';
  // Con los teléfonos ocultos no se busca por teléfono: daría un modo de adivinarlos.
  const byPhone = !viewer.mask && digits.length >= 3;
  const label = (phone: string) => (phone ? (viewer.mask ? maskPhone(phone) : `+${phone}`) : '');
  const out: NewChatResult[] = [];
  const seen = new Set<string>();

  const where = ['c.user_id = ?', 'c.number_id = ?', "c.kind = 'dm'", 'c.hidden_at IS NULL'];
  const args: Array<string | number> = [viewer.ws, numberId];
  const access = chatAccessSql(viewer, 'c');
  if (access) {
    where.push(access.sql);
    args.push(...access.args);
  }
  if (q) {
    where.push(byPhone ? "(c.name LIKE ? ESCAPE '\\' OR c.phone LIKE ? ESCAPE '\\')" : "c.name LIKE ? ESCAPE '\\'");
    args.push(likeArg(q));
    if (byPhone) args.push(likeArg(digits));
  }
  const chats = (await db
    .prepare(
      `SELECT c.id, c.name, c.phone, c.picture_url FROM groups_chats c WHERE ${where.join(' AND ')}
       ORDER BY c.last_message_at DESC LIMIT ?`,
    )
    .all(...args, q ? CHAT_ROWS : NEW_CHAT_SEARCH_LIMIT)) as Array<{ id: string; name: string; phone: string; picture_url: string | null }>;
  for (const c of chats) {
    if (c.phone) seen.add(c.phone);
    out.push({ key: `chat:${c.id}`, chatId: c.id, name: c.name || label(c.phone), phoneLabel: label(c.phone), phone: viewer.mask ? '' : c.phone, pictureUrl: c.picture_url ?? '' });
  }

  // La libreta de la línea: solo para quien ve todos los chats de la línea, y con al menos dos letras.
  if (!viewer.restricted && q.length >= 2) {
    const like = likeArg(q);
    const rows = (await db
      .prepare(
        `SELECT id, phone, saved_name, push_name, picture_url FROM wa_contacts
         WHERE app = 'lines' AND account_id = ? AND user_id = ? AND phone <> ''
           AND (saved_name LIKE ? ESCAPE '\\' OR push_name LIKE ? ESCAPE '\\'${byPhone ? " OR phone LIKE ? ESCAPE '\\'" : ''})
         LIMIT ?`,
      )
      .all(numberId, viewer.ws, like, like, ...(byPhone ? [likeArg(digits)] : []), NEW_CHAT_SEARCH_LIMIT)) as Array<{
      id: string;
      phone: string;
      saved_name: string;
      push_name: string;
      picture_url: string;
    }>;
    const book = rows
      .filter((r) => !seen.has(r.phone))
      .map((r) => ({ key: `contact:${r.id}`, contactId: r.id, name: displayName(r) || label(r.phone), phoneLabel: label(r.phone), phone: viewer.mask ? '' : r.phone, pictureUrl: r.picture_url ?? '' }))
      .sort((a, b) => a.name.localeCompare(b.name));
    out.push(...book);
  }
  return out.slice(0, NEW_CHAT_SEARCH_LIMIT);
}

/** El id del chat 1:1 con un teléfono, según cómo lo nombra el proveedor de la línea. */
export function dmChatId(provider: NumberRow['provider'], phone: string): string {
  if (provider === 'cloud') return phone;
  if (provider === 'waha') return `${phone}@c.us`;
  return `${phone}@s.whatsapp.net`;
}

/** El chat 1:1 de la línea con ese teléfono, con cualquiera de sus ids (teléfono o lid). El que tiene mensajes primero. */
async function findDm(number: Pick<NumberRow, 'id'>, phones: string[]): Promise<ChatRow | null> {
  const ids = new Set<string>();
  const known = await lookupContacts({ app: 'lines', accountId: number.id }, phones).catch(() => new Map());
  for (const p of phones) {
    ids.add(`${p}@s.whatsapp.net`).add(`${p}@c.us`).add(p);
    const lid = known.get(p)?.lid;
    if (lid) ids.add(`${lid}@lid`);
  }
  const list = [...ids];
  const row = (await getDb()
    .prepare(
      `SELECT * FROM groups_chats WHERE number_id = ? AND provider_chat_id IN (${list.map(() => '?').join(',')}) AND kind = 'dm'
       ORDER BY (last_message_at IS NULL), last_message_at DESC LIMIT 1`,
    )
    .get(number.id, ...list)) as ChatRow | undefined;
  return row ?? null;
}

/** Cuánto se espera al proveedor para saber si el número tiene WhatsApp. */
const CHECK_TIMEOUT_MS = 4000;

async function checkOnWhatsApp(number: NumberRow, phone: string): Promise<{ exists: boolean; jid?: string } | null> {
  let provider;
  try {
    provider = providerFor(number);
  } catch {
    return null;
  }
  if (!provider.checkNumber) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      provider.checkNumber(phone),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), CHECK_TIMEOUT_MS);
      }),
    ]);
  } catch {
    // Si el proveedor no contesta, el chat se abre igual: el envío dirá si el número no existe.
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface StartChatInput {
  numberId: string;
  /** Teléfono escrito a mano… */
  phone?: string;
  /** …o un contacto de la libreta de la línea (resultado de searchNewChat). */
  contactId?: string;
}

/**
 * Abre el chat 1:1 de una línea con un teléfono: el que ya existe, o uno
 * nuevo. Errores: invalid_phone (400), not_found (404: línea o contacto),
 * not_connected (409), own_number (400), not_on_whatsapp (422) y
 * chat_no_access (403: el chat existe y esta persona no lo ve).
 */
export async function startChat(viewer: GroupsViewer, input: StartChatInput): Promise<{ id: string; created: boolean }> {
  const db = getDb();
  const number = await getNumberRow(viewer.ws, input.numberId);
  if (!number) throw new GroupsError('not_found', 404);

  let raw = input.phone ?? '';
  if (input.contactId) {
    // La libreta no se le muestra a quien solo ve sus chats: tampoco se resuelve por id.
    if (viewer.restricted) throw new GroupsError('not_found', 404);
    const c = (await db
      .prepare("SELECT phone FROM wa_contacts WHERE id = ? AND app = 'lines' AND account_id = ? AND user_id = ?")
      .get(input.contactId, number.id, viewer.ws)) as { phone: string } | undefined;
    if (!c?.phone) throw new GroupsError('not_found', 404);
    raw = c.phone;
  }
  const parsed = parseNewChatPhone(raw);
  if (!parsed.ok) throw new GroupsError('invalid_phone');
  let phone = parsed.phone;
  if (number.phone && number.phone === phone) throw new GroupsError('own_number');

  const open = async (chat: ChatRow, created: boolean) => {
    if (!(await canSeeChat(viewer, chat.id))) throw new GroupsError('chat_no_access', 403);
    return { id: chat.id, created };
  };

  const existing = await findDm(number, [phone]);
  if (existing) return open(existing, false);

  if (number.status !== 'connected') throw new GroupsError('not_connected', 409);
  const check = await checkOnWhatsApp(number, phone);
  if (check?.exists === false) throw new GroupsError('not_on_whatsapp', 422);
  // WhatsApp puede conocer el número con otros dígitos (el 9 de algunos países): manda el id que da.
  const canonical = check?.jid ? check.jid.replace(/@.*$/, '') : '';
  if (canonical && canonical !== phone) {
    const other = await findDm(number, [canonical]);
    if (other) return open(other, false);
    phone = canonical;
  }

  const hiddenAt = new Date().toISOString();
  const chat = await upsertChat(
    number,
    { providerChatId: dmChatId(number.provider, phone), kind: 'dm', phone },
    // Quien solo ve sus chats se queda con el que abre (si no, no lo vería). El resto queda sin asignar, como uno que entra.
    { silent: true, hiddenAt, ...(viewer.restricted ? { assignedTo: viewer.me } : {}) },
  );
  const created = chat.hidden_at === hiddenAt && !chat.last_message_at;
  if (created && viewer.restricted && chat.assigned_to === viewer.me) {
    const { afterChatChange } = await import('./groups-inbox');
    await afterChatChange(viewer.ws, viewer.me, { ...chat, assigned_to: null }, { assignedTo: viewer.me }).catch(() => null);
  }
  return open(chat, created);
}
