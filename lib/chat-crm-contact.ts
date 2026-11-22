/**
 * Chat — el contacto del CRM que una conversación trae vinculado
 * (getChatConversationWithVisitor), como lo ve quien abre la bandeja: con las
 * reglas del CRM (lib/crm-visibility.ts y lib/crm-field-perms.ts). Si no ve
 * ese contacto, la conversación sale sin contacto; si lo ve, sin los campos
 * propios que tiene ocultos, sin las reglas de score sobre ellos y sin el id
 * de una empresa que no ve. Server-only.
 */
import type { CrmContactRow } from './db';
import { hiddenFieldsFor, redactRow, sessionFieldViewer } from './crm-field-perms';
import { canSeeOwner, sessionScope } from './crm-visibility';
import { maskPrivateRef, PRIVATE_REFS } from './crm-record-scope';
import type { TeamRole } from './teams';

export async function withViewerCrmContact<T extends { widget_user_id: string; crm_contact: CrmContactRow | null }>(
  conversation: T,
  user: { id: string; role: TeamRole; actingUser?: { id: string } | null },
): Promise<T> {
  const contact = conversation.crm_contact;
  if (!contact) return conversation;
  // El contacto es del CRM del workspace dueño del widget: desde otro workspace no se muestra.
  if (contact.user_id !== user.id || conversation.widget_user_id !== user.id) return { ...conversation, crm_contact: null };
  const scope = await sessionScope(user);
  if (!canSeeOwner(scope, contact.owner_id, contact.user_id)) return { ...conversation, crm_contact: null };
  const masked = (await maskPrivateRef(user.id, contact, [PRIVATE_REFS.company([])], scope))!;
  return { ...conversation, crm_contact: redactRow(masked, await hiddenFieldsFor(sessionFieldViewer(user), 'contacts')) };
}
