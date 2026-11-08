import { accountDto, listAccounts } from '@/lib/inbox/core';
import { iJson, withOwner } from '@/lib/inbox/http';
import { connectWhatsapp, disconnectWhatsapp, whatsappState } from '@/lib/inbox/whatsapp';
import { limitByIp } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Estado de la vinculación (la pantalla del QR lo pide cada pocos segundos). */
export async function GET() {
  return withOwner(async (owner) => {
    const account = (await listAccounts(owner)).find((a) => a.kind === 'whatsapp');
    if (!account || !account.provider) return iJson({ account: account ? accountDto(account) : null, state: { status: 'disconnected' } });
    const state = await whatsappState(account);
    return iJson({ account: accountDto(account), state });
  });
}

/** Vincular: crea la instancia y devuelve el QR para escanear con el teléfono. */
export async function POST(req: Request) {
  const limited = await limitByIp(req, 'inbox-wa-connect', 20, 600).catch(() => null);
  if (limited) return limited;
  return withOwner(async (owner) => {
    const { account, state } = await connectWhatsapp(owner);
    return iJson({ account: accountDto(account), state });
  });
}

/** Desvincular (los chats guardados quedan). */
export async function DELETE() {
  return withOwner(async (owner) => {
    const account = (await listAccounts(owner)).find((a) => a.kind === 'whatsapp');
    if (account) await disconnectWhatsapp(account);
    return iJson({ ok: true });
  });
}
