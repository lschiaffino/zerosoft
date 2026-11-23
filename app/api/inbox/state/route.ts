import { accountDto, inboxCounts, listAccounts, listFolders, listSnippets } from '@/lib/inbox/core';
import { gmailAvailable } from '@/lib/inbox/gmail';
import { inboxInternal, withOwner } from '@/lib/inbox/http';
import { internalVersion } from '@/lib/internal-contacts';
import { ownerRev, versionTag, versioned } from '@/lib/inbox/revisions';
import { whatsappAvailable } from '@/lib/inbox/whatsapp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Lo que necesita la barra: cuentas, carpetas, contadores y snippets. Con If-None-Match y sin cambios responde 304. */
export async function GET(req: Request) {
  return withOwner(async (owner) => {
    // "Por responder" sin lo interno del workspace (lib/internal-contacts.ts); un cambio ahí cambia la versión.
    const internal = await inboxInternal();
    const iv = internal.ws ? await internalVersion(internal.ws) : '';
    return versioned(req, versionTag('s', await ownerRev(owner), iv), async () => {
      const [accounts, folders, counts, snippets] = await Promise.all([listAccounts(owner), listFolders(owner), inboxCounts(owner, new Date(), internal.set), listSnippets(owner)]);
      return {
        accounts: accounts.map(accountDto),
        folders,
        counts,
        snippets,
        available: { whatsapp: whatsappAvailable(), gmail: gmailAvailable() },
      };
    });
  });
}
