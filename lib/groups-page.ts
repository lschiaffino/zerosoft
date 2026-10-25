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
import { listPinned, listTeams } from './groups-inbox';
import { isWorkspaceAdmin } from './session';
import { canSeeChat, groupsViewer, maskChat, maskMember, maskMessage, type GroupsViewer } from './groups-access';

/** Quién mira en una página de Groups (acceso por etiqueta y teléfonos ocultos). */
export function pageViewer(user: SessionUser): Promise<GroupsViewer> {
  return groupsViewer(user.id, user.actingUser?.id ?? user.id, user.role);
}

export async function loadChatPage(user: SessionUser, chatId: string) {
  const ws = user.id;
  const viewer = await pageViewer(user);
  if (!(await canSeeChat(viewer, chatId))) return null;
  const raw = await getChat(ws, chatId);
  if (!raw) return null;
  const chat = maskChat(viewer, raw);
  const db = getDb();
  const [messages, members, people, labels, quickReplies, properties, number, settings, agents, pinned, teams] = await Promise.all([
    listMessages(ws, chatId),
    listMembers(ws, chatId),
    listPeople(ws),
    listLabels(ws),
    listQuickReplies(ws),
    listPropertyDefs(ws),
    getNumberRow(ws, chat.numberId),
    getSettings(ws),
    db.prepare('SELECT id, name FROM agents WHERE user_id = ? ORDER BY name COLLATE NOCASE').all(ws) as Promise<Array<{ id: string; name: string }>>,
    listPinned(ws, chatId),
    listTeams(ws),
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
    messages: messages.map((m) => maskMessage(viewer, m)),
    members: members.map((m) => maskMember(viewer, m)),
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
    isAdmin: isWorkspaceAdmin(user),
    pinned: pinned.map((m) => maskMessage(viewer, m)),
    teams: teams.map((t) => ({ id: t.id, name: t.name })),
    numberName: number ? number.name || (number.phone ? `+${number.phone}` : '') : '',
    caps: number ? PROVIDER_CAPS[number.provider] : PROVIDER_CAPS.cloud,
    ticketEmoji: settings.ticketEmoji,
  };
}
