import { accountDto, deleteAccountRow, getAccount, listAccounts } from '@/lib/inbox/core';
import { disconnectGmail } from '@/lib/inbox/gmail';
import { iJson, withOwner } from '@/lib/inbox/http';
import { disconnectWhatsapp } from '@/lib/inbox/whatsapp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return withOwner(async (owner) => iJson({ accounts: (await listAccounts(owner)).map(accountDto) }));
}

/** Quitar una cuenta (?id=): se desconecta y se borran sus chats, mensajes y programados de Inbox. */
export async function DELETE(req: Request) {
  return withOwner(async (owner) => {
    const id = new URL(req.url).searchParams.get('id') ?? '';
    const account = await getAccount(owner, id);
    if (account.kind === 'whatsapp') await disconnectWhatsapp(account);
    else await disconnectGmail(account);
    await deleteAccountRow(owner, id);
    return iJson({ accounts: (await listAccounts(owner)).map(accountDto) });
  });
}
