import { iJson, withOwner } from '@/lib/inbox/http';
import { inboxHubspotScope } from '@/lib/inbox/contacts-http';
import { HUBSPOT_CONTACT_WRITE_SCOPE, HubspotError, getHubspot } from '@/lib/groups-hubspot';
import { getInboxHubspotAuto, setInboxHubspotAuto } from '@/lib/hubspot-auto-contacts';
import { limitWrites } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * HubSpot en Inbox: si el workspace activo lo tiene conectado, si su token
 * puede crear contactos y si la persona prendió el alta automática de los
 * chats 1:1 nuevos de su Inbox. Un invitado no usa HubSpot.
 */
export async function GET() {
  return withOwner(async (owner) => {
    const scope = await inboxHubspotScope();
    if (!scope) return iJson({ connected: false, autoCreate: false, missingContactScopes: [] });
    const dto = await getHubspot(scope.ws);
    return iJson({
      connected: dto.connected,
      autoCreate: dto.connected && (await getInboxHubspotAuto(owner, scope.ws)),
      missingContactScopes: dto.missingContactScopes,
    });
  });
}

/** { autoCreate }: prende o apaga el alta automática con el HubSpot del workspace activo. */
export async function POST(req: Request) {
  return withOwner(async (owner) => {
    const scope = await inboxHubspotScope();
    if (!scope) return iJson({ error: 'forbidden' }, 403);
    const limited = await limitWrites('inbox', owner);
    if (limited) return limited;
    const b = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
    if (typeof b.autoCreate !== 'boolean') return iJson({ error: 'invalid_input' }, 400);
    try {
      const on = await setInboxHubspotAuto(owner, scope.ws, b.autoCreate);
      return iJson({ connected: true, autoCreate: on, missingContactScopes: [] });
    } catch (err) {
      if (err instanceof HubspotError) return iJson({ error: err.code, scope: HUBSPOT_CONTACT_WRITE_SCOPE }, err.status);
      throw err;
    }
  });
}
