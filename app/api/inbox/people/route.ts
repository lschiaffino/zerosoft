import { iJsonIfChanged, withOwner } from '@/lib/inbox/http';
import { listInboxContacts } from '@/lib/inbox/contacts';
import { inboxHubspotScope } from '@/lib/inbox/contacts-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Inbox › Contactos: las personas de tus WhatsApp, cada una una sola vez
 * (teléfono y lid unidos), con sus cuentas, grupos, último mensaje y su
 * contacto de HubSpot (el del workspace). ?q= (nombre o teléfono),
 * ?lines=<cuentas>, ?chat=dm|groups, ?hubspot=linked|unlinked.
 */
export async function GET(req: Request) {
  return withOwner(async (owner) => {
    const p = new URL(req.url).searchParams;
    const chat = p.get('chat');
    const hubspot = p.get('hubspot');
    return iJsonIfChanged(
      req,
      await listInboxContacts(owner, await inboxHubspotScope(), {
        q: (p.get('q') ?? '').slice(0, 200),
        lines: (p.get('lines') ?? '').split(',').filter((x) => /^[\w-]{1,80}$/.test(x)).slice(0, 50),
        chat: chat === 'dm' || chat === 'groups' ? chat : undefined,
        hubspot: hubspot === 'linked' || hubspot === 'unlinked' ? hubspot : undefined,
      }),
    );
  });
}
