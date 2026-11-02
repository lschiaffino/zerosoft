/**
 * Send y CRM: si un email verificado coincide con un contacto, la visita queda en la
 * línea de tiempo de ese contacto. Un email escrito sin verificar se queda en Send:
 * cualquiera podría escribir el de un cliente. Server-only.
 */
import { getDb } from '../db';
import { createActivity } from '../crm';
import { renderForRecipient, localized } from '../notification-copy';
import type { DocumentRow } from './core';

export async function linkContact(workspaceId: string, session: { email: string | null; email_verified: number; visitor_id: string | null }, doc: DocumentRow): Promise<string | null> {
  if (!session.email || !session.email_verified) return null;
  const db = getDb();
  const contact = (await db.prepare('SELECT id FROM crm_contacts WHERE user_id = ? AND lower(email) = ? LIMIT 1').get(workspaceId, session.email)) as { id: string } | undefined;
  if (!contact) return null;
  if (session.visitor_id) await db.prepare('UPDATE send_visitors SET contact_id = ? WHERE id = ?').run(contact.id, session.visitor_id);
  const [subject, body] = await renderForRecipient(doc.owner_id, [localized('sendCrmSubject', { title: doc.title }), localized('sendCrmBody', { email: session.email })]);
  await createActivity(workspaceId, { type: 'note', subject: subject ?? doc.title, body: body ?? '', contactId: contact.id, ownerId: doc.owner_id });
  return contact.id;
}
