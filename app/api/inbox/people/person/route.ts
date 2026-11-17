import { iJson, withOwner } from '@/lib/inbox/http';
import { inboxContact, inboxContactHubspot, inboxContactHubspotMatches, inboxThreadContact } from '@/lib/inbox/contacts';
import { inboxHubspotScope } from '@/lib/inbox/contacts-http';
import { HubspotError } from '@/lib/groups-hubspot';
import { GroupsError } from '@/lib/groups';
import { limitWrites } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Los errores de HubSpot (y "sin teléfono") con su código, como en Lines. */
function hubspotFail(err: unknown) {
  if (err instanceof HubspotError || err instanceof GroupsError) return iJson({ error: err.code }, err.status);
  throw err;
}

/**
 * La ficha de un contacto de Inbox: ?id=<id de la persona>. Con
 * &hubspot=matches, los contactos de HubSpot con su teléfono. Lo compartido
 * sale de su chat 1:1 (/api/inbox/threads/<id>/wa).
 */
export async function GET(req: Request) {
  return withOwner(async (owner) => {
    const sp = new URL(req.url).searchParams;
    const id = (sp.get('id') ?? '').slice(0, 64);
    const scope = await inboxHubspotScope();
    // ?thread=<id>: la persona de ese chat 1:1 (el panel de HubSpot del chat).
    const thread = sp.get('thread');
    if (thread) return iJson(await inboxThreadContact(owner, scope, thread.slice(0, 64)));
    if (sp.get('hubspot') === 'matches') {
      if (!scope) return iJson({ error: 'forbidden' }, 403);
      try {
        return iJson({ matches: await inboxContactHubspotMatches(owner, scope, id) });
      } catch (err) {
        return hubspotFail(err);
      }
    }
    return iJson(await inboxContact(owner, scope, id));
  });
}

/**
 * { id, action: 'link' (contactId) | 'unlink' | 'create' }: el contacto de
 * HubSpot de la persona, en el HubSpot del workspace. 'create' busca por
 * teléfono antes: si ya hay, devuelve { existing } para elegir.
 */
export async function POST(req: Request) {
  return withOwner(async (owner) => {
    const scope = await inboxHubspotScope();
    if (!scope) return iJson({ error: 'forbidden' }, 403);
    const limited = await limitWrites('inbox', owner);
    if (limited) return limited;
    const b = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
    const id = typeof b.id === 'string' ? b.id.slice(0, 64) : '';
    const action =
      b.action === 'link'
        ? { kind: 'link' as const, contactId: typeof b.contactId === 'string' ? b.contactId.slice(0, 20) : '' }
        : b.action === 'unlink'
          ? { kind: 'unlink' as const }
          : b.action === 'create'
            ? { kind: 'create' as const }
            : null;
    if (!action) return iJson({ error: 'invalid_action' }, 400);
    try {
      const res = await inboxContactHubspot(owner, scope, id, action);
      return iJson(res, action.kind === 'create' && res.row ? 201 : 200);
    } catch (err) {
      return hubspotFail(err);
    }
  });
}
