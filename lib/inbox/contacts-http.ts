/**
 * Inbox › Contactos: el HubSpot de la sesión para las rutas (lib/inbox/contacts.ts).
 * El del workspace activo, como en Lines; un invitado no lo usa. Server-only.
 */
import { getCurrentUser } from '../session';
import { groupsViewer } from '../groups-access';
import type { InboxHubspotScope } from './contacts';

export async function inboxHubspotScope(): Promise<InboxHubspotScope | null> {
  const user = await getCurrentUser();
  if (!user || user.role === 'guest') return null;
  const me = user.actingUser?.id ?? user.id;
  const viewer = await groupsViewer(user.id, me, user.role);
  return { ws: user.id, me, mask: viewer.mask };
}
