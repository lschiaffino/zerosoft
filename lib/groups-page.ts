/**
 * Groups: lo que cargan las páginas de un chat o grupo (bandeja y detalle).
 * Server-only.
 */
import { getDb } from './db';
import type { SessionUser } from './session';
import {
  getChat,
  getNumberRow,
  getSettings,
  listLabels,
  listMembers,
  listMessages,
  listPeople,
  listPropertyDefs,
  listQuickReplies,
} from './groups';
import { PROVIDER_CAPS } from './groups-provider';

export async function loadChatPage(user: SessionUser, chatId: string) {
  const ws = user.id;
  const chat = await getChat(ws, chatId);
  if (!chat) return null;
  const db = getDb();
  const [messages, members, people, labels, quickReplies, properties, number, settings, agents] = await Promise.all([
    listMessages(ws, chatId),
    listMembers(ws, chatId),
    listPeople(ws, user.team?.id ?? null),
    listLabels(ws),
    listQuickReplies(ws),
    listPropertyDefs(ws),
    getNumberRow(ws, chat.numberId),
    getSettings(ws),
    db.prepare('SELECT id, name FROM agents WHERE user_id = ? ORDER BY name COLLATE NOCASE').all(ws) as Promise<Array<{ id: string; name: string }>>,
  ]);
  const contact = chat.crmContactId
    ? ((await db
        .prepare("SELECT id, TRIM(first_name || ' ' || last_name) AS name, email FROM crm_contacts WHERE id = ? AND user_id = ?")
        .get(chat.crmContactId, ws)) as { id: string; name: string; email: string } | undefined)
    : undefined;
  const company = chat.crmCompanyId
    ? ((await db.prepare('SELECT id, name FROM crm_companies WHERE id = ? AND user_id = ?').get(chat.crmCompanyId, ws)) as
        | { id: string; name: string }
        | undefined)
    : undefined;
  return {
    chat,
    messages,
    members,
    people,
    labels: labels.map((l) => ({ id: l.id, name: l.name, color: l.color })),
    quickReplies,
    properties,
    agents,
    crm: {
      contact: contact ? { id: contact.id, name: contact.name || contact.email } : null,
      company: company ? { id: company.id, name: company.name } : null,
    },
    me: user.actingUser?.id ?? user.id,
    numberName: number ? number.name || (number.phone ? `+${number.phone}` : '') : '',
    caps: number ? PROVIDER_CAPS[number.provider] : PROVIDER_CAPS.cloud,
    ticketEmoji: settings.ticketEmoji,
  };
}
