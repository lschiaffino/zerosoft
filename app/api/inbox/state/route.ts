import { accountDto, inboxCounts, listAccounts, listFolders, listSnippets } from '@/lib/inbox/core';
import { gmailAvailable } from '@/lib/inbox/gmail';
import { iJsonIfChanged, withOwner } from '@/lib/inbox/http';
import { whatsappAvailable } from '@/lib/inbox/whatsapp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Lo que necesita la barra: cuentas, carpetas, contadores y snippets. Con If-None-Match y sin cambios responde 304. */
export async function GET(req: Request) {
  return withOwner(async (owner) => {
    const [accounts, folders, counts, snippets] = await Promise.all([listAccounts(owner), listFolders(owner), inboxCounts(owner), listSnippets(owner)]);
    return iJsonIfChanged(req, {
      accounts: accounts.map(accountDto),
      folders,
      counts,
      snippets,
      available: { whatsapp: whatsappAvailable(), gmail: gmailAvailable() },
    });
  });
}
