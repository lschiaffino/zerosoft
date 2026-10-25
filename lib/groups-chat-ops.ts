/**
 * Groups: cambios de chat con quién los hizo. Envuelve updateChat y
 * deleteChat para dejar el log de auditoría, emitir los eventos de chat
 * asignado y cerrado (webhooks, Flow) y avisar por push a quien le asignan un
 * chat. Lo usan la interfaz, la API v1 y el MCP. Server-only.
 */
import { emitEventSoon } from './events';
import { GroupsError, deleteChat, getChat, getChatRow, chatEventInfo, updateChat, type ChatDto, type ChatPatch } from './groups';
import { recordAudit, recordChatChanges, type AuditInput } from './groups-audit';

export interface Actor {
  id: string | null;
  kind?: AuditInput['actorKind'];
}

export async function patchChatAs(ws: string, actor: Actor, id: string, patch: ChatPatch): Promise<ChatDto> {
  const before = await getChat(ws, id);
  if (!before) throw new GroupsError('not_found', 404);
  const after = await updateChat(ws, id, patch, actor.id);
  await recordChatChanges(ws, actor, before, after);
  const row = await getChatRow(ws, id);
  if (row && after.assignedTo && after.assignedTo !== before.assignedTo) {
    await emitEventSoon(ws, 'groups.chat.assigned', { assignedTo: after.assignedTo, previous: before.assignedTo, by: actor.id, chat: chatEventInfo(row) });
    if (after.assignedTo !== actor.id) {
      const { notifyPerson } = await import('./groups-push');
      await notifyPerson(ws, after.assignedTo, { chatId: id, title: after.name, body: after.lastMessagePreview || '' }).catch(() => null);
    }
  }
  if (row && before.status !== 'closed' && after.status === 'closed') {
    await emitEventSoon(ws, 'groups.chat.closed', { closedBy: actor.id, chat: chatEventInfo(row) });
  }
  return after;
}

export async function removeChatAs(ws: string, actor: Actor, id: string): Promise<boolean> {
  const chat = await getChat(ws, id);
  if (!chat) return false;
  const ok = await deleteChat(ws, id);
  if (ok) await recordAudit(ws, { chatId: id, chatName: chat.name, actorId: actor.id, actorKind: actor.kind, action: 'deleted', detail: { kind: chat.kind } });
  return ok;
}
